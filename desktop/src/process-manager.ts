/**
 * Process Manager — manages Next.js and MCP child processes.
 * Handles spawning, health checks, crash recovery, and graceful shutdown.
 */
import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import http from 'http';
import net from 'net';
import { readFileSync, existsSync } from 'fs';

export interface ProcessManagerOptions {
  nodePath: string;
  npxPath: string;
  projectRoot: string;
  webPort: number;
  mcpPort: number;
  mindRoot: string;
  authToken?: string;
  /** Same as ~/.mindos/config.json webPassword — Web UI login + Next middleware */
  webPassword?: string;
  verbose?: boolean;
  /** Enriched env with correct PATH for spawned processes */
  env?: Record<string, string>;
}

export class ProcessManager extends EventEmitter {
  private webProcess: ChildProcess | null = null;
  private mcpProcess: ChildProcess | null = null;
  private opts: ProcessManagerOptions;
  private crashCount = { web: 0, mcp: 0 };
  private stopped = false;
  /** True when an external MCP (CLI-started) is reused instead of spawning our own */
  private externalMcp = false;
  private crashHandlers = new Map<ChildProcess, (...args: unknown[]) => void>();
  private respawnTimers: ReturnType<typeof setTimeout>[] = [];
  /** When true, the next MCP exit is expected (e.g. /api/mcp/restart killed it) — skip crash handler respawn */
  private mcpRestartInProgress = false;
  /** Captured stderr from web process for diagnostics when startup fails */
  private webStderrLines: string[] = [];
  /** Set to true when web process exits during startup (before health check succeeds) */
  private webProcessDied = false;

  constructor(opts: ProcessManagerOptions) {
    super();
    this.opts = opts;
  }

  /** Current effective ports (may change on respawn if original port is occupied) */
  get webPort(): number { return this.opts.webPort; }
  get mcpPort(): number { return this.opts.mcpPort; }

  /** Start MCP + Next.js, then wait for health check */
  async start(): Promise<void> {
    this.stopped = false;
    this.webProcessDied = false;
    this.webStderrLines = [];
    this.externalMcp = false;
    this.emit('status-change', 'starting');

    // 1. Spawn MCP server — or detect an existing one on the target port
    const mcpAlreadyRunning = await this.checkMcpHealth(this.opts.mcpPort);
    if (mcpAlreadyRunning) {
      console.info(`[MindOS] Existing MCP detected on port ${this.opts.mcpPort} — reusing`);
      this.externalMcp = true;
    } else {
      this.mcpProcess = this.spawnMcp();
      this.guardSpawnError(this.mcpProcess, 'mcp');
      this.setupCrashHandler(this.mcpProcess, 'mcp');
    }

    // 2. Spawn Next.js
    this.webProcess = this.spawnWeb();
    this.guardSpawnError(this.webProcess, 'web');
    this.captureStderr(this.webProcess);
    this.setupCrashHandler(this.webProcess, 'web');

    // 3. Wait for health (exits early if web process dies)
    const healthy = await this.waitForReady(this.opts.webPort, '/api/health', 120_000);
    if (!healthy) {
      const stderr = this.webStderrLines.slice(-20).join('\n');
      const detail = this.webProcessDied
        ? `Web process crashed before becoming ready.`
        : `Health check timed out after 120 seconds.`;
      throw new Error(
        `MindOS web server failed to start on port ${this.opts.webPort}.\n` +
        `${detail}\n` +
        (stderr ? `Last output:\n${stderr}` : 'No output captured from web process.'),
      );
    }

    this.emit('status-change', 'running');
    this.emit('ready');
  }

  /** Graceful shutdown: SIGTERM → 5s timeout → SIGKILL */
  async stop(): Promise<void> {
    this.stopped = true;
    this.emit('status-change', 'stopping');

    // Remove crash handlers first to prevent spurious crash events during shutdown
    for (const [proc, handler] of this.crashHandlers) {
      proc.removeListener('exit', handler);
    }
    this.crashHandlers.clear();
    // Cancel any pending respawn timers
    for (const t of this.respawnTimers) clearTimeout(t);
    this.respawnTimers = [];

    const killProcess = (proc: ChildProcess | null): Promise<void> => {
      return new Promise((resolve) => {
        if (!proc || proc.killed) { resolve(); return; }

        const forceKillTimer = setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch { /* already dead */ }
          resolve();
        }, 5000);

        proc.once('exit', () => {
          clearTimeout(forceKillTimer);
          resolve();
        });

        try {
          proc.kill('SIGTERM');
        } catch {
          clearTimeout(forceKillTimer);
          resolve();
        }
      });
    };

    await Promise.all([
      killProcess(this.webProcess),
      // Don't kill external MCP (owned by CLI)
      this.externalMcp ? Promise.resolve() : killProcess(this.mcpProcess),
    ]);

    this.webProcess = null;
    this.mcpProcess = null;
    this.emit('status-change', 'stopped');
  }

  /** Restart services */
  async restart(): Promise<void> {
    const oldWebPort = this.opts.webPort;
    const oldMcpPort = this.opts.mcpPort;
    await this.stop();
    this.crashCount = { web: 0, mcp: 0 };
    this.mcpRestartInProgress = false;
    // After stop, old ports may be in TIME_WAIT — find fresh ones to avoid EADDRINUSE on restart
    this.opts.webPort = await this.findFreePort(oldWebPort).catch(() => oldWebPort);
    if (!this.externalMcp) {
      this.opts.mcpPort = await this.findFreePort(oldMcpPort).catch(() => oldMcpPort);
    }
    await this.start();
  }

  /**
   * Suppress crash-handler respawn for MCP. Call this before an external kill
   * (e.g. /api/mcp/restart) so ProcessManager does not race with the new MCP
   * that the API route spawns.
   */
  suppressMcpCrashRestart(): void {
    this.mcpRestartInProgress = true;
    this.crashCount.mcp = 0;
  }

  // ── Private ──

  private spawnMcp(): ChildProcess {
    const { projectRoot, mcpPort, webPort, authToken, verbose } = this.opts;
    const mcpDir = path.join(projectRoot, 'mcp');
    const mcpBundle = path.join(mcpDir, 'dist', 'index.cjs');

    if (!existsSync(mcpBundle)) {
      throw new Error(
        `MCP bundle not found: ${mcpBundle}\n` +
        `Please ensure @geminilight/mindos is installed: npm install -g @geminilight/mindos@latest`,
      );
    }

    let token = authToken;
    if (!token) {
      try {
        const configPath = path.join(process.env.HOME || '', '.mindos', 'config.json');
        const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
        token = cfg.authToken;
      } catch { /* no config */ }
    }

    const env: Record<string, string> = {
      ...(this.opts.env || process.env as Record<string, string>),
      MCP_TRANSPORT: 'http',
      MCP_PORT: String(mcpPort),
      MCP_HOST: '0.0.0.0',
      MINDOS_URL: `http://127.0.0.1:${webPort}`,
      ...(token ? { AUTH_TOKEN: token } : {}),
      ...(verbose ? { MCP_VERBOSE: '1' } : {}),
    };

    const proc = spawn(this.opts.nodePath, [mcpBundle], {
      cwd: mcpDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return proc;
  }

  private spawnWeb(): ChildProcess {
    const { projectRoot, webPort, mindRoot, authToken, webPassword } = this.opts;
    const appDir = path.join(projectRoot, 'app');

    if (!existsSync(appDir)) {
      throw new Error(
        `App directory not found: ${appDir}\nPlease ensure @geminilight/mindos is installed: npm install -g @geminilight/mindos`
      );
    }

    const env: Record<string, string> = {
      ...(this.opts.env || process.env as Record<string, string>),
      MINDOS_WEB_PORT: String(webPort),
      MINDOS_MCP_PORT: String(this.opts.mcpPort),
      MIND_ROOT: mindRoot,
      NODE_ENV: 'production',
      MINDOS_PROJECT_ROOT: projectRoot,
      MINDOS_CLI_PATH: path.join(projectRoot, 'bin', 'cli.js'),
      MINDOS_MANAGED: '1',
    };
    if (authToken) env.AUTH_TOKEN = authToken;
    if (webPassword) env.WEB_PASSWORD = webPassword;
    /** Always bind to 127.0.0.1 for local mode (avoid OS hostname binding that breaks health checks).
     * @see wiki/80-known-pitfalls.md — "Next 生产进程绑定机器 hostname" */
    env.HOSTNAME = '127.0.0.1';

    // Check for standalone server.js first (much faster startup)
    const standaloneServer = path.join(appDir, '.next', 'standalone', 'server.js');
    if (existsSync(standaloneServer)) {
      return spawn(this.opts.nodePath, [standaloneServer], {
        cwd: appDir,
        env: { ...env, PORT: String(webPort) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }

    // Use local next from app/node_modules/.bin — don't rely on npx
    const localNext = path.join(appDir, 'node_modules', '.bin', 'next');
    if (existsSync(localNext)) {
      return spawn(localNext, ['start', '-p', String(webPort)], {
        cwd: appDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }

    // Last resort: npx next start
    return spawn(this.opts.npxPath, ['next', 'start', '-p', String(webPort)], {
      cwd: appDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  /**
   * Poll /api/health until 200, timeout, or web process death.
   * Exits early when the web process crashes (no point waiting 120s for a dead process).
   */
  private waitForReady(port: number, urlPath: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      let resolved = false;
      const done = (result: boolean) => {
        if (resolved) return;
        resolved = true;
        clearInterval(interval);
        resolve(result);
      };

      const start = Date.now();
      const interval = setInterval(() => {
        if (this.stopped) { done(false); return; }
        if (Date.now() - start > timeoutMs) { done(false); return; }

        // If web process has been marked dead AND crash handler exhausted retries (>=3),
        // bail out immediately instead of polling until timeout.
        if (this.webProcessDied && this.crashCount.web >= 3) {
          done(false);
          return;
        }

        const req = http.get({
          hostname: '127.0.0.1',
          port,
          path: urlPath,
          timeout: 2000,
        }, (res) => {
          if (res.statusCode === 200) {
            done(true);
          }
          res.resume(); // drain
        });
        req.on('error', () => { /* not ready yet */ });
        req.on('timeout', () => { req.destroy(); });
      }, 1000);
    });
  }

  /** Prevent unhandled 'error' event (e.g. ENOENT when binary not found) from crashing Electron */
  private guardSpawnError(proc: ChildProcess, label: string): void {
    proc.on('error', (err) => {
      console.error(`[MindOS:${label}] spawn error: ${err.message}`);
      if (label === 'web') {
        this.webStderrLines.push(`spawn error: ${err.message}`);
        this.webProcessDied = true;
      }
    });
  }

  /** Capture web process stderr for diagnostic output on startup failure */
  private captureStderr(proc: ChildProcess): void {
    proc.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        this.webStderrLines.push(line);
        // Keep buffer bounded
        if (this.webStderrLines.length > 100) this.webStderrLines.shift();
      }
    });
  }

  /** Forward child stdout/stderr so `MINDOS_OPEN_DEVTOOLS=1` terminal actually shows crash output. */
  private pipeChildOutput(proc: ChildProcess, label: string): void {
    const tag = `[MindOS:${label}]`;
    proc.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        console.log(tag, line);
      }
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        console.error(tag, line);
      }
    });
  }

  /** Quick check if a MindOS MCP is already listening on a port */
  private checkMcpHealth(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get({
        hostname: '127.0.0.1',
        port,
        path: '/api/health',
        timeout: 1500,
      }, (res) => {
        resolve(res.statusCode === 200);
        res.resume();
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  /** Find next available port starting from the given one */
  private findFreePort(start: number): Promise<number> {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const tryPort = (port: number) => {
        if (attempts++ > 10) { reject(new Error(`No free port in range ${start}-${start + 10}`)); return; }
        const srv = net.createServer();
        srv.once('error', () => tryPort(port + 1));
        srv.listen(port, '127.0.0.1', () => {
          srv.close(() => resolve(port));
        });
      };
      tryPort(start);
    });
  }

  private setupCrashHandler(proc: ChildProcess, which: 'web' | 'mcp'): void {
    this.pipeChildOutput(proc, which);
    const handler = (code: number | null, signal: string | null) => {
      console.error(`[MindOS:${which}] process exited code=${code} signal=${signal}`);
      if (which === 'web') this.webProcessDied = true;
      if (this.stopped) return;

      // /api/mcp/restart kills the old MCP and spawns its own replacement.
      // Don't race with it by also respawning here.
      if (which === 'mcp' && this.mcpRestartInProgress) {
        this.mcpRestartInProgress = false;
        return;
      }

      this.crashCount[which]++;
      this.emit('crash', which, this.crashCount[which]);

      if (this.crashCount[which] < 3) {
        const delay = this.crashCount[which] === 1 ? 1000 : 3000;
        const timer = setTimeout(async () => {
          if (this.stopped) return;
          try {
            // Try a fresh port — the old one may still be in TIME_WAIT or occupied
            const currentPort = which === 'mcp' ? this.opts.mcpPort : this.opts.webPort;
            const newPort = await this.findFreePort(currentPort).catch(() => currentPort);
            if (newPort !== currentPort) {
              console.info(`[MindOS:${which}] port ${currentPort} still occupied, switching to ${newPort}`);
              if (which === 'mcp') this.opts.mcpPort = newPort;
              else this.opts.webPort = newPort;
            }
            // For MCP: check if someone else started one while we were down
            if (which === 'mcp') {
              const externalOk = await this.checkMcpHealth(this.opts.mcpPort);
              if (externalOk) {
                console.info(`[MindOS] External MCP now available on port ${this.opts.mcpPort} — reusing`);
                this.externalMcp = true;
                this.mcpProcess = null;
                return;
              }
            }
            const newProc = which === 'mcp' ? this.spawnMcp() : this.spawnWeb();
            if (which === 'mcp') {
              this.mcpProcess = newProc;
            } else {
              this.webProcess = newProc;
            }
            this.setupCrashHandler(newProc, which);
          } catch (err) {
            console.error(`[MindOS:${which}] respawn failed:`, err);
          }
        }, delay);
        this.respawnTimers.push(timer);
      } else {
        if (which === 'web') {
          this.emit('status-change', 'error');
        }
      }
    };

    proc.on('exit', handler);
    this.crashHandlers.set(proc, handler as (...args: unknown[]) => void);
  }
}

/**
 * Process Manager — manages Next.js and MCP child processes.
 * Handles spawning, health checks, crash recovery, and graceful shutdown.
 */
import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import http from 'http';
import net from 'net';
import { readFileSync, existsSync, writeFileSync, unlinkSync, mkdirSync, chmodSync, appendFileSync } from 'fs';

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
  /** Captured stderr from MCP process for crash diagnostics */
  private mcpStderrLines: string[] = [];
  /** Set to true when web process exits during startup (before health check succeeds) */
  private webProcessDied = false;

  constructor(opts: ProcessManagerOptions) {
    super();
    this.opts = opts;
  }

  /** Current effective ports (may change on respawn if original port is occupied) */
  get webPort(): number { return this.opts.webPort; }
  get mcpPort(): number { return this.opts.mcpPort; }

  /** Spawn MCP on a new port (called from main.ts when user accepts suggested port) */
  startMcpOnPort(port: number): void {
    // Kill old MCP process to avoid orphan
    if (this.mcpProcess && !this.mcpProcess.killed) {
      try { this.mcpProcess.kill('SIGTERM'); } catch { /* already dead */ }
      this.mcpProcess = null;
    }
    this.opts.mcpPort = port;
    this.externalMcp = false;
    const proc = this.spawnMcp();
    this.mcpProcess = proc;
    this.guardSpawnError(proc, 'mcp');
    this.setupCrashHandler(proc, 'mcp');
    this.writeChildPids();
  }

  /** Start MCP + Next.js, then wait for health check */
  async start(): Promise<void> {
    const t0 = Date.now();
    console.info('[MindOS:ProcessManager] start() called');
    this.stopped = false;
    this.webProcessDied = false;
    this.webStderrLines = [];
    this.mcpStderrLines = [];
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

    // 3. Write child PIDs to disk for orphan cleanup on next launch
    this.writeChildPids();

    // 3. Wait for health (exits early if web process dies)
    const healthy = await this.waitForReady(this.opts.webPort, '/api/health', 180_000);
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

    const elapsed = Date.now() - t0;
    console.info(`[MindOS:ProcessManager] ready in ${elapsed}ms (web port ${this.opts.webPort}, mcp port ${this.opts.mcpPort})`);
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
    this.clearChildPids();
    this.emit('status-change', 'stopped');
  }

  /** Restart services */
  async restart(): Promise<void> {
    console.info('[MindOS:ProcessManager] restart() called', new Error('restart() stack').stack?.split('\n').slice(1, 4).join(' <- '));
    const oldWebPort = this.opts.webPort;
    const oldMcpPort = this.opts.mcpPort;
    await this.stop();
    this.crashCount = { web: 0, mcp: 0 };
    this.mcpRestartInProgress = false;
    // Prefer reusing the same ports (stable for bookmarks, MCP clients, etc.).
    // Wait briefly for the OS to release them after process exit.
    this.opts.webPort = await this.waitForPortOrFallback(oldWebPort);
    if (!this.externalMcp) {
      this.opts.mcpPort = await this.waitForPortOrFallback(oldMcpPort);
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
      MCP_TRANSPORT: 'http', // Desktop always uses HTTP transport (not stdio). MCP clients must use http://127.0.0.1:<port>/mcp
      MCP_PORT: String(mcpPort),
      MCP_HOST: '0.0.0.0',
      MINDOS_URL: `http://127.0.0.1:${webPort}`,
      ...(token ? { AUTH_TOKEN: token } : {}),
      ...(verbose ? { MCP_VERBOSE: '1' } : {}),
    };

    const proc = spawn(this.opts.nodePath, [mcpBundle], {
      cwd: mcpDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
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

    const watchdog = ProcessManager.ensureStdinWatchdog();
    const useWatchdog = watchdog && existsSync(watchdog);

    // Check for standalone server.js first (much faster startup)
    const standaloneServer = path.join(appDir, '.next', 'standalone', 'server.js');
    if (existsSync(standaloneServer)) {
      const args = useWatchdog
        ? ['--require', watchdog, standaloneServer]
        : [standaloneServer];
      return spawn(this.opts.nodePath, args, {
        cwd: appDir,
        env: { ...env, PORT: String(webPort) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    // Use local next from app/node_modules/.bin — don't rely on npx
    const localNext = path.join(appDir, 'node_modules', '.bin', 'next');
    const injectNodeOpts = (base: string) => {
      if (!useWatchdog) return base;
      return base ? `--require ${watchdog} ${base}` : `--require ${watchdog}`;
    };
    if (existsSync(localNext)) {
      return spawn(localNext, ['start', '-p', String(webPort)], {
        cwd: appDir,
        env: { ...env, NODE_OPTIONS: injectNodeOpts(env.NODE_OPTIONS || '') },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    // Last resort: npx next start
    return spawn(this.opts.npxPath, ['next', 'start', '-p', String(webPort)], {
      cwd: appDir,
      env: { ...env, NODE_OPTIONS: injectNodeOpts(env.NODE_OPTIONS || '') },
      stdio: ['pipe', 'pipe', 'pipe'],
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
    // Prevent EPIPE crash when child exits while stdin pipe is still open
    proc.stdin?.on('error', () => {});
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
        timeout: 800,  // Socket connect + response timeout (tightened from 1500ms)
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

  /**
   * Wait up to 10s for a port to become free, then fall back to findFreePort.
   * Keeps ports stable across restarts (important for bookmarks, MCP client configs).
   */
  private async waitForPortOrFallback(port: number): Promise<number> {
    for (let i = 0; i < 20; i++) {
      try {
        await this.findFreePort(port);
        return port; // port is free, reuse it
      } catch { /* still occupied */ }
      await new Promise((r) => setTimeout(r, 500)); // wait 500ms, retry
    }
    // 10s elapsed, port still occupied — fall back to next available
    return this.findFreePort(port + 1).catch(() => port);
  }

  /** Persist crash info to ~/.mindos/crash.log for post-mortem diagnosis */
  private logCrash(which: string, code: number | null, signal: string | null, stderr: string[]): void {
    try {
      const logDir = path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.mindos');
      if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
      const logPath = path.join(logDir, 'crash.log');
      const ts = new Date().toISOString();
      const entry = [
        `--- [${ts}] ${which} crash #${this.crashCount[which as keyof typeof this.crashCount]} ---`,
        `exit code=${code} signal=${signal}`,
        ...stderr.map(l => `  ${l}`),
        '',
      ].join('\n');
      appendFileSync(logPath, entry + '\n', 'utf-8');
      // Keep log file bounded (~100KB)
      try {
        const stat = require('fs').statSync(logPath);
        if (stat.size > 100_000) {
          const lines = readFileSync(logPath, 'utf-8').split('\n');
          writeFileSync(logPath, lines.slice(-200).join('\n'), 'utf-8');
        }
      } catch { /* best effort */ }
    } catch { /* non-critical */ }
  }

  private setupCrashHandler(proc: ChildProcess, which: 'web' | 'mcp'): void {
    this.pipeChildOutput(proc, which);
    // Capture stderr for crash diagnostics — keep last ~2KB
    const stderrChunks: string[] = [];
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk.toString());
      // Keep only last 10 chunks (~2KB) to avoid unbounded growth
      if (stderrChunks.length > 10) stderrChunks.shift();
      // Also feed into the per-process stderr lines buffer
      const lines = chunk.toString().split('\n').filter(Boolean);
      if (which === 'mcp') {
        this.mcpStderrLines.push(...lines);
        if (this.mcpStderrLines.length > 100) this.mcpStderrLines.splice(0, this.mcpStderrLines.length - 100);
      }
    });
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

      const lastStderr = stderrChunks.join('');
      const wasPortConflict = lastStderr.includes('EADDRINUSE') || lastStderr.includes('address already in use');

      const stderrLines = which === 'web' ? this.webStderrLines : this.mcpStderrLines;
      this.crashCount[which]++;
      this.logCrash(which, code, signal, stderrLines.slice(-20));
      this.emit('crash', which, this.crashCount[which as keyof typeof this.crashCount], code, stderrLines.slice(-10));

      if (this.crashCount[which] < 3) {
        const delay = this.crashCount[which] === 1 ? 2000 : 5000;
        const timer = setTimeout(async () => {
          if (this.stopped) return;
          try {
            const currentPort = which === 'mcp' ? this.opts.mcpPort : this.opts.webPort;

            if (wasPortConflict) {
              if (which === 'mcp') {
                // MCP: NEVER switch ports — external clients (Claude Code, Cursor) have static configs.
                // Wait for original port to free up; if still occupied, check for existing MCP.
                const portFree = await this.waitForPortOrFallback(currentPort).then(p => p === currentPort).catch(() => false);
                if (this.stopped) return;
                if (!portFree) {
                  // Port still occupied — check if it's a MindOS MCP we can reuse
                  const externalOk = await this.checkMcpHealth(currentPort);
                  if (this.stopped) return;
                  if (externalOk) {
                    console.info(`[MindOS] External MCP now available on port ${currentPort} — reusing`);
                    this.externalMcp = true;
                    this.mcpProcess = null;
                    return;
                  }
                  // Not a MindOS MCP — port is held by something else.
                  console.error(`[MindOS:mcp] port ${currentPort} occupied by non-MindOS process, cannot respawn`);
                  this.emit('mcp-port-blocked', currentPort);
                  return;
                }
              } else {
                // Web: can switch ports (Desktop controls loadURL, user doesn't hardcode web port)
                const resolvedPort = await this.waitForPortOrFallback(currentPort);
                if (this.stopped) return;
                if (resolvedPort !== currentPort) {
                  console.info(`[MindOS:${which}] port ${currentPort} still occupied, switching to ${resolvedPort}`);
                  this.opts.webPort = resolvedPort;
                }
              }
            }
            // else: non-port crash — reuse same port (process is dead, port is free)

            // For MCP: check if someone else started one while we were down
            if (which === 'mcp') {
              const externalOk = await this.checkMcpHealth(this.opts.mcpPort);
              if (this.stopped) return;
              if (externalOk) {
                console.info(`[MindOS] External MCP now available on port ${this.opts.mcpPort} — reusing`);
                this.externalMcp = true;
                this.mcpProcess = null;
                return;
              }
            }
            if (this.stopped) return;
            const newProc = which === 'mcp' ? this.spawnMcp() : this.spawnWeb();
            if (which === 'mcp') {
              this.mcpProcess = newProc;
            } else {
              this.webProcess = newProc;
            }
            this.guardSpawnError(newProc, which);
            if (which === 'web') this.captureStderr(newProc);
            this.setupCrashHandler(newProc, which);
            this.writeChildPids();
            // Verify respawned process becomes healthy (web only, MCP has its own check above)
            if (which === 'web') {
              const port = this.opts.webPort;
              setTimeout(async () => {
                if (this.stopped) return;
                try {
                  const res = await new Promise<boolean>((resolve) => {
                    const req = require('http').get(
                      { hostname: '127.0.0.1', port, path: '/api/health', timeout: 3000 },
                      (r: any) => { resolve(r.statusCode === 200); r.resume(); },
                    );
                    req.on('error', () => resolve(false));
                    req.on('timeout', () => { req.destroy(); resolve(false); });
                  });
                  if (res) {
                    console.info('[MindOS:web] respawn healthy');
                    this.emit('status-change', 'running');
                  } else {
                    console.warn('[MindOS:web] respawn unhealthy after 8s');
                  }
                } catch { /* best effort */ }
              }, 8000);
            }
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

  // ── Stdin pipe watchdog (primary orphan-exit mechanism) ──

  private static readonly WATCHDOG_CONTENT = [
    '// MindOS Desktop — auto-exit when parent process dies (stdin pipe closes)',
    '// VS Code uses this same pattern for child process lifecycle management.',
    'if (!process.env._MINDOS_WATCHDOG) {',
    '  process.env._MINDOS_WATCHDOG = "1";',
    '  process.stdin.resume();',
    '  process.stdin.on("end", function () {',
    '    setTimeout(function () { process.exit(0); }, 500);',
    '  });',
    '  process.stdin.on("error", function () {});',
    '}',
    '',
  ].join('\n');

  /**
   * Write ~/.mindos/stdin-watchdog.cjs (idempotent).
   * Used by spawnWeb() via `node --require <watchdog> server.js`.
   * MCP server has built-in monitoring so it doesn't need this file.
   */
  static ensureStdinWatchdog(): string | null {
    const dir = path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.mindos');
    const filePath = path.join(dir, 'stdin-watchdog.cjs');
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, ProcessManager.WATCHDOG_CONTENT, 'utf-8');
      return filePath;
    } catch {
      return null; // PID-based cleanup remains as fallback
    }
  }

  // ── Child PID tracking (secondary safety net for orphan cleanup) ──

  private static readonly PID_FILE = path.join(
    process.env.HOME || process.env.USERPROFILE || '/tmp',
    '.mindos', 'desktop-children.pid',
  );

  /** Write current child PIDs to disk so next launch can clean up orphans */
  private writeChildPids(): void {
    const pids: number[] = [];
    if (this.webProcess?.pid) pids.push(this.webProcess.pid);
    if (this.mcpProcess?.pid) pids.push(this.mcpProcess.pid);
    if (pids.length === 0) return;
    try {
      const dir = path.dirname(ProcessManager.PID_FILE);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(ProcessManager.PID_FILE, pids.join('\n'), 'utf-8');
    } catch { /* best effort */ }
  }

  /** Remove PID file on clean shutdown */
  private clearChildPids(): void {
    try { if (existsSync(ProcessManager.PID_FILE)) unlinkSync(ProcessManager.PID_FILE); } catch { /* best effort */ }
  }

  /**
   * Kill orphaned child processes from a previous Desktop session that didn't shut down cleanly.
   * Call once at app startup before creating a new ProcessManager.
   */
  static cleanupOrphanedChildren(): void {
    try {
      if (!existsSync(ProcessManager.PID_FILE)) return;
      const raw = readFileSync(ProcessManager.PID_FILE, 'utf-8').trim();
      if (!raw) return;
      const pids = raw.split('\n').map(Number).filter(p => p > 0 && !isNaN(p));
      for (const pid of pids) {
        ProcessManager.killIfNodeProcess(pid, 'orphaned child');
      }
      unlinkSync(ProcessManager.PID_FILE);
    } catch { /* non-critical */ }
  }

  /**
   * Kill orphaned CLI-started processes (mindos.pid) from a previous `mindos start` session.
   * Desktop and CLI use separate PID files — both must be cleaned up on reinstall.
   */
  static cleanupCliPidFile(): void {
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
    const cliPidPath = path.join(home, '.mindos', 'mindos.pid');
    try {
      if (!existsSync(cliPidPath)) return;
      const raw = readFileSync(cliPidPath, 'utf-8').trim();
      if (!raw) return;
      const pids = raw.split('\n').map(Number).filter(p => p > 0 && !isNaN(p));
      for (const pid of pids) {
        ProcessManager.killIfNodeProcess(pid, 'orphaned CLI');
      }
      unlinkSync(cliPidPath);
    } catch { /* non-critical */ }
  }

  /**
   * Kill processes holding a specific port (fallback when PID files are missing/stale).
   * Only kills node/next processes to avoid harming unrelated services.
   * Uses platform-specific tools with cascading fallbacks:
   *   macOS:   lsof → fuser
   *   Linux:   lsof → ss → fuser
   *   Windows: Get-NetTCPConnection (PowerShell)
   */
  static killProcessesOnPort(port: number): void {
    try {
      const pids = ProcessManager.findPidsOnPort(port);
      for (const pid of pids) {
        ProcessManager.killIfNodeProcess(pid, `port ${port} occupant`);
      }
    } catch { /* best effort */ }
  }

  /** Find PIDs listening on a given port — cross-platform with fallbacks */
  private static findPidsOnPort(port: number): number[] {
    const { execSync } = require('child_process');
    const opts = { encoding: 'utf-8' as const, timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] as const };

    if (process.platform === 'win32') {
      // Windows: PowerShell Get-NetTCPConnection
      try {
        const out = execSync(
          `powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess"`,
          opts,
        ).trim();
        return out.split(/\r?\n/).map(Number).filter((p: number) => p > 0 && !isNaN(p));
      } catch { return []; }
    }

    // Unix: try lsof → ss → fuser
    try {
      const out = execSync(`lsof -ti:${port}`, opts).trim();
      if (out) return out.split('\n').map(Number).filter((p: number) => p > 0 && !isNaN(p));
    } catch { /* lsof not available */ }

    // Fallback: ss (Linux modern — not on macOS)
    if (process.platform === 'linux') {
      try {
        const out = execSync(`ss -tlnp sport = :${port}`, opts).trim();
        const pids: number[] = [];
        for (const match of out.matchAll(/pid=(\d+)/g)) {
          const p = parseInt(match[1], 10);
          if (p > 0) pids.push(p);
        }
        if (pids.length > 0) return pids;
      } catch { /* ss not available */ }
    }

    // Fallback: fuser (available on most Unix)
    try {
      const out = execSync(`fuser ${port}/tcp`, opts).trim();
      return out.split(/\s+/).map(Number).filter((p: number) => p > 0 && !isNaN(p));
    } catch { /* fuser not available */ }

    return [];
  }

  /**
   * Verify a PID is a node/next process before killing it — prevents harming unrelated processes.
   * On Windows: uses wmic/PowerShell to check process name before killing.
   * On Unix: uses ps -p to check.
   */
  private static killIfNodeProcess(pid: number, label: string): void {
    try {
      process.kill(pid, 0); // check alive
      const { execSync } = require('child_process');

      if (process.platform === 'win32') {
        // Windows: verify process name via wmic before killing
        try {
          const name = execSync(
            `wmic process where ProcessId=${pid} get Name /format:value`,
            { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] },
          ).trim();
          if (!name.toLowerCase().includes('node')) {
            return; // PID reused by non-node process, skip
          }
        } catch { return; } // wmic failed, skip to be safe
      } else {
        try {
          const comm = execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf-8', timeout: 2000 }).trim();
          if (!comm.includes('node') && !comm.includes('next')) {
            return; // PID reused by non-node process, skip
          }
        } catch { return; } // ps failed, skip to be safe
      }

      console.warn(`[MindOS] Killing ${label} process (PID ${pid})`);
      // Windows: process.kill with SIGTERM maps to TerminateProcess (hard kill).
      // This is acceptable for cleanup; graceful shutdown via IPC is not available cross-process.
      process.kill(pid, 'SIGTERM');
    } catch { /* already dead */ }
  }
}

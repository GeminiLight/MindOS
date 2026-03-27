/**
 * Process Manager — manages Next.js and MCP child processes.
 * Handles spawning, health checks, crash recovery, and graceful shutdown.
 */
import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import http from 'http';
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
  private crashHandlers = new Map<ChildProcess, (...args: unknown[]) => void>();

  constructor(opts: ProcessManagerOptions) {
    super();
    this.opts = opts;
  }

  /** Start MCP + Next.js, then wait for health check */
  async start(): Promise<void> {
    this.stopped = false;
    this.emit('status-change', 'starting');

    // 1. Spawn MCP server
    this.mcpProcess = this.spawnMcp();
    this.setupCrashHandler(this.mcpProcess, 'mcp');

    // 2. Spawn Next.js
    this.webProcess = this.spawnWeb();
    this.setupCrashHandler(this.webProcess, 'web');

    // 3. Wait for health
    const healthy = await this.waitForReady(this.opts.webPort, '/api/health', 120_000);
    if (!healthy) {
      throw new Error(`MindOS web server did not start within 120 seconds on port ${this.opts.webPort}`);
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
      killProcess(this.mcpProcess),
    ]);

    this.webProcess = null;
    this.mcpProcess = null;
    this.emit('status-change', 'stopped');
  }

  /** Restart services */
  async restart(): Promise<void> {
    await this.stop();
    this.crashCount = { web: 0, mcp: 0 };
    await this.start();
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

    return spawn(this.opts.nodePath, [mcpBundle], {
      cwd: mcpDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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
    };
    if (authToken) env.AUTH_TOKEN = authToken;
    if (webPassword) env.WEB_PASSWORD = webPassword;
    /** Next binds to OS hostname by default; health checks use 127.0.0.1 */
    if (!env.HOSTNAME) env.HOSTNAME = '127.0.0.1';

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

  /** Poll /api/health until 200 or timeout */
  private waitForReady(port: number, urlPath: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const start = Date.now();
      const interval = setInterval(() => {
        if (this.stopped) {
          clearInterval(interval);
          resolve(false);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          clearInterval(interval);
          resolve(false);
          return;
        }

        const req = http.get({
          hostname: '127.0.0.1',
          port,
          path: urlPath,
          timeout: 2000,
        }, (res) => {
          if (res.statusCode === 200) {
            clearInterval(interval);
            resolve(true);
          }
          res.resume(); // drain
        });
        req.on('error', () => { /* not ready yet */ });
        req.on('timeout', () => { req.destroy(); });
      }, 1000);
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

  private setupCrashHandler(proc: ChildProcess, which: 'web' | 'mcp'): void {
    this.pipeChildOutput(proc, which);
    const handler = (code: number | null, signal: string | null) => {
      console.error(`[MindOS:${which}] process exited code=${code} signal=${signal}`);
      if (this.stopped) return;

      this.crashCount[which]++;
      this.emit('crash', which, this.crashCount[which]);

      if (this.crashCount[which] < 3) {
        // Auto-restart with increasing delay: 1s, 3s
        const delay = this.crashCount[which] === 1 ? 1000 : 3000;
        setTimeout(() => {
          if (this.stopped) return;
          const newProc = which === 'mcp' ? this.spawnMcp() : this.spawnWeb();
          if (which === 'mcp') {
            this.mcpProcess = newProc;
          } else {
            this.webProcess = newProc;
          }
          this.setupCrashHandler(newProc, which);
        }, delay);
      } else {
        // Only mark overall status as 'error' if web crashes
        // MCP crash is a degraded state, not a fatal error
        if (which === 'web') {
          this.emit('status-change', 'error');
        }
      }
    };

    proc.on('exit', handler);
    this.crashHandlers.set(proc, handler as (...args: unknown[]) => void);
  }
}

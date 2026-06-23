/**
 * Process Manager — manages Next.js and MCP child processes.
 * Handles spawning, health checks, crash recovery, and graceful shutdown.
 */
import { ChildProcess, execFile, spawn } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import net from 'net';
import { promisify } from 'util';
import { readFileSync, existsSync, writeFileSync, unlinkSync, mkdirSync, chmodSync, appendFileSync } from 'fs';
import { desktopTelemetry } from './telemetry';
import { resolveCliPath, resolveMcpBundlePath, resolveMcpDir, resolveWebAppDir } from './mindos-runtime-layout';
import { verifyMindOsWebHealth } from './mindos-web-health';
import { getDesktopConfigDir } from './desktop-home';
import { resolveExecTarget } from './exec-target';

const IS_WIN = process.platform === 'win32';
const execFileAsync = promisify(execFile);
const CHILD_PROCESS_TERM_TIMEOUT_MS = 5000;
const PID_TERM_TIMEOUT_MS = 1500;

export function isMindosOwnedCommandLine(commandLine: string): boolean {
  const normalized = commandLine.replace(/\\/g, '/').toLowerCase();
  return [
    '/.mindos/runtime/',
    '/mindos-runtime/',
    '/node_modules/@geminilight/mindos/',
    '/@geminilight/mindos/',
    '/packages/mindos/bin/cli.js',
    '/packages/web/.next/standalone/server.js',
    '/dist/protocols/mcp-server/index.cjs',
  ].some((marker) => normalized.includes(marker));
}

function forceKillChildProcess(proc: ChildProcess): void {
  try {
    if (IS_WIN && proc.pid) {
      execFile('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => {});
      proc.kill();
    } else if (proc.pid) {
      try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* process may not own a group */ }
      proc.kill('SIGKILL');
    } else {
      if (IS_WIN) proc.kill();
      else proc.kill('SIGKILL');
    }
  } catch { /* already dead */ }
}

function terminateChildProcess(proc: ChildProcess | null, timeoutMs = CHILD_PROCESS_TERM_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve) => {
    if (!proc || proc.killed) { resolve(); return; }

    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(forceKillTimer);
      resolve();
    };

    const forceKillTimer = setTimeout(() => {
      forceKillChildProcess(proc);
      done();
    }, timeoutMs);

    proc.once('exit', done);

    try {
      if (IS_WIN && proc.pid) {
        // proc.kill() on Windows only terminates the DIRECT child (cmd.exe for
        // shell-wrapped spawns); its exit clears the force-kill timer, so the
        // timeout taskkill never ran and grandchildren kept the port. Kill the
        // whole tree up front instead.
        execFile('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => {});
      }
      if (!IS_WIN && proc.pid) {
        try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* process may not own a group */ }
      }
      proc.kill('SIGTERM');
    } catch {
      done();
    }
  });
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function terminatePid(pid: number, timeoutMs = PID_TERM_TIMEOUT_MS): Promise<void> {
  if (!isPidAlive(pid)) return;

  try {
    if (IS_WIN) {
      // Tree-kill first — killing only the direct PID leaves grandchildren
      // (node spawned via cmd.exe) holding the port. See terminateChildProcess.
      execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch {
    return;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (!isPidAlive(pid)) return;
  }

  try {
    if (IS_WIN) {
      execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
      process.kill(pid);
    }
    else process.kill(pid, 'SIGKILL');
  } catch { /* already dead */ }
}

export const _terminateChildProcess_forTest = terminateChildProcess;

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
  /** Real Desktop install directory/bundle, used to reject mindRoot overlap in setup */
  installDir?: string;
  obsidianSecretStorageBroker?: {
    url: string;
    token: string;
  };
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
  /** Set on spawn 'error' (e.g. ENOENT) — no exit event fires, so crashCount never reaches 3 */
  private webSpawnFailed = false;

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
      void terminateChildProcess(this.mcpProcess);
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
    const stopStart = desktopTelemetry.startTimer('desktop.process_manager.start', {
      webPort: this.opts.webPort,
      mcpPort: this.opts.mcpPort,
    });
    console.info('[MindOS:ProcessManager] start() called');
    this.stopped = false;
    this.webProcessDied = false;
    this.webSpawnFailed = false;
    this.webStderrLines = [];
    this.mcpStderrLines = [];
    this.externalMcp = false;
    this.emit('status-change', 'starting');

    try {
      // 1. Spawn MCP server — or detect an existing one on the target port
      const stopMcp = desktopTelemetry.startTimer('desktop.boot.spawn_mcp', { port: this.opts.mcpPort });
      const mcpAlreadyRunning = await this.checkMcpHealth(this.opts.mcpPort);
      if (mcpAlreadyRunning) {
        console.info(`[MindOS] Existing MCP detected on port ${this.opts.mcpPort} — reusing`);
        this.externalMcp = true;
      } else {
        this.mcpProcess = this.spawnMcp();
        this.guardSpawnError(this.mcpProcess, 'mcp');
        this.setupCrashHandler(this.mcpProcess, 'mcp');
      }
      stopMcp({ externalMcp: mcpAlreadyRunning, port: this.opts.mcpPort });

      // 2. Spawn Next.js
      const stopWebSpawn = desktopTelemetry.startTimer('desktop.boot.spawn_web', { port: this.opts.webPort });
      this.webProcess = this.spawnWeb();
      this.guardSpawnError(this.webProcess, 'web');
      this.captureStderr(this.webProcess);
      this.setupCrashHandler(this.webProcess, 'web');
      stopWebSpawn({ port: this.opts.webPort });

      // 3. Write child PIDs to disk for orphan cleanup on next launch
      this.writeChildPids();

      // 4. Wait for health (exits early if web process dies)
      const stopHealthCheck = desktopTelemetry.startTimer('desktop.boot.health_check', { port: this.opts.webPort });
      const healthy = await this.waitForReady(this.opts.webPort, 60_000);
      stopHealthCheck({ port: this.opts.webPort, success: healthy });
      if (!healthy) {
        const stderr = this.webStderrLines.slice(-20).join('\n');
        const detail = this.webProcessDied
          ? `Web process crashed before becoming ready.`
          : `Health check timed out after 60 seconds.`;
        throw new Error(
          `MindOS web server failed to start on port ${this.opts.webPort}.\n` +
          `${detail}\n` +
          (stderr ? `Last output:\n${stderr}` : 'No output captured from web process.'),
        );
      }

      const elapsed = Date.now() - t0;
      stopStart({ success: true, externalMcp: this.externalMcp });
      console.info(`[MindOS:ProcessManager] ready in ${elapsed}ms (web port ${this.opts.webPort}, mcp port ${this.opts.mcpPort})`);
      this.emit('status-change', 'running');
      this.emit('ready');
    } catch (error) {
      stopStart({ success: false, externalMcp: this.externalMcp });
      throw error;
    }
  }

  /** Graceful shutdown: SIGTERM → 5s timeout → force kill */
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

    await Promise.all([
      terminateChildProcess(this.webProcess),
      // Don't kill external MCP (owned by CLI)
      this.externalMcp ? Promise.resolve() : terminateChildProcess(this.mcpProcess),
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
    const mcpDir = resolveMcpDir(projectRoot);
    const mcpBundle = resolveMcpBundlePath(projectRoot);

    if (!existsSync(mcpBundle)) {
      throw new Error(
        `MCP bundle not found: ${mcpBundle}\n` +
        `Please ensure @geminilight/mindos is installed: npm install -g @geminilight/mindos@latest`,
      );
    }

    let token = authToken;
    if (!token) {
      try {
        const configPath = path.join(getDesktopConfigDir(), 'config.json');
        const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
        token = cfg.authToken;
      } catch { /* no config */ }
    }

    const env: Record<string, string> = {
      ...(this.opts.env || process.env as Record<string, string>),
      MCP_TRANSPORT: 'http', // Desktop always uses HTTP transport (not stdio). MCP clients must use http://127.0.0.1:<port>/mcp
      MCP_PORT: String(mcpPort),
      // Loopback by default: AUTH_TOKEN is optional, so binding all interfaces
      // exposed an unauthenticated MCP API to the LAN. MINDOS_MCP_HOST is the
      // explicit opt-in for non-loopback setups.
      MCP_HOST: (this.opts.env || process.env as Record<string, string>).MINDOS_MCP_HOST || '127.0.0.1',
      MINDOS_URL: `http://127.0.0.1:${webPort}`,
      ...(token ? { AUTH_TOKEN: token } : {}),
      ...(verbose ? { MCP_VERBOSE: '1' } : {}),
    };

    const proc = spawn(this.opts.nodePath, [mcpBundle], {
      cwd: mcpDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: !IS_WIN,
      windowsHide: true,
    });
    return proc;
  }

  private spawnWeb(): ChildProcess {
    const { projectRoot, webPort, mindRoot, authToken, webPassword } = this.opts;
    const appDir = resolveWebAppDir(projectRoot);

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
      MINDOS_CLI_PATH: resolveCliPath(projectRoot),
      MINDOS_MANAGED: '1',
    };
    if (authToken) env.AUTH_TOKEN = authToken;
    if (webPassword) env.WEB_PASSWORD = webPassword;
    if (this.opts.installDir) env.MINDOS_INSTALL_DIR = this.opts.installDir;
    if (this.opts.obsidianSecretStorageBroker) {
      env.MINDOS_OBSIDIAN_SECRET_BROKER_URL = this.opts.obsidianSecretStorageBroker.url;
      env.MINDOS_OBSIDIAN_SECRET_BROKER_TOKEN = this.opts.obsidianSecretStorageBroker.token;
    }
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
        detached: !IS_WIN,
        windowsHide: true,
      });
    }

    // Use local next from the resolved Web runtime dir — don't rely on npx.
    const localNext = path.join(appDir, 'node_modules', '.bin', IS_WIN ? 'next.cmd' : 'next');
    const injectNodeOpts = (base: string) => {
      if (!useWatchdog) return base;
      // Quote the watchdog path for NODE_OPTIONS — paths with spaces (e.g.
      // C:\Users\John Smith\.mindos\...) would break without quotes.
      const quoted = `"${watchdog}"`;
      return base ? `--require ${quoted} ${base}` : `--require ${quoted}`;
    };
    if (existsSync(localNext)) {
      // resolveExecTarget wraps .cmd in cmd.exe with quoted argv — shell:true
      // concatenates unquoted and breaks on install paths containing spaces.
      const target = resolveExecTarget(localNext, ['start', '-p', String(webPort)]);
      return spawn(target.command, target.args, {
        cwd: appDir,
        env: { ...env, NODE_OPTIONS: injectNodeOpts(env.NODE_OPTIONS || '') },
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: !IS_WIN,
        windowsHide: true,
      });
    }

    // Last resort: npx next start
    const npxTarget = resolveExecTarget(this.opts.npxPath, ['next', 'start', '-p', String(webPort)]);
    return spawn(npxTarget.command, npxTarget.args, {
      cwd: appDir,
      env: { ...env, NODE_OPTIONS: injectNodeOpts(env.NODE_OPTIONS || '') },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: !IS_WIN,
      windowsHide: true,
    });
  }

  /**
   * Poll /api/health until MindOS responds, timeout, or web process death.
   * Exits early when the web process crashes (no point waiting 120s for a dead process).
   */
  private async waitForReady(port: number, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start <= timeoutMs) {
      if (this.stopped) return false;

      // Bail early when the web process is unrecoverable: crash handler
      // exhausted retries, or spawn itself failed (no exit event → crashCount
      // never increments and we'd poll the full timeout for nothing).
      if (this.webProcessDied && (this.crashCount.web >= 3 || this.webSpawnFailed)) return false;

      if (await verifyMindOsWebHealth(port, 2000)) return true;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return false;
  }

  /** Prevent unhandled 'error' event (e.g. ENOENT when binary not found) from crashing Electron */
  private guardSpawnError(proc: ChildProcess, label: string): void {
    proc.on('error', (err) => {
      console.error(`[MindOS:${label}] spawn error: ${err.message}`);
      if (label === 'web') {
        this.webStderrLines.push(`spawn error: ${err.message}`);
        this.webProcessDied = true;
        this.webSpawnFailed = true;
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
    return verifyMindOsWebHealth(port, 800);
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
   * Rejects when neither the port nor any fallback frees up — returning the
   * occupied port would guarantee an EADDRINUSE crash loop downstream.
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
    return this.findFreePort(port + 1).catch(() => {
      throw new Error(`Port ${port} is still occupied and no fallback port is free in ${port + 1}-${port + 11}`);
    });
  }

  /** Persist crash info to ~/.mindos/crash.log for post-mortem diagnosis */
  private logCrash(which: string, code: number | null, signal: string | null, stderr: string[]): void {
    try {
      const logDir = getDesktopConfigDir();
      if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
      const logPath = path.join(logDir, 'crash.log');
      const ts = new Date().toISOString();
      const entry = [
        `--- [${ts}] ${which} crash #${this.crashCount[which as keyof typeof this.crashCount]} ---`,
        `exit code=${code} signal=${signal}`,
        `node=${this.opts.nodePath}`,
        `projectRoot=${this.opts.projectRoot}`,
        `webPort=${this.opts.webPort} mcpPort=${this.opts.mcpPort}`,
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
                  const res = await verifyMindOsWebHealth(port, 3000);
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
    const dir = getDesktopConfigDir();
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

  private static childPidFile(): string {
    return path.join(getDesktopConfigDir(), 'desktop-children.pid');
  }

  /** Write current child PIDs to disk so next launch can clean up orphans */
  private writeChildPids(): void {
    const pids: number[] = [];
    if (this.webProcess?.pid) pids.push(this.webProcess.pid);
    if (this.mcpProcess?.pid) pids.push(this.mcpProcess.pid);
    if (pids.length === 0) return;
    try {
      const pidFile = ProcessManager.childPidFile();
      const dir = path.dirname(pidFile);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(pidFile, pids.join('\n'), 'utf-8');
    } catch { /* best effort */ }
  }

  /** Remove PID file on clean shutdown */
  private clearChildPids(): void {
    const pidFile = ProcessManager.childPidFile();
    try { if (existsSync(pidFile)) unlinkSync(pidFile); } catch { /* best effort */ }
  }

  /**
   * Kill orphaned child processes from a previous Desktop session that didn't shut down cleanly.
   * Call once at app startup before creating a new ProcessManager.
   */
  static async cleanupOrphanedChildren(): Promise<void> {
    try {
      const pidFile = ProcessManager.childPidFile();
      if (!existsSync(pidFile)) return;
      const raw = readFileSync(pidFile, 'utf-8').trim();
      if (!raw) return;
      const pids = raw.split('\n').map(Number).filter(p => p > 0 && !isNaN(p));
      for (const pid of pids) {
        await ProcessManager.killIfNodeProcess(pid, 'orphaned child');
      }
      unlinkSync(pidFile);
    } catch { /* non-critical */ }
  }

  /**
   * Kill orphaned CLI-started processes (mindos.pid) from a previous `mindos start` session.
   * Desktop and CLI use separate PID files — both must be cleaned up on reinstall.
   */
  static async cleanupCliPidFile(): Promise<void> {
    const cliPidPath = path.join(getDesktopConfigDir(), 'mindos.pid');
    try {
      if (!existsSync(cliPidPath)) return;
      const raw = readFileSync(cliPidPath, 'utf-8').trim();
      if (!raw) return;
      const pids = raw.split('\n').map(Number).filter(p => p > 0 && !isNaN(p));
      for (const pid of pids) {
        await ProcessManager.killIfNodeProcess(pid, 'orphaned CLI');
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
  static async killProcessesOnPort(port: number): Promise<void> {
    try {
      const pids = await ProcessManager.findPidsOnPort(port);
      for (const pid of pids) {
        await ProcessManager.killIfNodeProcess(pid, `port ${port} occupant`);
      }
    } catch { /* best effort */ }
  }

  /** Find PIDs listening on a given port — cross-platform with fallbacks */
  private static async findPidsOnPort(port: number): Promise<number[]> {
    const timeout = 3000;

    if (process.platform === 'win32') {
      const stop = desktopTelemetry.startTimer('desktop.port.find_pids', { port, method: 'powershell' });
      try {
        const { stdout } = await execFileAsync('powershell.exe', [
          '-NoProfile', '-Command',
          `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess`,
        ], { encoding: 'utf-8', timeout, windowsHide: true });
        const pids = (stdout as string).trim().split(/\r?\n/).map(Number).filter((p: number) => p > 0 && !isNaN(p));
        stop({ port, method: 'powershell', pidCount: pids.length, success: true });
        return pids;
      } catch {
        stop({ port, method: 'powershell', pidCount: 0, success: false });
        return [];
      }
    }

    // Unix: try lsof → ss → fuser
    {
      const stop = desktopTelemetry.startTimer('desktop.port.find_pids', { port, method: 'lsof' });
      try {
        const { stdout } = await execFileAsync('lsof', [`-ti:${port}`], { encoding: 'utf-8', timeout, windowsHide: true });
        if (stdout.trim()) {
          const pids = stdout.trim().split('\n').map(Number).filter((p: number) => p > 0 && !isNaN(p));
          stop({ port, method: 'lsof', pidCount: pids.length, success: true });
          return pids;
        }
        stop({ port, method: 'lsof', pidCount: 0, success: true });
      } catch {
        stop({ port, method: 'lsof', pidCount: 0, success: false });
      }
    }

    // Fallback: ss (Linux modern — not on macOS)
    if (process.platform === 'linux') {
      const stop = desktopTelemetry.startTimer('desktop.port.find_pids', { port, method: 'ss' });
      try {
        const { stdout } = await execFileAsync('ss', ['-tlnp', 'sport', '=', `:${port}`], { encoding: 'utf-8', timeout, windowsHide: true });
        const pids: number[] = [];
        for (const match of (stdout as string).matchAll(/pid=(\d+)/g)) {
          const p = parseInt(match[1], 10);
          if (p > 0) pids.push(p);
        }
        if (pids.length > 0) {
          stop({ port, method: 'ss', pidCount: pids.length, success: true });
          return pids;
        }
        stop({ port, method: 'ss', pidCount: 0, success: true });
      } catch {
        stop({ port, method: 'ss', pidCount: 0, success: false });
      }
    }

    // Fallback: fuser (available on most Unix)
    const stop = desktopTelemetry.startTimer('desktop.port.find_pids', { port, method: 'fuser' });
    try {
      let output = '';
      let fuserSucceeded = true;
      try {
        const { stdout, stderr } = await execFileAsync('fuser', [`${port}/tcp`], { encoding: 'utf-8', timeout, windowsHide: true });
        output = `${stdout}${stderr}`;
      } catch (err) {
        fuserSucceeded = false;
        const e = err as { stdout?: string; stderr?: string };
        output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
      }
      const pids = output.match(/\d+/g)?.map(Number).filter((p: number) => p > 0 && p !== port) ?? [];
      if (pids.length > 0) {
        stop({ port, method: 'fuser', pidCount: pids.length, success: true });
        return pids;
      }
      stop({ port, method: 'fuser', pidCount: 0, success: fuserSucceeded });
    } catch {
      stop({ port, method: 'fuser', pidCount: 0, success: false });
    }

    return [];
  }

  /**
   * Verify a PID belongs to MindOS before killing it — prevents harming
   * unrelated Node/Next processes when PID files are stale or ports collide.
   * On Windows: uses PowerShell/wmic to check command line before killing.
   * On Unix: uses ps -p to check command line.
   */
  private static async killIfNodeProcess(pid: number, label: string): Promise<void> {
    const stop = desktopTelemetry.startTimer('desktop.port.kill_verify', { pid, label });
    try {
      process.kill(pid, 0); // check alive
      const timeout = 3000;

      if (process.platform === 'win32') {
        try {
          const { stdout } = await execFileAsync('powershell.exe', [
            '-NoProfile', '-Command',
            `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue).CommandLine`,
          ], { encoding: 'utf-8', timeout, windowsHide: true });
          if (!isMindosOwnedCommandLine((stdout as string).trim())) {
            stop({ pid, label, verifiedMindosProcess: false, success: true });
            return;
          }
        } catch {
          try {
            const { stdout } = await execFileAsync('wmic', ['process', 'where', `ProcessId=${pid}`, 'get', 'CommandLine', '/format:value'], { encoding: 'utf-8', timeout, windowsHide: true });
            if (!isMindosOwnedCommandLine((stdout as string).trim())) {
              stop({ pid, label, verifiedMindosProcess: false, success: true });
              return;
            }
          } catch {
            stop({ pid, label, verifiedMindosProcess: false, success: false });
            return;
          }
        }
      } else {
        try {
          const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf-8', timeout: 2000, windowsHide: true });
          if (!isMindosOwnedCommandLine((stdout as string).trim())) {
            stop({ pid, label, verifiedMindosProcess: false, success: true });
            return;
          }
        } catch {
          stop({ pid, label, verifiedMindosProcess: false, success: false });
          return;
        }
      }

      console.warn(`[MindOS] Killing ${label} process (PID ${pid})`);
      await terminatePid(pid);
      stop({ pid, label, verifiedMindosProcess: true, success: true });
    } catch {
      stop({ pid, label, verifiedMindosProcess: false, success: false });
    }
  }
}

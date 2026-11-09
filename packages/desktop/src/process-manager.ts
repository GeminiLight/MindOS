/**
 * Process Manager — manages Next.js and MCP child processes.
 * Handles spawning, health checks, crash recovery, and graceful shutdown.
 *
 * The process layer is three files:
 *   process-manager.ts  the lifecycle of the two children (this file)
 *   process-kill.ts     cross-platform termination primitives
 *   process-cleanup.ts  PID files and port-holder cleanup between sessions
 */
import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import net from 'net';
import { readFileSync, existsSync, writeFileSync, unlinkSync, mkdirSync, appendFileSync, statSync } from 'fs';
import { desktopTelemetry } from './telemetry';
import { resolveCliPath, resolveMcpBundlePath, resolveMcpDir, resolveWebAppDir } from './mindos-runtime-layout';
import { verifyMindOsWebHealth } from './mindos-web-health';
import { getDesktopConfigDir } from './desktop-home';
import { resolveExecTarget } from './exec-target';
import { IS_WIN, sanitizeChildEnv, terminateChildProcess } from './process-kill';
import {
  cleanupCliPidFile,
  cleanupOrphanedChildren,
  clearChildPidFile,
  killProcessesOnPort,
  writeChildPidList,
} from './process-cleanup';

// Re-exported: these were part of this module's surface before the split.
export { isMindosOwnedCommandLine, sanitizeChildEnv, _terminateChildProcess_forTest } from './process-kill';

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

  /**
   * Graceful shutdown: SIGTERM → 5s timeout → force kill → bounded wait for exit.
   * Resolves `true` when every managed child confirmed exit. Resolves `false` when
   * a child may still be alive; its PID stays in desktop-children.pid so the next
   * boot's heal path can finish the job (callers must not record a clean exit).
   */
  async stop(opts: { termTimeoutMs?: number; forceKillConfirmMs?: number } = {}): Promise<boolean> {
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

    const webProc = this.webProcess;
    const mcpProc = this.externalMcp ? null : this.mcpProcess; // Don't kill external MCP (owned by CLI)
    const [webExited, mcpExited] = await Promise.all([
      terminateChildProcess(webProc, opts.termTimeoutMs, opts.forceKillConfirmMs),
      terminateChildProcess(mcpProc, opts.termTimeoutMs, opts.forceKillConfirmMs),
    ]);

    const survivors: number[] = [];
    if (!webExited && webProc?.pid) survivors.push(webProc.pid);
    if (!mcpExited && mcpProc?.pid) survivors.push(mcpProc.pid);

    this.webProcess = null;
    this.mcpProcess = null;
    if (survivors.length === 0) {
      this.clearChildPids();
    } else {
      console.warn(`[MindOS:ProcessManager] child process(es) did not confirm exit after force-kill: ${survivors.join(', ')} — keeping PID file for next-boot cleanup`);
      this.writePidList(survivors);
    }
    this.emit('status-change', 'stopped');
    return survivors.length === 0;
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

  /** Where the Web server's /api/mcp/restart leaves its managed-restart marker (also passed as `MINDOS_MCP_RESTART_INTENT`). */
  static mcpRestartIntentFile(): string {
    return path.join(getDesktopConfigDir(), 'mcp-restart.intent');
  }

  /**
   * Read and delete the managed-restart marker. True only for a fresh
   * (< 60s) intent naming our MCP port; anything stale, foreign or unparsable
   * is removed and reported as "no intent" so the exit counts as a crash.
   */
  private consumeMcpRestartIntent(): boolean {
    const file = ProcessManager.mcpRestartIntentFile();
    let raw: string;
    try {
      if (!existsSync(file)) return false;
      raw = readFileSync(file, 'utf-8');
    } catch {
      return false;
    }
    try { unlinkSync(file); } catch { /* best effort */ }
    try {
      const intent = JSON.parse(raw) as { port?: unknown; requestedAt?: unknown };
      const requestedAt = typeof intent.requestedAt === 'string' ? Date.parse(intent.requestedAt) : Number.NaN;
      if (!Number.isFinite(requestedAt) || Date.now() - requestedAt > ProcessManager.MCP_RESTART_INTENT_MAX_AGE_MS) return false;
      return Number(intent.port) === this.opts.mcpPort;
    } catch {
      return false;
    }
  }

  private static readonly MCP_RESTART_INTENT_MAX_AGE_MS = 60_000;
  private static readonly MANAGED_RESTART_DELAY_MS = 500;

  /** Respawn the MCP on its own port after a managed restart; the port is never switched. */
  private respawnMcpAfterManagedRestart(): void {
    const port = this.opts.mcpPort;
    const timer = setTimeout(async () => {
      if (this.stopped) return;
      try {
        const portFree = await this.waitForMcpPortFree(port, 5000);
        if (this.stopped) return;
        if (!portFree) {
          if (await this.checkMcpHealth(port)) {
            console.info(`[MindOS] External MCP now available on port ${port} — reusing`);
            this.externalMcp = true;
            this.mcpProcess = null;
            return;
          }
          console.error(`[MindOS:mcp] port ${port} still occupied after managed restart, cannot respawn`);
          this.emit('mcp-port-blocked', port);
          return;
        }
        const proc = this.spawnMcp();
        this.mcpProcess = proc;
        this.externalMcp = false;
        this.guardSpawnError(proc, 'mcp');
        this.setupCrashHandler(proc, 'mcp');
        this.writeChildPids();
        console.info(`[MindOS:mcp] respawned after managed restart on port ${port}`);
      } catch (err) {
        console.error('[MindOS:mcp] managed restart respawn failed:', err);
      }
    }, ProcessManager.MANAGED_RESTART_DELAY_MS);
    this.respawnTimers.push(timer);
  }

  /** Poll until `port` accepts a bind or `timeoutMs` passes; never falls back to another port. */
  private async waitForMcpPortFree(port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.stopped) return false;
      try {
        await this.findFreePort(port).then((free) => { if (free !== port) throw new Error('occupied'); });
        return true;
      } catch { /* still occupied */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
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

    const baseEnv = sanitizeChildEnv(this.opts.env || process.env);
    const env: Record<string, string> = {
      ...baseEnv,
      MCP_TRANSPORT: 'http', // Desktop always uses HTTP transport (not stdio). MCP clients must use http://127.0.0.1:<port>/mcp
      MCP_PORT: String(mcpPort),
      // Loopback by default: AUTH_TOKEN is optional, so binding all interfaces
      // exposed an unauthenticated MCP API to the LAN. MINDOS_MCP_HOST is the
      // explicit opt-in for non-loopback setups.
      MCP_HOST: baseEnv.MINDOS_MCP_HOST || '127.0.0.1',
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
      ...sanitizeChildEnv(this.opts.env || process.env),
      MINDOS_WEB_PORT: String(webPort),
      MINDOS_MCP_PORT: String(this.opts.mcpPort),
      MIND_ROOT: mindRoot,
      NODE_ENV: 'production',
      MINDOS_PROJECT_ROOT: projectRoot,
      MINDOS_CLI_PATH: resolveCliPath(projectRoot),
      MINDOS_MANAGED: '1',
      // /api/mcp/restart drops a marker here before killing the MCP so the
      // exit below is respawned as a restart instead of counted as a crash.
      MINDOS_MCP_RESTART_INTENT: ProcessManager.mcpRestartIntentFile(),
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

  /**
   * Whether child stdout/stderr should be mirrored into the main process log.
   *
   * This used to run unconditionally despite its "so DevTools shows crash
   * output" comment: every Next.js request line went through a main-process
   * console write (plus a synchronous appendFileSync under MINDOS_DESKTOP_CI_LOG),
   * on the thread that also drives the UI.
   */
  private shouldPipeChildOutput(): boolean {
    return Boolean(
      this.opts.verbose ||
      process.env.MINDOS_OPEN_DEVTOOLS === '1' ||
      process.env.MINDOS_DESKTOP_CI_LOG ||
      process.env.MINDOS_VERBOSE_CHILD_LOGS === '1',
    );
  }

  /** Forward child stdout/stderr so `MINDOS_OPEN_DEVTOOLS=1` terminal actually shows crash output. */
  private pipeChildOutput(proc: ChildProcess, label: string): void {
    if (!this.shouldPipeChildOutput()) {
      // stdout must still be drained or the pipe buffer fills and the child blocks.
      proc.stdout?.resume?.();
      return;
    }
    const tag = `[MindOS:${label}]`;
    proc.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        console.log(tag, line);
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
        const stat = statSync(logPath);
        if (stat.size > 100_000) {
          const lines = readFileSync(logPath, 'utf-8').split('\n');
          writeFileSync(logPath, lines.slice(-200).join('\n'), 'utf-8');
        }
      } catch { /* best effort */ }
    } catch { /* non-critical */ }
  }

  private setupCrashHandler(proc: ChildProcess, which: 'web' | 'mcp'): void {
    this.pipeChildOutput(proc, which);
    // Capture stderr for crash diagnostics — keep last ~2KB.
    // One listener does all three jobs (crash tail, per-process buffer, optional
    // console mirror); there used to be three separate 'data' listeners on the
    // same stream, each re-decoding and re-splitting every chunk.
    const stderrChunks: string[] = [];
    const mirror = this.shouldPipeChildOutput();
    const tag = `[MindOS:${which}]`;
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrChunks.push(text);
      // Keep only last 10 chunks (~2KB) to avoid unbounded growth
      if (stderrChunks.length > 10) stderrChunks.shift();
      const lines = text.split('\n').filter(Boolean);
      if (which === 'mcp') {
        this.mcpStderrLines.push(...lines);
        if (this.mcpStderrLines.length > 100) this.mcpStderrLines.splice(0, this.mcpStderrLines.length - 100);
      }
      if (mirror) {
        for (const line of lines) console.error(tag, line);
      }
    });
    const handler = (code: number | null, signal: string | null) => {
      console.error(`[MindOS:${which}] process exited code=${code} signal=${signal}`);
      if (which === 'web') this.webProcessDied = true;
      if (this.stopped) return;

      // /api/mcp/restart (managed mode) leaves an intent file, then kills the
      // MCP by port. That exit is a restart we own: respawn promptly and keep
      // crashCount untouched so three user-driven restarts never disable respawn.
      if (which === 'mcp' && this.consumeMcpRestartIntent()) {
        this.mcpRestartInProgress = false;
        this.emit('mcp-restart', this.opts.mcpPort);
        this.respawnMcpAfterManagedRestart();
        return;
      }

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

  // ── Orphan cleanup (implementation in process-cleanup.ts) ──

  /** Write current child PIDs to disk so next launch can clean up orphans. */
  private writeChildPids(): void {
    const pids: number[] = [];
    if (this.webProcess?.pid) pids.push(this.webProcess.pid);
    if (this.mcpProcess?.pid) pids.push(this.mcpProcess.pid);
    if (pids.length === 0) return;
    writeChildPidList(pids);
  }

  private writePidList(pids: number[]): void {
    writeChildPidList(pids);
  }

  private clearChildPids(): void {
    clearChildPidFile();
  }

  /*
    Kept as static entry points so callers (boot-heal, local-mode) and their
    contracts keep reading ProcessManager.cleanupOrphanedChildren() — the
    process layer's public surface did not change when the file was split.
  */
  static cleanupOrphanedChildren(): Promise<void> {
    return cleanupOrphanedChildren();
  }

  static cleanupCliPidFile(): Promise<void> {
    return cleanupCliPidFile();
  }

  static killProcessesOnPort(port: number): Promise<void> {
    return killProcessesOnPort(port);
  }
}

/**
 * SSH Tunnel — parse ~/.ssh/config and manage SSH port-forwarding tunnels.
 * Used by Remote mode to securely connect to MindOS servers without exposing ports.
 */
import { ChildProcess, execFile, execFileSync, spawn } from 'child_process';
import { readFileSync, existsSync, writeFileSync, unlinkSync, readdirSync } from 'fs';
import net from 'net';
import { randomBytes } from 'crypto';
import { promisify } from 'util';
import path from 'path';
import { app } from 'electron';
import { getDesktopConfigDir, getDesktopHome } from './desktop-home';

const execFileAsync = promisify(execFile);

/** Sentinel error message indicating passphrase is needed */
export const PASSPHRASE_NEEDED = '__PASSPHRASE_NEEDED__';

// PID file for SSH tunnel — allows cleanup of orphaned tunnels on next launch
function getSshTunnelPidFile(): string {
  return path.join(getDesktopConfigDir(), 'ssh-tunnel.pid');
}

type ExecFileSyncLike = (
  command: string,
  args: string[],
  options: { stdio?: 'ignore' | 'pipe'; encoding?: BufferEncoding; timeout: number; windowsHide?: boolean },
) => unknown;

function getWindowsSshCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  return [
    'ssh.exe',
    // Windows built-in OpenSSH lives in System32 — covers PATHs stripped by launchers
    ...(env.SystemRoot ? [path.join(env.SystemRoot, 'System32', 'OpenSSH', 'ssh.exe')] : []),
    ...(env.ProgramFiles ? [path.join(env.ProgramFiles, 'OpenSSH', 'ssh.exe')] : []),
    ...(env.ProgramFiles ? [path.join(env.ProgramFiles, 'Git', 'usr', 'bin', 'ssh.exe')] : []),
    ...(env.ProgramFiles ? [path.join(env.ProgramFiles, 'Git', 'bin', 'ssh.exe')] : []),
    ...(env['ProgramFiles(x86)'] ? [path.join(env['ProgramFiles(x86)'], 'Git', 'usr', 'bin', 'ssh.exe')] : []),
    ...(env.USERPROFILE ? [path.join(env.USERPROFILE, 'scoop', 'shims', 'ssh.exe')] : []),
  ];
}

export function resolveSshCommandForPlatform(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  execFile: ExecFileSyncLike = execFileSync,
): string | null {
  const candidates = platform === 'win32' ? getWindowsSshCandidates(env) : ['ssh'];
  for (const candidate of candidates) {
    try {
      execFile(candidate, ['-V'], { stdio: 'ignore', timeout: 3000, windowsHide: true });
      return candidate;
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

/**
 * Resolve ssh-add next to the resolved ssh binary. A bare 'ssh-add' fails on
 * exactly the machines where ssh itself was only found via the candidate list
 * (e.g. Git for Windows without its bin dir on PATH).
 */
export function resolveSshAddPath(
  sshCmd: string | null,
  platform: NodeJS.Platform = process.platform,
  fileExists: (p: string) => boolean = existsSync,
): string {
  // Platform-specific path semantics: win32 candidates use backslashes and
  // drive letters that posix path treats as relative
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (sshCmd && p.isAbsolute(sshCmd)) {
    const sibling = p.join(p.dirname(sshCmd), platform === 'win32' ? 'ssh-add.exe' : 'ssh-add');
    if (fileExists(sibling)) return sibling;
  }
  return 'ssh-add';
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildUnixAskpassScript(passphrase: string): string {
  return `#!/bin/sh
printf '%s\\n' ${shellSingleQuote(passphrase)}
`;
}

export function buildWindowsAskpassScript(passphrase: string): string {
  const encodedPassphrase = Buffer.from(passphrase, 'utf8').toString('base64');
  const powerShellCommand = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    `[Console]::Out.WriteLine([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encodedPassphrase}')))`,
  ].join('; ');
  const encodedCommand = Buffer.from(powerShellCommand, 'utf16le').toString('base64');
  return `@echo off\r\npowershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encodedCommand}\r\n`;
}

/** Write SSH child PID to disk so we can clean up orphans on next launch */
function writeTunnelPid(pid: number): void {
  try { writeFileSync(getSshTunnelPidFile(), String(pid), 'utf-8'); } catch { /* best effort */ }
}

/** Remove PID file when tunnel is intentionally stopped */
function clearTunnelPid(): void {
  const pidFile = getSshTunnelPidFile();
  try { if (existsSync(pidFile)) unlinkSync(pidFile); } catch { /* best effort */ }
}

/**
 * Verify a PID belongs to an ssh process — prevents killing an unrelated
 * process when the PID was reused since the tunnel pid file was written.
 * Conservative: any verification failure returns false (don't kill).
 */
export function verifyPidIsSshProcess(
  pid: number,
  platform: NodeJS.Platform = process.platform,
  execFile: ExecFileSyncLike = execFileSync,
): boolean {
  try {
    if (platform === 'win32') {
      const out = String(execFile('powershell.exe', [
        '-NoProfile', '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue).Name`,
      ], { encoding: 'utf-8', timeout: 3000, windowsHide: true }));
      return out.toLowerCase().includes('ssh');
    }
    const comm = String(execFile('ps', ['-p', String(pid), '-o', 'comm='], {
      encoding: 'utf-8',
      timeout: 2000,
      windowsHide: true,
    })).trim();
    return comm.includes('ssh');
  } catch {
    return false;
  }
}

/**
 * Kill any orphaned SSH tunnel from a previous Desktop session.
 * Call this once at app startup before starting new tunnels.
 */
export function cleanupOrphanedSshTunnel(): void {
  try {
    const pidFile = getSshTunnelPidFile();
    if (!existsSync(pidFile)) return;
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    if (!pid || isNaN(pid)) { clearTunnelPid(); return; }
    // Check if process is alive
    try {
      process.kill(pid, 0); // signal 0 = existence check
      // Verify it's actually an ssh process (avoid killing unrelated PID reuse)
      if (!verifyPidIsSshProcess(pid)) {
        clearTunnelPid();
        return;
      }
      console.warn(`[MindOS] Killing orphaned SSH tunnel (PID ${pid})`);
      process.kill(pid, 'SIGTERM');
      setTimeout(() => {
        try { process.kill(pid, 0); process.kill(pid); } catch { /* already dead */ }
      }, 2000);
    } catch {
      // Process already dead — just clean up the PID file
    }
    clearTunnelPid();
  } catch { /* non-critical */ }
}

export interface SshHost {
  name: string;
  hostname?: string;
  user?: string;
  port?: number;
  identityFile?: string;
}

/**
 * Parse ~/.ssh/config and return a list of configured hosts.
 * Excludes wildcard entries (* patterns).
 */
export function parseSshConfig(): SshHost[] {
  const configPath = path.join(getDesktopHome(), '.ssh', 'config');
  if (!existsSync(configPath)) return [];

  try {
    return parseSshConfigFile(configPath, new Set());
  } catch {
    return [];
  }
}

/**
 * Expand a leading `~/` (or bare `~`) to the home directory.
 * `~user/...` forms are passed through untouched — slicing them would mangle
 * the username; ssh resolves them natively.
 */
export function expandSshTilde(value: string, home: string): string {
  if (value === '~') return home;
  if (value.startsWith('~/')) return path.join(home, value.slice(2));
  return value;
}

/** Parse a single SSH config file, recursively resolving Include directives. */
function parseSshConfigFile(filePath: string, visited: Set<string>): SshHost[] {
  // Prevent infinite Include loops
  const resolved = path.resolve(filePath);
  if (visited.has(resolved)) return [];
  visited.add(resolved);

  if (!existsSync(resolved)) return [];

  const content = readFileSync(resolved, 'utf-8');
  const hosts: SshHost[] = [];
  let current: SshHost | null = null;
  const home = getDesktopHome();

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^(\w[\w-]*)\s+(.+)$/i);
    if (!match) continue;

    const [, key, value] = match;
    const k = key.toLowerCase();

    // Handle Include directive — resolve paths relative to ~/.ssh/
    if (k === 'include') {
      // Expand tilde and normalize path separators for this platform
      const expandedPath = expandSshTilde(value, home);
      // If not absolute, resolve relative to the directory of the current config file
      const absPattern = path.isAbsolute(expandedPath) ? expandedPath : path.join(path.dirname(resolved), expandedPath);
      try {
        // Simple glob: if pattern contains *, expand with readdirSync; otherwise treat as literal
        if (absPattern.includes('*')) {
          const dir = path.dirname(absPattern);
          const base = path.basename(absPattern);
          const regex = new RegExp('^' + base.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
          if (existsSync(dir)) {
            for (const f of readdirSync(dir)) {
              if (regex.test(f)) {
                hosts.push(...parseSshConfigFile(path.join(dir, f), visited));
              }
            }
          }
        } else {
          hosts.push(...parseSshConfigFile(absPattern, visited));
        }
      } catch { /* ignore unresolvable includes */ }
      continue;
    }

    if (k === 'host') {
      // Skip wildcards and patterns
      if (value.includes('*') || value.includes('?') || value.includes('!')) continue;
      // A Host line can have multiple space-separated aliases; take the first
      const name = value.split(/\s+/)[0];
      current = { name };
      hosts.push(current);
    } else if (current) {
      switch (k) {
        case 'hostname': current.hostname = value; break;
        case 'user': current.user = value; break;
        case 'port': current.port = parseInt(value, 10) || 22; break;
        case 'identityfile':
          // Expand tilde and normalize path separators for this platform
          current.identityFile = expandSshTilde(value, home);
          break;
      }
    }
  }

  return hosts;
}

/**
 * Check if ssh-agent has the key for `host` loaded.
 * Returns true if ssh-agent is running and the key test passes.
 */
export async function isSshAgentLoaded(host: string, sshCmd: string = 'ssh'): Promise<boolean> {
  try {
    // Try a quick connection with BatchMode=yes — if it doesn't fail with permission denied,
    // the key is loaded in ssh-agent
    await execFileAsync(sshCmd, [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=5',
      '-o', 'StrictHostKeyChecking=accept-new',
      host,
      'exit',
    ], { timeout: 8000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Add an SSH key to ssh-agent using ssh-add with a passphrase.
 * Uses SSH_ASKPASS mechanism to feed the passphrase non-interactively.
 * Returns true on success, false on failure.
 */
export async function addKeyToAgent(keyPath: string, passphrase: string): Promise<{ ok: boolean; error?: string }> {
  const home = getDesktopHome();
  // Resolve keyPath if relative
  const resolvedKey = path.isAbsolute(keyPath) ? keyPath : path.join(home, '.ssh', keyPath);
  // ssh-add must come from the same install as ssh — bare 'ssh-add' fails when
  // ssh was only found via the candidate list
  const sshAdd = resolveSshAddPath(resolveSshCommandForPlatform());
  // Random name + exclusive create: a predictable name in the shared temp dir
  // could be pre-planted (symlink) by another local user
  const askpassName = `mindos-askpass-${randomBytes(16).toString('hex')}`;

  if (process.platform === 'win32') {
    // On Windows, avoid putting the passphrase in cmd.exe syntax.
    const tmpScript = path.join(app.getPath('temp'), `${askpassName}.bat`);
    try {
      writeFileSync(tmpScript, buildWindowsAskpassScript(passphrase), { encoding: 'utf-8', flag: 'wx' });
      await execFileAsync(sshAdd, [resolvedKey], {
        timeout: 10000,
        windowsHide: true,
        env: { ...process.env, SSH_ASKPASS: tmpScript, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: ':0' },
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      try { unlinkSync(tmpScript); } catch { /* best effort */ }
    }
  }

  // Unix/macOS: use a temporary script as SSH_ASKPASS
  const tmpScript = path.join(app.getPath('temp'), `${askpassName}.sh`);
  try {
    // Create a script that outputs the passphrase without echo option parsing.
    // 0o700: must stay executable — ssh invokes it as SSH_ASKPASS.
    writeFileSync(tmpScript, buildUnixAskpassScript(passphrase), { mode: 0o700, flag: 'wx' });
    await execFileAsync(sshAdd, [resolvedKey], {
      timeout: 10000,
      windowsHide: true,
      env: { ...process.env, SSH_ASKPASS: tmpScript, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: ':0' },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    try { unlinkSync(tmpScript); } catch { /* best effort */ }
  }
}

/**
 * Check if ssh-agent is running and accessible.
 * On Unix/macOS: checks SSH_AUTH_SOCK env var.
 * On Windows: checks if the OpenSSH Authentication Agent service is running.
 */
export function isSshAgentRunning(): boolean {
  if (process.env.SSH_AUTH_SOCK) return true;
  if (process.platform === 'win32') {
    // On Windows, check if the OpenSSH agent service is running
    try {
      const out = String(execFileSync('sc', ['query', 'ssh-agent'], { encoding: 'utf-8', timeout: 3000, windowsHide: true }));
      return out.includes('RUNNING');
    } catch {
      return false;
    }
  }
  return false;
}

/** Check if the `ssh` command is available on this system */
export async function isSshAvailable(): Promise<boolean> {
  return resolveSshCommandForPlatform() !== null;
}

/**
 * Manages a single SSH port-forwarding tunnel.
 *
 * Spawns: ssh -L localPort:localhost:remotePort host -N
 *         -o ExitOnForwardFailure=yes
 *         -o ServerAliveInterval=15
 *         -o ServerAliveCountMax=3
 *         -o StrictHostKeyChecking=accept-new
 *         -o ConnectTimeout=10
 */
export class SshTunnel {
  private process: ChildProcess | null = null;
  private _host: string;
  private _localPort: number;
  private _remotePort: number;
  private stopped = false;
  /** Called when the tunnel process dies after a successful start. Not called if start() rejects. */
  onDeath?: () => void;

  constructor(host: string, localPort: number, remotePort: number) {
    this._host = host;
    this._localPort = localPort;
    this._remotePort = remotePort;
  }

  get host(): string { return this._host; }
  get localPort(): number { return this._localPort; }
  get remotePort(): number { return this._remotePort; }

  /** The last error message from a failed start() attempt */
  lastError = '';

  /**
   * Start the SSH tunnel. Resolves when the tunnel is established
   * (port forwarding active) or rejects on failure.
   *
   * If the SSH key requires a passphrase and none is cached in ssh-agent,
   * rejects with an Error whose message is PASSPHRASE_NEEDED.
   */
  async start(): Promise<void> {
    this.stopped = false;
    this.lastError = '';

    const sshCmd = resolveSshCommandForPlatform();
    if (!sshCmd) {
      throw new Error('SSH not found. Please install OpenSSH (e.g., via Git for Windows or Windows 10+ built-in OpenSSH).');
    }

    return new Promise((resolve, reject) => {
      const args = [
        '-L', `${this._localPort}:localhost:${this._remotePort}`,
        this._host,
        '-N',                                    // No remote command
        '-o', 'ExitOnForwardFailure=yes',        // Fail if port forward fails
        '-o', 'ServerAliveInterval=15',          // Keepalive every 15s
        '-o', 'ServerAliveCountMax=3',           // 3 missed = disconnect
        '-o', 'StrictHostKeyChecking=accept-new', // Auto-accept new host keys
        '-o', 'ConnectTimeout=10',               // 10s connection timeout
        '-o', 'BatchMode=yes',                   // Never prompt for password/passphrase
      ];

      this.process = spawn(sshCmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,  // Inherit env so SSH_AUTH_SOCK is available for ssh-agent
        windowsHide: true, // long-lived ssh -N would otherwise pin a visible console window
      });

      // Write PID to disk for orphan cleanup on next launch
      if (this.process.pid) writeTunnelPid(this.process.pid);

      let stderr = '';
      let settled = false;

      this.process.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      // SSH with -N doesn't produce stdout on success.
      // If it doesn't exit within 5s, probe the local port to confirm the tunnel is working.
      const successTimer = setTimeout(async () => {
        if (settled || this.stopped) return;
        // TCP probe: try to connect to the forwarded local port
        try {
          const probeOk = await new Promise<boolean>((probeResolve) => {
            const sock = net.createConnection({ host: '127.0.0.1', port: this.localPort, timeout: 3000 });
            sock.on('connect', () => { sock.destroy(); probeResolve(true); });
            sock.on('error', () => probeResolve(false));
            sock.on('timeout', () => { sock.destroy(); probeResolve(false); });
          });
          if (settled || this.stopped) return;
          if (probeOk) {
            settled = true;
            resolve();
          } else {
            // Port not responding yet — give it 3 more seconds then accept anyway
            // (some servers take time to start accepting after tunnel is up)
            setTimeout(() => {
              if (!settled && !this.stopped) {
                settled = true;
                resolve();
              }
            }, 3000);
          }
        } catch {
          // Probe failed — fall back to original behavior (trust the tunnel)
          if (!settled && !this.stopped) {
            settled = true;
            resolve();
          }
        }
      }, 5000);

      this.process.on('exit', (code) => {
        clearTimeout(successTimer);
        clearTunnelPid();
        const wasRunning = settled; // tunnel had been successfully started
        if (!settled) {
          settled = true;
          const msg = stderr.trim() || `SSH exited with code ${code}`;
          this.lastError = msg;
          // Detect passphrase-needed errors
          const lower = msg.toLowerCase();
          if (
            (lower.includes('permission denied') && !lower.includes('password')) ||
            lower.includes('no identities') ||
            lower.includes('identity file') ||
            lower.includes('load key')
          ) {
            reject(new Error(PASSPHRASE_NEEDED));
          } else {
            reject(new Error(msg));
          }
        }
        this.process = null;
        // Notify if tunnel died after successful start (not during startup or explicit stop)
        if (wasRunning && !this.stopped) {
          console.warn(`[MindOS:ssh] tunnel to ${this._host} died (code=${code})`);
          this.onDeath?.();
        }
      });

      this.process.on('error', (err) => {
        clearTimeout(successTimer);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
    });
  }

  /** Gracefully stop the SSH tunnel */
  async stop(): Promise<void> {
    this.stopped = true;
    clearTunnelPid();
    if (!this.process || this.process.killed) return;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { this.process?.kill(); } catch { /* dead */ }
        resolve();
      }, 3000);

      this.process!.once('exit', () => {
        clearTimeout(timer);
        this.process = null;
        resolve();
      });

      try { this.process!.kill('SIGTERM'); } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  isAlive(): boolean {
    return !!this.process && !this.process.killed;
  }
}

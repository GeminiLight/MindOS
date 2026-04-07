/**
 * SSH Tunnel — parse ~/.ssh/config and manage SSH port-forwarding tunnels.
 * Used by Remote mode to securely connect to MindOS servers without exposing ports.
 */
import { ChildProcess, spawn } from 'child_process';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { app } from 'electron';

const execAsync = promisify(exec);

// PID file for SSH tunnel — allows cleanup of orphaned tunnels on next launch
const SSH_TUNNEL_PID_FILE = path.join(app.getPath('home'), '.mindos', 'ssh-tunnel.pid');

/** Write SSH child PID to disk so we can clean up orphans on next launch */
function writeTunnelPid(pid: number): void {
  try { writeFileSync(SSH_TUNNEL_PID_FILE, String(pid), 'utf-8'); } catch { /* best effort */ }
}

/** Remove PID file when tunnel is intentionally stopped */
function clearTunnelPid(): void {
  try { if (existsSync(SSH_TUNNEL_PID_FILE)) unlinkSync(SSH_TUNNEL_PID_FILE); } catch { /* best effort */ }
}

/**
 * Kill any orphaned SSH tunnel from a previous Desktop session.
 * Call this once at app startup before starting new tunnels.
 */
export function cleanupOrphanedSshTunnel(): void {
  try {
    if (!existsSync(SSH_TUNNEL_PID_FILE)) return;
    const pid = parseInt(readFileSync(SSH_TUNNEL_PID_FILE, 'utf-8').trim(), 10);
    if (!pid || isNaN(pid)) { clearTunnelPid(); return; }
    // Check if process is alive
    try {
      process.kill(pid, 0); // signal 0 = existence check
      // Verify it's actually an ssh process (avoid killing unrelated PID reuse)
      if (process.platform !== 'win32') {
        try {
          const { execSync } = require('child_process');
          const comm = execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf-8', timeout: 2000 }).trim();
          if (!comm.includes('ssh')) {
            // PID was reused by a non-ssh process — don't kill it
            clearTunnelPid();
            return;
          }
        } catch { /* ps failed — conservative: don't kill */ clearTunnelPid(); return; }
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
  const configPath = path.join(app.getPath('home'), '.ssh', 'config');
  if (!existsSync(configPath)) return [];

  try {
    return parseSshConfigFile(configPath, new Set());
  } catch {
    return [];
  }
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
  const home = app.getPath('home');

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^(\w[\w-]*)\s+(.+)$/i);
    if (!match) continue;

    const [, key, value] = match;
    const k = key.toLowerCase();

    // Handle Include directive — resolve paths relative to ~/.ssh/
    if (k === 'include') {
      const pattern = value.replace(/^~\//, home + '/').replace(/^~(?=[/\\])/, home);
      // If not absolute, resolve relative to the directory of the current config file
      const absPattern = path.isAbsolute(pattern) ? pattern : path.join(path.dirname(resolved), pattern);
      try {
        // Simple glob: if pattern contains *, expand with readdirSync; otherwise treat as literal
        if (absPattern.includes('*')) {
          const dir = path.dirname(absPattern);
          const base = path.basename(absPattern);
          const regex = new RegExp('^' + base.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
          if (existsSync(dir)) {
            const { readdirSync: rd } = require('fs');
            for (const f of rd(dir) as string[]) {
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
        case 'identityfile': current.identityFile = value.replace(/^~/, home); break;
      }
    }
  }

  return hosts;
}

/** Check if the `ssh` command is available on this system */
export async function isSshAvailable(): Promise<boolean> {
  try {
    await execAsync('ssh -V 2>&1', { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
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

  /**
   * Start the SSH tunnel. Resolves when the tunnel is established
   * (port forwarding active) or rejects on failure.
   */
  start(): Promise<void> {
    this.stopped = false;

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

      this.process = spawn(process.platform === 'win32' ? 'ssh.exe' : 'ssh', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
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
          const net = require('net');
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
          reject(new Error(msg));
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

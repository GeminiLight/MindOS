/**
 * SSH Tunnel — parse ~/.ssh/config and manage SSH port-forwarding tunnels.
 * Used by Remote mode to securely connect to MindOS servers without exposing ports.
 */
import { ChildProcess, spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { app } from 'electron';

const execAsync = promisify(exec);

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
    const content = readFileSync(configPath, 'utf-8');
    const hosts: SshHost[] = [];
    let current: SshHost | null = null;

    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const match = line.match(/^(\w+)\s+(.+)$/i);
      if (!match) continue;

      const [, key, value] = match;
      const k = key.toLowerCase();

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
          case 'identityfile': current.identityFile = value.replace(/^~/, app.getPath('home')); break;
        }
      }
    }

    return hosts;
  } catch {
    return [];
  }
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

      this.process = spawn('ssh', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      let settled = false;

      this.process.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      // SSH with -N doesn't produce stdout on success.
      // If it doesn't exit within 5s, the tunnel is up.
      const successTimer = setTimeout(() => {
        if (!settled && !this.stopped) {
          settled = true;
          resolve();
        }
      }, 5000);

      this.process.on('exit', (code) => {
        clearTimeout(successTimer);
        if (!settled) {
          settled = true;
          const msg = stderr.trim() || `SSH exited with code ${code}`;
          reject(new Error(msg));
        }
        this.process = null;
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
    if (!this.process || this.process.killed) return;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { this.process?.kill('SIGKILL'); } catch { /* dead */ }
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

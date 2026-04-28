/**
 * Connection monitor — periodic health checks for remote mode.
 * Detects disconnection and auto-reconnects with exponential backoff.
 */
import http from 'http';
import https from 'https';

interface ConnectionMonitorCallbacks {
  onLost: () => void;
  onRestored: () => void;
}

export class ConnectionMonitor {
  private address: string;
  private callbacks: ConnectionMonitorCallbacks;
  private interval: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private isConnected = true;
  private retryCount = 0;
  private stopped = false;

  constructor(address: string, callbacks: ConnectionMonitorCallbacks) {
    this.address = address;
    this.callbacks = callbacks;
  }

  /** Start periodic health checks (every 30s) */
  start(): void {
    this.stop();
    this.isConnected = true;
    this.retryCount = 0;
    this.stopped = false;

    this.interval = setInterval(() => this.check(), 30_000);
    this.initialTimer = setTimeout(() => this.check(), 5000);
  }

  stop(): void {
    this.stopped = true;
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.initialTimer) { clearTimeout(this.initialTimer); this.initialTimer = null; }
  }

  private check(): void {
    if (this.stopped) return;

    let url: URL;
    try {
      url = new URL(this.address);
    } catch {
      this.handleDisconnect();
      return;
    }

    const isHttps = url.protocol === 'https:';
    const port = parseInt(url.port || (isHttps ? '443' : '3456'), 10);
    const transport = isHttps ? https : http;

    const req = transport.get({
      hostname: url.hostname,
      port,
      path: '/api/health',
      timeout: 5000,
    }, (res) => {
      if (res.statusCode === 200) {
        if (!this.isConnected) {
          this.isConnected = true;
          this.retryCount = 0;
          // Restart periodic interval
          if (!this.interval && !this.stopped) {
            this.interval = setInterval(() => this.check(), 30_000);
          }
          this.callbacks.onRestored();
        }
      } else {
        this.handleDisconnect();
      }
      res.resume();
    });

    req.on('error', () => this.handleDisconnect());
    req.on('timeout', () => {
      req.destroy();
      this.handleDisconnect();
    });
  }

  private handleDisconnect(): void {
    if (this.stopped) return;

    if (this.isConnected) {
      this.isConnected = false;
      // Stop periodic interval — use retry timer only while disconnected
      if (this.interval) { clearInterval(this.interval); this.interval = null; }
      this.callbacks.onLost();
    }

    // Exponential backoff: 1s, 3s, 10s, 30s
    this.retryCount++;
    const delays = [1000, 3000, 10000, 30000];
    const delay = delays[Math.min(this.retryCount - 1, delays.length - 1)];

    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.check(), delay);
  }
}

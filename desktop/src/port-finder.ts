/**
 * Port finder — detect available ports using the bind approach.
 * This is the canonical Node.js pattern: try to listen → success = free, EADDRINUSE = taken.
 */
import net from 'net';

/** Check if a port is in use on localhost (bind approach — no false positives) */
export function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      // EADDRINUSE = port taken; EACCES = no permission (treat as taken)
      resolve(true);
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(false));
    });
  });
}

/**
 * Find an available port starting from the given port.
 * Tries up to 30 consecutive ports, clamped to valid range (1-65535).
 */
export async function findAvailablePort(start: number, maxAttempts = 30): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = start + i;
    if (port > 65535) break; // Don't try invalid ports
    const inUse = await isPortInUse(port);
    if (!inUse) return port;
  }
  const end = Math.min(start + maxAttempts - 1, 65535);
  const err = new Error(`No available port found in range ${start}-${end}`);
  (err as Error & { code: string }).code = 'ERR_NO_PORT';
  throw err;
}

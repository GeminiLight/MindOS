import { describe, it, expect, afterEach } from 'vitest';
import { createServer, Server } from 'net';

/**
 * Tests for bin/lib/port.js — isPortInUse.
 * Uses real TCP servers to verify port detection accuracy.
 */

// Dynamic import to match ESM module
async function importPort() {
  return await import('../../bin/lib/port.js') as {
    isPortInUse: (port: number) => Promise<boolean>;
  };
}

let server: Server | null = null;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => {
      server!.close(() => resolve());
    });
    server = null;
  }
});

function startServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address();
      if (addr && typeof addr === 'object') {
        resolve(addr.port);
      } else {
        reject(new Error('Could not get server port'));
      }
    });
    server.on('error', reject);
  });
}

describe('isPortInUse', () => {
  it('returns false for an unused port', async () => {
    const { isPortInUse } = await importPort();
    // Use a random high port that's very unlikely to be in use
    // First find one by binding and immediately releasing
    const tmpServer = createServer();
    const port = await new Promise<number>((resolve, reject) => {
      tmpServer.listen(0, '127.0.0.1', () => {
        const addr = tmpServer.address();
        if (addr && typeof addr === 'object') {
          const p = addr.port;
          tmpServer.close(() => resolve(p));
        } else {
          reject(new Error('no addr'));
        }
      });
    });
    const result = await isPortInUse(port);
    expect(result).toBe(false);
  });

  it('returns true when a server is listening on the port', async () => {
    const port = await startServer();
    const { isPortInUse } = await importPort();
    const result = await isPortInUse(port);
    expect(result).toBe(true);
  });

  it('returns false after server is closed', async () => {
    const port = await startServer();
    const { isPortInUse } = await importPort();

    // Verify it's in use first
    expect(await isPortInUse(port)).toBe(true);

    // Close the server
    await new Promise<void>((resolve) => {
      server!.close(() => resolve());
    });
    server = null;

    // Now should be free
    const result = await isPortInUse(port);
    expect(result).toBe(false);
  });
});

import { createConnection } from 'node:net';
import { json, type MindosServerResponse } from '../response.js';

export type SetupCheckPortOptions = {
  myWebPort?: number;
  myMcpPort?: number;
  isPortInUse?: (port: number) => Promise<boolean>;
  isSelfPort?: (port: number) => Promise<boolean>;
  findFreePort?: (start: number, skipPorts: Set<number>) => Promise<number | null>;
};

export type SetupCheckPortPayload =
  | { available: true; isSelf: boolean }
  | { available: false; isSelf: false; suggestion: number | null };

export async function handleSetupCheckPort(
  body: unknown,
  options: SetupCheckPortOptions = {},
): Promise<MindosServerResponse<SetupCheckPortPayload | { error: string }>> {
  const port = body && typeof body === 'object' ? Number((body as { port?: unknown }).port) : 0;
  if (!port || port < 1024 || port > 65535) {
    return json({ error: 'Invalid port' }, { status: 400 });
  }

  if ((options.myWebPort && port === options.myWebPort) || (options.myMcpPort && port === options.myMcpPort)) {
    return json({ available: true, isSelf: true });
  }

  const isPortInUse = options.isPortInUse ?? defaultIsPortInUse;
  if (!await isPortInUse(port)) {
    return json({ available: true, isSelf: false });
  }

  const isSelfPort = options.isSelfPort ?? defaultIsSelfPort;
  if (await isSelfPort(port)) {
    return json({ available: true, isSelf: true });
  }

  const skipPorts = new Set<number>();
  if (options.myWebPort) skipPorts.add(options.myWebPort);
  if (options.myMcpPort) skipPorts.add(options.myMcpPort);
  const findFreePort = options.findFreePort ?? defaultFindFreePort;
  return json({
    available: false,
    isSelf: false,
    suggestion: await findFreePort(port + 1, skipPorts),
  });
}

async function defaultIsPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    const cleanup = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(500, () => cleanup(true));
    socket.once('connect', () => cleanup(true));
    socket.once('error', (error: NodeJS.ErrnoException) => {
      resolve(error.code !== 'ECONNREFUSED');
    });
  });
}

async function defaultIsSelfPort(port: number): Promise<boolean> {
  for (const host of ['127.0.0.1', 'localhost']) {
    try {
      const response = await fetch(`http://${host}:${port}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) continue;
      const data = await response.json() as { service?: unknown };
      if (data.service === 'mindos') return true;
    } catch {
      // Try next host.
    }
  }
  return false;
}

async function defaultFindFreePort(start: number, skipPorts: Set<number>): Promise<number | null> {
  for (let port = start; port <= 65535; port++) {
    if (skipPorts.has(port)) continue;
    if (!await defaultIsPortInUse(port)) return port;
  }
  return null;
}

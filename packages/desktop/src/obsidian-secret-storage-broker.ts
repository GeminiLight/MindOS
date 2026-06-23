import { safeStorage } from 'electron';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { randomBytes } from 'crypto';
import { once } from 'events';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 0;
const DEFAULT_MAX_BODY_BYTES = 256 * 1024;
const ENCRYPT_PATH = '/v1/obsidian-secret-storage/encrypt';
const DECRYPT_PATH = '/v1/obsidian-secret-storage/decrypt';

export interface ObsidianSecretStorageBrokerHandle {
  url: string;
  token: string;
  close(): Promise<void>;
}

export interface StartObsidianSecretStorageBrokerOptions {
  host?: string;
  port?: number;
  maxBodyBytes?: number;
}

export async function startObsidianSecretStorageBroker(
  options: StartObsidianSecretStorageBrokerOptions = {},
): Promise<ObsidianSecretStorageBrokerHandle | null> {
  if (!safeStorage.isEncryptionAvailable()) {
    return null;
  }

  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const token = randomBytes(32).toString('base64url');
  const server = createServer((req, res) => {
    handleRequest(req, res, token, maxBodyBytes).catch(() => {
      sendJson(res, 500, { ok: false, error: 'internal-error' });
    });
  });

  server.listen(port, host);
  await once(server, 'listening');

  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server);
    throw new Error('[MindOS] Obsidian SecretStorage broker failed to bind to a loopback port.');
  }

  return {
    url: `http://${host}:${address.port}`,
    token,
    close: () => closeServer(server),
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  maxBodyBytes: number,
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
    return;
  }

  if (req.headers.authorization !== `Bearer ${token}`) {
    sendJson(res, 401, { ok: false, error: 'unauthorized' });
    return;
  }

  if (!isJsonContentType(req.headers['content-type'])) {
    sendJson(res, 415, { ok: false, error: 'unsupported-media-type' });
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await readBody(req, maxBodyBytes));
  } catch (err) {
    const tooLarge = err instanceof Error && err.message === 'request-too-large';
    sendJson(res, tooLarge ? 413 : 400, { ok: false, error: tooLarge ? 'request-too-large' : 'invalid-json' });
    return;
  }

  if (req.url === ENCRYPT_PATH) {
    const plaintext = readStringField(payload, 'plaintext');
    if (plaintext === null) {
      sendJson(res, 400, { ok: false, error: 'invalid-request' });
      return;
    }
    try {
      const data = safeStorage.encryptString(plaintext).toString('base64');
      sendJson(res, 200, { ok: true, data });
    } catch {
      sendJson(res, 500, { ok: false, error: 'encrypt-failed' });
    }
    return;
  }

  if (req.url === DECRYPT_PATH) {
    const data = readStringField(payload, 'data');
    if (data === null) {
      sendJson(res, 400, { ok: false, error: 'invalid-request' });
      return;
    }
    try {
      const plaintext = safeStorage.decryptString(Buffer.from(data, 'base64'));
      sendJson(res, 200, { ok: true, plaintext });
    } catch {
      sendJson(res, 500, { ok: false, error: 'decrypt-failed' });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not-found' });
}

function isJsonContentType(contentType: string | string[] | undefined): boolean {
  if (Array.isArray(contentType)) return contentType.some(isJsonContentType);
  return typeof contentType === 'string'
    && contentType.toLowerCase().split(';', 1)[0].trim() === 'application/json';
}

function readBody(req: IncomingMessage, maxBodyBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;

    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxBodyBytes) {
        tooLarge = true;
        reject(new Error('request-too-large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    req.on('error', (err) => {
      if (!tooLarge) reject(err);
    });
  });
}

function readStringField(payload: unknown, field: string): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : null;
}

function sendJson(res: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  if (res.headersSent) return;
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

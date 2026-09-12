import '../../../packages/mindos/src/server/handlers/change-log-store';
import { readPluginData, writePluginData } from '../../../packages/mindos/src/server/plugin-data-store';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleFileGet, handleFilePost } from '../../../packages/mindos/src/server/handlers/file';
import { resolveExistingSafe } from '../../../packages/mindos/src/foundation/security/index';
import { appendContentChange } from '../../../packages/mindos/src/knowledge/audit/index';
import { LocalFileSystem } from '../../../packages/mindos/src/knowledge/storage/local';
import { readPluginPackageSnapshot } from '../../../packages/mindos/src/server/plugin-package-snapshot';
import { readPluginVaultSnapshot } from '../../../packages/mindos/src/server/plugin-vault-snapshot';

/** Real product handlers over loopback HTTP; only temporary fixture files are writable. */
export async function startObsidianFileFixture(options: { ownerPage?: string; afterSave?: () => Promise<void> } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mindos-obsidian-save-'));
  const token = randomBytes(24).toString('hex');
  const server = createServer(async (request, response) => {
    // Optional test-only owner document; product API requests still require the token.
    if (request.url === '/_fixture-owner' && options.ownerPage) {
      response.writeHead(200, { 'content-type': 'text/html' }).end(options.ownerPage); return;
    }
    response.setHeader('content-type', 'application/json');
    try {
      if (request.headers.authorization !== `Bearer ${token}`) {
        response.writeHead(401).end(JSON.stringify({ error: 'Unauthorized' })); return;
      }
      const url = new URL(request.url!, 'http://localhost');
      if (url.pathname === '/api/obsidian-plugins/data') {
        if (request.method === 'GET') {
          response.writeHead(200).end(JSON.stringify(readPluginData(root, Object.fromEntries(url.searchParams) as any))); return;
        }
        const chunks: Buffer[] = []; let length = 0;
        for await (const chunk of request) { length += chunk.length; if (length > 1024 * 1024 + 4096) throw new Error('Body too large'); chunks.push(chunk); }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        response.writeHead(200).end(JSON.stringify(writePluginData(root, body, body.revision, body.data))); return;
      }
      if (url.pathname === '/api/obsidian-plugins/vault' && request.method === 'GET') {
        const snapshot = readPluginVaultSnapshot(root, { pluginId: url.searchParams.get('pluginId')!,
          vaultId: url.searchParams.get('vaultId')!, fingerprint: url.searchParams.get('fingerprint')! });
        response.writeHead(200).end(JSON.stringify(snapshot)); return;
      }
      // Thin fixture transport around the real Product byte reader. The actual
      // Next route's validation/legacy selection has separate Web API tests.
      if (url.pathname === '/api/obsidian-plugins/package' && request.method === 'GET') {
        const snapshot = readPluginPackageSnapshot(root, `.mindos/plugins/${url.searchParams.get('pluginId')}`);
        const fingerprint = url.searchParams.get('fingerprint');
        if (fingerprint !== null && (fingerprint !== snapshot.fingerprint || url.searchParams.get('vaultId') !== snapshot.vaultId)) {
          response.writeHead(409).end(JSON.stringify({ error: 'package_changed' })); return;
        }
        const manifest = JSON.parse(Buffer.from(snapshot.files.find(file => file.path === 'manifest.json')!.base64, 'base64').toString('utf8'));
        const { files, ...metadata } = snapshot;
        response.writeHead(200).end(JSON.stringify({ ...metadata, manifest,
          assets: files.map(({ base64: _, ...asset }) => asset), ...(fingerprint !== null ? { files } : {}),
        })); return;
      }
      if (url.pathname !== '/api/file') {
        response.writeHead(404).end(JSON.stringify({ error: 'Not found' })); return;
      }
      let result;
      if (request.method === 'GET') {
        result = handleFileGet(url.searchParams, {
          mindRoot: root,
          readTextFile: file => readFileSync(resolveExistingSafe(root, file), 'utf8'),
          readLines: () => [], listSpaces: () => [], listDirectories: () => [],
        });
      } else if (request.method === 'POST') {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 8 * 1024 * 1024) throw new Error('Fixture request too large');
          chunks.push(chunk);
        }
        const agentName = String(request.headers['x-mindos-agent'] ?? '');
        result = await handleFilePost(JSON.parse(Buffer.concat(chunks).toString('utf8')), { mindRoot: root }, { agentHeader: agentName });
        if (result.changeEvent) {
          const audit = await appendContentChange(new LocalFileSystem(), root, { ...result.changeEvent, source: result.source ?? 'agent', agentName });
          if (!audit.ok) throw audit.error;
        }
        await options.afterSave?.();
      } else {
        response.writeHead(405).end(JSON.stringify({ error: 'Method not allowed' })); return;
      }
      response.writeHead(result.status).end(JSON.stringify(result.body));
    } catch (error) {
      response.writeHead(500).end(JSON.stringify({ error: (error as Error).message }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as { port: number }).port;
  return {
    root, token, baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      rmSync(root, { recursive: true, force: true });
    },
  };
}

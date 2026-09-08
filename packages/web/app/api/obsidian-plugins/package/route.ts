export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { readPluginPackageSnapshot } from '@geminilight/mindos/server';
import { readSettings } from '@/lib/settings';
import { validateManifest } from '@/lib/obsidian-compat/manifest';

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'private, no-store' } });

/** Read-only approval subject. Does not approve, enable, load or execute a plugin. */
export async function GET(request: NextRequest) {
  const pluginId = request.nextUrl.searchParams.get('pluginId');
  const expected = request.nextUrl.searchParams.get('fingerprint');
  const expectedVaultId = request.nextUrl.searchParams.get('vaultId');
  if (!pluginId || !/^[a-zA-Z0-9_-]{1,64}$/.test(pluginId)) return reply({ error: 'Invalid pluginId' }, 400);
  if (expected !== null && !/^[a-f0-9]{64}$/.test(expected)) return reply({ error: 'Invalid fingerprint' }, 400);
  if ((expected !== null || expectedVaultId !== null) && (!expectedVaultId || !/^[a-f0-9]{64}$/.test(expectedVaultId))) return reply({ error: 'Missing or invalid vaultId' }, 400);
  try {
    const { mindRoot } = readSettings();
    let snapshot;
    try { snapshot = readPluginPackageSnapshot(mindRoot, `.mindos/plugins/${pluginId}`); } catch (error) {
      // An unsafe or unreadable canonical package must not silently select an older one.
      if ((error as NodeJS.ErrnoException).code !== 'PLUGIN_PACKAGE_NOT_FOUND') throw error;
      snapshot = readPluginPackageSnapshot(mindRoot, `.plugins/${pluginId}`);
    }
    if (expectedVaultId !== null && expectedVaultId !== snapshot.vaultId) return reply({ error: 'vault_changed' }, 409);
    const manifestFile = snapshot.files.find(file => file.path === 'manifest.json');
    const mainFile = snapshot.files.find(file => file.path === 'main.js');
    if (!manifestFile || !mainFile) return reply({ error: 'Package requires manifest.json and main.js' }, 400);
    if (manifestFile.size > 64 * 1024) return reply({ error: 'Manifest size limit exceeded' }, 400);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const manifest = validateManifest(JSON.parse(decoder.decode(Buffer.from(manifestFile.base64, 'base64'))));
    if (manifest.id !== pluginId) return reply({ error: 'Plugin manifest identity mismatch' }, 400);
    decoder.decode(Buffer.from(mainFile.base64, 'base64'));
    if (expected !== null && expected !== snapshot.fingerprint) return reply({ error: 'package_changed' }, 409);
    return reply({
      manifest, vaultId: snapshot.vaultId, fingerprint: snapshot.fingerprint, totalBytes: snapshot.totalBytes,
      assets: snapshot.files.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
      ...(expected !== null ? { files: snapshot.files } : {}),
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'PLUGIN_PACKAGE_NOT_FOUND') return reply({ error: 'Plugin package not found' }, 404);
    if (code === 'EACCES' || code === 'EPERM') return reply({ error: 'Plugin package is not readable' }, 403);
    // Do not return absolute filesystem paths or loader internals to callers.
    return reply({ error: 'Invalid, unsafe, oversized, or changing plugin package' }, 400);
  }
}

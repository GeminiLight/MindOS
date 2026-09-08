export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { readPluginVaultSnapshot } from '@geminilight/mindos/server';
import { readSettings } from '@/lib/settings';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'private, no-store' } });
/** Standard authenticated API; native session consent is enforced by the main-process caller. */
export async function GET(request: NextRequest) {
  const pluginId = request.nextUrl.searchParams.get('pluginId');
  const vaultId = request.nextUrl.searchParams.get('vaultId');
  const fingerprint = request.nextUrl.searchParams.get('fingerprint');
  if (!pluginId || !/^[a-zA-Z0-9_-]{1,64}$/.test(pluginId) || !vaultId || !/^[a-f0-9]{64}$/.test(vaultId)
    || !fingerprint || !/^[a-f0-9]{64}$/.test(fingerprint)) return reply({ error: 'Invalid approval subject' }, 400);
  try {
    return reply(readPluginVaultSnapshot(readSettings().mindRoot, { pluginId, vaultId, fingerprint }));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'VAULT_SUBJECT_CHANGED') return reply({ error: 'approval_subject_changed' }, 409);
    if (code === 'PLUGIN_PACKAGE_NOT_FOUND') return reply({ error: 'Plugin package not found' }, 404);
    if (code === 'EACCES' || code === 'EPERM') return reply({ error: 'Vault is not readable' }, 403);
    return reply({ error: 'Invalid, unsafe, oversized, or changing Vault' }, 400);
  }
}

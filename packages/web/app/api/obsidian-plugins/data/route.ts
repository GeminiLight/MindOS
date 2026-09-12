import { isSafePluginIdentifier } from '@geminilight/mindos/foundation';
import { NextRequest, NextResponse } from 'next/server';
import { readPluginData, writePluginData, type PluginDataBinding } from '@geminilight/mindos/server';
import { readSettings } from '@/lib/settings';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'private, no-store' } });
function binding(value: Record<string, unknown>): PluginDataBinding {
  if (typeof value.pluginId !== 'string' || !isSafePluginIdentifier(value.pluginId, { allowDots: false })
    || typeof value.vaultId !== 'string' || !/^[a-f0-9]{64}$/.test(value.vaultId)
    || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint)) throw new Error('Invalid binding');
  return { pluginId: value.pluginId, vaultId: value.vaultId, fingerprint: value.fingerprint };
}
function failure(error: unknown) {
  if ((error as NodeJS.ErrnoException).code === 'PLUGIN_DATA_CONFLICT') return reply({ error: 'configuration_conflict' }, 409);
  // No settings, credentials, absolute paths, or raw filesystem errors in replies.
  return reply({ error: 'invalid_or_changed_plugin_configuration' }, 400);
}
export async function GET(request: NextRequest) {
  try { return reply(readPluginData(readSettings().mindRoot, binding(Object.fromEntries(request.nextUrl.searchParams)))); }
  catch (error) { return failure(error); }
}
async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing body');
  const buffer = new Uint8Array(1024 * 1024 + 4096); let length = 0;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read(); signal.throwIfAborted();
      if (done) break;
      if (value.length > buffer.length - length) throw new Error('Body limit');
      buffer.set(value, length); length += value.length;
    }
    const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid body');
    return data as Record<string, unknown>;
  } finally { signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock(); }
}
export async function POST(request: NextRequest) {
  try {
    const body = await readBody(request);
    if (Object.keys(body).some(key => !['pluginId', 'vaultId', 'fingerprint', 'revision', 'data'].includes(key)) || typeof body.revision !== 'string' || !Object.hasOwn(body, 'data')) throw new Error('Invalid request');
    return reply(writePluginData(readSettings().mindRoot, binding(body), body.revision, body.data));
  } catch (error) { return failure(error); }
}

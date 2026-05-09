export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { handleMcpStatus } from '@geminilight/mindos/server';
import { readSettings } from '@/lib/settings';
import { maskToken } from '@/lib/format';
import { networkInterfaces } from 'os';
import { toNextResponse } from '../../_mindos-adapter';

/** Get first non-internal IPv4 address */
function getLocalIP(): string | null {
  try {
    for (const ifaces of Object.values(networkInterfaces())) {
      for (const iface of ifaces ?? []) {
        if (iface.family === 'IPv4' && !iface.internal) return iface.address;
      }
    }
  } catch { /* ignore */ }
  return null;
}

export async function GET(req: NextRequest) {
  return toNextResponse(await handleMcpStatus({
    env: process.env,
    readSettings,
    getLocalIP,
    maskToken,
    fetchHealth: async (url, timeoutMs) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        return {
          ok: res.ok,
          body: res.ok ? await res.json() as { ok?: boolean; service?: string } : undefined,
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  }, {
    host: req.headers.get('host'),
  }));
}

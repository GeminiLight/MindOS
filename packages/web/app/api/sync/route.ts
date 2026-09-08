export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { getMindosServerEventBus, handleSyncGet, handleSyncPost } from '@geminilight/mindos/server';
import { toNextResponse } from '../_mindos-adapter';

export async function GET() {
  return toNextResponse(await handleSyncGet());
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return toNextResponse(await handleSyncPost(body, {
    ...(await getSyncRuntimeServices()),
    events: getMindosServerEventBus(),
  } as any));
}

async function getSyncRuntimeServices(): Promise<Record<string, unknown>> {
  if (process.env.NEXT_RUNTIME === 'edge') return {};
  try {
    const { resolveMindosCliLibPath } = await import('@/lib/project-root');
    const syncModule = resolveMindosCliLibPath('sync.js');
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const dynamicRequire = new Function('id', 'return require(id)') as (id: string) => any;
    const { startSyncDaemon, stopSyncDaemon } = dynamicRequire(syncModule);
    return {
      syncDaemon: {
        start: (mindRoot: string) => { void startSyncDaemon(mindRoot).catch(() => {}); },
        stop: () => { try { stopSyncDaemon(); } catch {} },
        reconfigure: (mindRoot: string) => { void startSyncDaemon(mindRoot).catch(() => {}); },
        restart: (mindRoot: string) => {
          try { stopSyncDaemon(); } catch {}
          void startSyncDaemon(mindRoot).catch(() => {});
        },
      },
    };
  } catch {
    return {};
  }
}

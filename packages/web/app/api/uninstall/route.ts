export const dynamic = 'force-dynamic';
import { handleUninstallPost } from '@geminilight/mindos/server';
import { toNextResponse } from '../_mindos-adapter';

/**
 * POST /api/uninstall
 *
 * Accepts JSON body: { removeConfig?: boolean }
 *
 * Always: stops services + removes daemon + npm uninstall -g.
 * Optionally: removes ~/.mindos/ config directory.
 * Knowledge base is NEVER touched from the Web UI.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return toNextResponse(handleUninstallPost(body));
}

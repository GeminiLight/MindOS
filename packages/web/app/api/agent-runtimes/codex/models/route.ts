export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { handleCodexModelsGet } from '@geminilight/mindos/server';
import { toNextResponse } from '@/app/api/_mindos-adapter';
import { codexThreadServices } from '../_services';

export async function GET() {
  return toNextResponse(await handleCodexModelsGet(codexThreadServices));
}

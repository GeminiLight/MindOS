export const dynamic = 'force-dynamic';

import { handleUpdateStatusGet } from '@geminilight/mindos/server';
import { toNextResponse } from '../_mindos-adapter';

export function GET() {
  return toNextResponse(handleUpdateStatusGet());
}

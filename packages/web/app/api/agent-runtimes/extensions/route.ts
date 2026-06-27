export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import {
  handleAgentRuntimeExtensionsGet,
  type RuntimeExtensionServices,
} from '@geminilight/mindos/server';
import { readSettings } from '@/lib/settings';
import { toNextResponse } from '../../_mindos-adapter';

export function GET() {
  const settings = readSettings();
  return toNextResponse(handleAgentRuntimeExtensionsGet({
    mindRoot: settings.mindRoot,
  } satisfies Pick<RuntimeExtensionServices, 'mindRoot'>));
}

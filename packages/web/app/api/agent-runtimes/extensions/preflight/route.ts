export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import {
  handleAgentRuntimeExtensionPreflightPost,
  type RuntimeExtensionServices,
} from '@geminilight/mindos/server';
import { readSettings } from '@/lib/settings';
import { toNextResponse } from '../../../_mindos-adapter';

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const settings = readSettings();
  const services: Pick<RuntimeExtensionServices, 'mindRoot' | 'readSettings'> = {
    mindRoot: settings.mindRoot,
    readSettings: () => readSettings() as unknown as ReturnType<RuntimeExtensionServices['readSettings']>,
  };
  return toNextResponse(handleAgentRuntimeExtensionPreflightPost(
    await readJson(req),
    services,
  ));
}

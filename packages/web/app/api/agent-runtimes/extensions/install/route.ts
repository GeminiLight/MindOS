export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import {
  handleAgentRuntimeExtensionInstallPost,
  type RuntimeExtensionServices,
} from '@geminilight/mindos/server';
import { readSettings, writeSettings } from '@/lib/settings';
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
  const services: RuntimeExtensionServices = {
    mindRoot: settings.mindRoot,
    readSettings: () => readSettings() as unknown as ReturnType<RuntimeExtensionServices['readSettings']>,
    writeSettings: (next) => writeSettings(next as unknown as Parameters<typeof writeSettings>[0]),
  };
  return toNextResponse(handleAgentRuntimeExtensionInstallPost(
    await readJson(req),
    services,
  ));
}

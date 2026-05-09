export const dynamic = 'force-dynamic';

import {
  expandSetupPathHome,
  handleSetupGet,
  handleSetupPatch,
  handleSetupPost,
  validateMindRootPath,
  type MindosSetupServices,
} from '@geminilight/mindos/server';
import { readSettings, writeSettings } from '@/lib/settings';
import { applyTemplate } from '@/lib/template';
import { generateProviderId } from '@/lib/custom-endpoints';
import { isProviderId, PROVIDER_PRESETS } from '@/lib/agent/providers';
import { toNextResponse } from '../_mindos-adapter';

const setupServices: MindosSetupServices = {
  readSettings: readSettings as unknown as MindosSetupServices['readSettings'],
  writeSettings: writeSettings as unknown as MindosSetupServices['writeSettings'],
  applyTemplate: (template, mindRoot) => {
    applyTemplate(template, mindRoot);
    return { ok: true };
  },
  expandPathHome: expandSetupPathHome,
  validateMindRootPath,
  isProviderId,
  generateProviderId,
  providerPresets: PROVIDER_PRESETS,
};

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export function GET() {
  return toNextResponse(handleSetupGet(setupServices));
}

export async function POST(req: Request) {
  return toNextResponse(handleSetupPost(await readJson(req), setupServices));
}

export async function PATCH(req: Request) {
  return toNextResponse(handleSetupPatch(await readJson(req), setupServices));
}

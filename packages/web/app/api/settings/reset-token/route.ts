export const dynamic = 'force-dynamic';
import { handleSettingsResetTokenPost, type MindosServerSettings } from '@geminilight/mindos/server';
import { readSettings, writeSettings } from '@/lib/settings';
import { handleRouteErrorSimple } from '@/lib/errors';
import { toNextResponse } from '../../_mindos-adapter';

// POST /api/settings/reset-token — generate a new auth token and persist it
export async function POST() {
  try {
    return toNextResponse(handleSettingsResetTokenPost({
      readSettings: () => readSettings() as MindosServerSettings,
      writeSettings: (settings) => writeSettings(settings as unknown as ReturnType<typeof readSettings>),
    }));
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}

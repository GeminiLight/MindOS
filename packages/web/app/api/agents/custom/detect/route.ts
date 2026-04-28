export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { detectBaseDir, detectCustomAgentProfile } from '@/lib/custom-agents';
import { handleRouteErrorSimple } from '@/lib/errors';

/** POST — Auto-detect config files in a baseDir. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { baseDir } = body as { baseDir?: string };

    if (!baseDir?.trim()) {
      return NextResponse.json({ error: 'baseDir is required' }, { status: 400 });
    }

    const dir = baseDir.trim();

    // Security: restrict to home directory only
    if (!dir.startsWith('~/')) {
      return NextResponse.json(
        { error: 'baseDir must start with ~/ (e.g. ~/.qclaw/)' },
        { status: 400 },
      );
    }

    const result = detectBaseDir(dir);
    
    // Enhanced detection: if we detected a config, read detailed MCP and skill info
    if (result.detectedConfig && result.detectedConfigKey) {
      const profile = detectCustomAgentProfile(
        dir,
        result.detectedConfig,
        result.detectedConfigKey
      );
      result.mcpServers = profile.mcpServers;
      result.skillNames = profile.skillNames;
      if (profile.parseError) {
        result.mcpParseError = profile.parseError;
      }
    }
    
    return NextResponse.json(result);
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}

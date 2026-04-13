export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { handleRouteErrorSimple } from '@/lib/errors';
import { scanObsidianVaultPlugins } from '@/lib/obsidian-compat/obsidian-import';
import { expandSetupPathHome } from '@/app/api/setup/path-utils';

export async function GET(req: NextRequest) {
  try {
    const vaultRootParam = req.nextUrl.searchParams.get('vaultRoot');
    if (!vaultRootParam) {
      return NextResponse.json({ ok: false, error: 'Missing vaultRoot' }, { status: 400 });
    }

    const vaultRoot = expandSetupPathHome(vaultRootParam.trim());
    const result = await scanObsidianVaultPlugins(vaultRoot);
    const summary = {
      total: result.plugins.length,
      compatible: result.plugins.filter((plugin) => plugin.compatibilityLevel === 'compatible').length,
      partial: result.plugins.filter((plugin) => plugin.compatibilityLevel === 'partial').length,
      blocked: result.plugins.filter((plugin) => plugin.compatibilityLevel === 'blocked').length,
    };

    return NextResponse.json({
      ok: true,
      vaultRoot,
      summary,
      plugins: result.plugins.map(({ sourceDir: _sourceDir, ...rest }) => rest),
      skipped: result.skipped,
    });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}

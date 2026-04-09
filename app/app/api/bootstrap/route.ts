export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { getFileContent, getMindRoot } from '@/lib/fs';
import { buildFileIndex } from '@/lib/core/tree';
import path from 'path';
import { handleRouteErrorSimple } from '@/lib/errors';

function tryRead(filePath: string): string | undefined {
  try {
    return getFileContent(filePath);
  } catch {
    return undefined;
  }
}

// GET /api/bootstrap?target_dir=Workflows/Research
export async function GET(req: NextRequest) {
  const targetDir = req.nextUrl.searchParams.get('target_dir') ?? undefined;

  try {
    const result: Record<string, string | undefined> = {
      instruction: tryRead('INSTRUCTION.md'),
      index: tryRead('README.md'),
      config_json: tryRead('CONFIG.json'),
      user_skill_rules: tryRead('.mindos/user-preferences.md'),
      file_index: buildFileIndex(getMindRoot()),
    };

    if (targetDir) {
      if (targetDir.includes('..') || path.isAbsolute(targetDir)) {
        return NextResponse.json({ error: 'invalid target_dir' }, { status: 400 });
      }
      result.target_readme = tryRead(path.join(targetDir, 'README.md'));
      result.target_instruction = tryRead(path.join(targetDir, 'INSTRUCTION.md'));
      result.target_config_json = tryRead(path.join(targetDir, 'CONFIG.json'));
    }

    return NextResponse.json(result);
  } catch (e) {
    return handleRouteErrorSimple(e);
  }
}

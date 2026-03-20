export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { getFileContent } from '@/lib/fs';
import path from 'path';

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
      config_md: tryRead('CONFIG.md'),
      user_skill_rules: tryRead('user-skill-rules.md'),
    };

    if (targetDir) {
      result.target_readme = tryRead(path.join(targetDir, 'README.md'));
      result.target_instruction = tryRead(path.join(targetDir, 'INSTRUCTION.md'));
      result.target_config_json = tryRead(path.join(targetDir, 'CONFIG.json'));
      result.target_config_md = tryRead(path.join(targetDir, 'CONFIG.md'));
    }

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getMindRoot } from '@/lib/fs';

function copyRecursive(src: string, dest: string) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    // Skip if file already exists
    if (fs.existsSync(dest)) return;
    // Ensure parent directory exists
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const template = body.template as string;

    if (!['en', 'zh', 'empty'].includes(template)) {
      return NextResponse.json({ error: 'Invalid template' }, { status: 400 });
    }

    // Resolve template source directory
    // templates/ is at the repo root (sibling of app/)
    const repoRoot = path.resolve(process.cwd(), '..');
    const templateDir = path.join(repoRoot, 'templates', template);

    if (!fs.existsSync(templateDir)) {
      return NextResponse.json({ error: `Template "${template}" not found` }, { status: 404 });
    }

    const mindRoot = getMindRoot();
    if (!fs.existsSync(mindRoot)) {
      fs.mkdirSync(mindRoot, { recursive: true });
    }

    copyRecursive(templateDir, mindRoot);

    return NextResponse.json({ ok: true, template });
  } catch (e) {
    console.error('[/api/init] Error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

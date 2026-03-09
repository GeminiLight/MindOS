import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { collectAllFiles, getFileContent } from '@/lib/fs';

export interface BacklinkEntry {
  filePath: string;
  snippets: string[];
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSnippets(content: string, target: string): string[] {
  const lines = content.split('\n');
  const snippets: string[] = [];
  const bname = path.basename(target, '.md');

  const patterns = [
    new RegExp(`\\[\\[${escapeRe(bname)}(?:[|#][^\\]]*)?\\]\\]`, 'i'),
    new RegExp(`\\[\\[${escapeRe(target)}(?:[|#][^\\]]*)?\\]\\]`, 'i'),
    new RegExp(`\\[[^\\]]+\\]\\(${escapeRe(target)}(?:#[^)]*)?\\)`, 'i'),
    new RegExp(`\\[[^\\]]+\\]\\([^)]*${escapeRe(bname)}\\.md(?:#[^)]*)?\\)`, 'i'),
  ];

  for (let i = 0; i < lines.length; i++) {
    if (patterns.some(p => p.test(lines[i]))) {
      const start = Math.max(0, i - 1);
      const end = Math.min(lines.length - 1, i + 1);
      const snippet = lines.slice(start, end + 1).join('\n').trim();
      if (snippet && !snippets.includes(snippet)) {
        snippets.push(snippet);
        if (snippets.length >= 3) break;
      }
    }
  }
  return snippets;
}

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get('path');
  if (!target) return NextResponse.json({ error: 'path required' }, { status: 400 });

  const allFiles = collectAllFiles().filter(f => f.endsWith('.md') && f !== target);
  const results: BacklinkEntry[] = [];

  for (const filePath of allFiles) {
    let content: string;
    try { content = getFileContent(filePath); } catch { continue; }
    const snippets = extractSnippets(content, target);
    if (snippets.length > 0) results.push({ filePath, snippets });
  }

  return NextResponse.json(results);
}

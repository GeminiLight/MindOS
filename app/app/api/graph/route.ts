import { NextResponse } from 'next/server';
import path from 'path';
import { collectAllFiles, getFileContent } from '@/lib/fs';

export interface GraphNode {
  id: string;    // relative file path
  label: string; // basename without extension
  folder: string; // dirname
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function extractLinks(content: string, sourcePath: string, fileSet: Set<string>, basenameMap: Map<string, string[]>): string[] {
  const targets: string[] = [];
  const sourceDir = path.dirname(sourcePath);

  // WikiLinks: [[target]] or [[target|alias]] or [[target#section]]
  const wikiRe = /\[\[([^\]|#]+)(?:[|#][^\]]*)?/g;
  let m: RegExpExecArray | null;
  while ((m = wikiRe.exec(content)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;

    // Try exact match
    if (fileSet.has(raw)) {
      targets.push(raw);
      continue;
    }
    // Try with .md
    const withMd = raw.endsWith('.md') ? raw : raw + '.md';
    if (fileSet.has(withMd)) {
      targets.push(withMd);
      continue;
    }
    // Try basename lookup (case-insensitive)
    const lower = path.basename(withMd).toLowerCase();
    const candidates = basenameMap.get(lower);
    if (candidates && candidates.length === 1) {
      targets.push(candidates[0]);
    }
    // skip if ambiguous (multiple candidates)
  }

  // Markdown links: [text](relative/path.md) or [text](relative/path.md#section)
  const mdLinkRe = /\[[^\]]+\]\(([^)]+\.md)(?:#[^)]*)?\)/g;
  while ((m = mdLinkRe.exec(content)) !== null) {
    const raw = m[1].trim();
    if (!raw || raw.startsWith('http')) continue;
    const resolved = path.normalize(path.join(sourceDir, raw));
    if (fileSet.has(resolved)) {
      targets.push(resolved);
    }
  }

  return targets;
}

export async function GET() {
  try {
    const allFiles = collectAllFiles().filter(f => f.endsWith('.md'));
    const fileSet = new Set(allFiles);

    // Build basename → relPath[] lookup
    const basenameMap = new Map<string, string[]>();
    for (const f of allFiles) {
      const key = path.basename(f).toLowerCase();
      if (!basenameMap.has(key)) basenameMap.set(key, []);
      basenameMap.get(key)!.push(f);
    }

    const nodes: GraphNode[] = allFiles.map(f => ({
      id: f,
      label: path.basename(f, '.md'),
      folder: path.dirname(f),
    }));

    const edgeSet = new Set<string>();
    const edges: GraphEdge[] = [];

    for (const filePath of allFiles) {
      let content: string;
      try {
        content = getFileContent(filePath);
      } catch {
        continue;
      }

      const targets = extractLinks(content, filePath, fileSet, basenameMap);
      for (const target of targets) {
        if (target === filePath) continue; // skip self-edges
        const key = `${filePath}||${target}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ source: filePath, target });
        }
      }
    }

    return NextResponse.json({ nodes, edges } satisfies GraphData);
  } catch (err) {
    console.error('[graph] Error building graph:', err);
    return NextResponse.json({ nodes: [], edges: [] }, { status: 500 });
  }
}

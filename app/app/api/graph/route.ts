export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import path from 'path';
import { collectAllFiles, getLinkIndex } from '@/lib/fs';
import { handleRouteErrorSimple } from '@/lib/errors';

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

export async function GET() {
  try {
    const allFiles = collectAllFiles().filter(f => f.endsWith('.md'));

    const nodes: GraphNode[] = allFiles.map(f => ({
      id: f,
      label: path.basename(f, '.md'),
      folder: path.dirname(f),
    }));

    // Use pre-built link index (O(1) per file) instead of extracting links
    // from every file on each request (O(n * m))
    const linkIndex = getLinkIndex();
    const edges = linkIndex.getAllEdges();

    return NextResponse.json({ nodes, edges } satisfies GraphData);
  } catch (err) {
    console.error('[graph] Error building graph:', err);
    return handleRouteErrorSimple(err);
  }
}

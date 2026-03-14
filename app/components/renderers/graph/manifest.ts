import type { RendererDefinition } from '@/lib/renderers/registry';

export const manifest: RendererDefinition = {
  id: 'graph',
  name: 'Wiki Graph',
  description: 'Force-directed graph of wikilink references across all markdown files. Supports Global and Local (2-hop) scope filters.',
  author: 'MindOS',
  icon: '🕸️',
  tags: ['graph', 'wiki', 'links', 'visualization'],
  builtin: true,
  entryPath: 'README.md',
  match: ({ extension }) => extension === 'md',
  load: () => import('./GraphRenderer').then(m => ({ default: m.GraphRenderer })),
};

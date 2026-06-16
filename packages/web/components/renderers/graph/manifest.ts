import type { RendererDefinition } from '@/lib/renderers/registry';

export const manifest: RendererDefinition = {
  id: 'graph',
  name: 'Wiki Graph',
  description: 'Local-first wiki link map with stable layout, missing-link visibility, and optional global overview.',
  author: 'MindOS',
  icon: '🕸️',
  tags: ['graph', 'wiki', 'links', 'visualization'],
  builtin: true,
  // No entryPath — Graph is a global toggle, not bound to a specific file.
  // Graph is opt-in via a global toggle; never auto-match in the registry.
  match: () => false,
  load: () => import('./GraphRenderer').then(m => ({ default: m.GraphRenderer })),
};

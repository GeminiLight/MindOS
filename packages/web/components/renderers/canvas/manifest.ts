import type { RendererDefinition } from '@/lib/renderers/registry';

export const manifest: RendererDefinition = {
  id: 'canvas',
  name: 'Canvas',
  description: 'Reads Obsidian `.canvas` files (the open JSON Canvas format) as a laid-out board: text, file, link and group nodes with their connections. Read-only.',
  author: 'MindOS',
  icon: '🗺️',
  tags: ['canvas', 'obsidian', 'board', 'jsoncanvas'],
  builtin: true,
  core: true,
  appBuiltinFeature: true,
  match: ({ extension }) => extension === 'canvas',
  load: () => import('./CanvasRenderer').then((m) => ({ default: m.CanvasRenderer })),
};

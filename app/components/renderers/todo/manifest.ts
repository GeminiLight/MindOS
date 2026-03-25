import type { RendererDefinition } from '@/lib/renderers/registry';

export const manifest: RendererDefinition = {
  id: 'todo',
  name: 'TODO Board',
  description: 'Renders TODO.md/TODO.csv as an interactive kanban board grouped by section. Check items off directly — changes are written back to the source file.',
  author: 'MindOS',
  icon: '✅',
  tags: ['productivity', 'tasks', 'markdown'],
  builtin: true,
  core: true,
  appBuiltinFeature: true,
  entryPath: 'TODO.md',
  match: ({ filePath }) => /\bTODO\b.*\.(md|csv)$/i.test(filePath),
  load: () => import('./TodoRenderer').then(m => ({ default: m.TodoRenderer })),
};

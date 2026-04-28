import type { RendererDefinition } from '@/lib/renderers/registry';

export const manifest: RendererDefinition = {
  id: 'change-log',
  name: 'Content Changes',
  description: 'Renders the .mindos/change-log.json file as a searchable timeline of content edits.',
  author: 'MindOS',
  icon: '📋',
  tags: ['changelog', 'history', 'changes'],
  builtin: true,
  core: true,
  appBuiltinFeature: true,
  match: ({ filePath }) => /\.mindos\/change-log\.json$/i.test(filePath),
  load: () => import('./ChangeLogRenderer').then(m => ({ default: m.ChangeLogRenderer })),
};

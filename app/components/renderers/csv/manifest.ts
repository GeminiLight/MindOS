import type { RendererDefinition } from '@/lib/renderers/registry';

export const manifest: RendererDefinition = {
  id: 'csv',
  name: 'CSV Views',
  description: 'Renders any CSV file as Table, Gallery, or Board. Each view is independently configurable — choose which columns map to title, description, tag, and group.',
  author: 'MindOS',
  icon: '📊',
  tags: ['csv', 'table', 'gallery', 'board', 'data'],
  builtin: true,
  core: true,
  appBuiltinFeature: true,
  entryPath: 'Resources/Products.csv',
  match: ({ extension, filePath }) => extension === 'csv' && !/\bTODO\b/i.test(filePath),
  load: () => import('./CsvRenderer').then(m => ({ default: m.CsvRenderer })),
};

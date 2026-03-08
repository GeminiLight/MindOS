import { registerRenderer } from './registry';
import { TodoRenderer } from '@/components/renderers/TodoRenderer';
import { CsvRenderer } from '@/components/renderers/CsvRenderer';

registerRenderer({
  id: 'todo',
  name: 'TODO Board',
  description: 'Renders TODO.md/TODO.csv as an interactive kanban board grouped by section. Check items off directly — changes are written back to the source file.',
  author: 'MindOS',
  icon: '✅',
  tags: ['productivity', 'tasks', 'markdown'],
  builtin: true,
  match: ({ filePath }) => /\bTODO\b.*\.(md|csv)$/i.test(filePath),
  component: TodoRenderer,
});

registerRenderer({
  id: 'csv',
  name: 'CSV Views',
  description: 'Renders any CSV file as Table, Gallery, or Board. Each view is independently configurable — choose which columns map to title, description, tag, and group.',
  author: 'MindOS',
  icon: '📊',
  tags: ['csv', 'table', 'gallery', 'board', 'data'],
  builtin: true,
  match: ({ extension, filePath }) => extension === 'csv' && !/\bTODO\b/i.test(filePath),
  component: CsvRenderer,
});

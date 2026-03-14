import type { RendererDefinition } from '@/lib/renderers/registry';

export const manifest: RendererDefinition = {
  id: 'timeline',
  name: 'Timeline',
  description: 'Renders changelog and journal files as a vertical timeline. Any markdown with ## date headings (e.g. ## 2025-01-15) becomes a card in the feed.',
  author: 'MindOS',
  icon: '📅',
  tags: ['timeline', 'changelog', 'journal', 'history'],
  builtin: true,
  entryPath: 'CHANGELOG.md',
  match: ({ filePath }) => /\b(CHANGELOG|changelog|TIMELINE|timeline|journal|Journal|diary|Diary)\b.*\.md$/i.test(filePath),
  load: () => import('./TimelineRenderer').then(m => ({ default: m.TimelineRenderer })),
};

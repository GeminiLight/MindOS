import type { RendererDefinition } from '@/lib/renderers/registry';

export const manifest: RendererDefinition = {
  id: 'summary',
  name: 'AI Briefing',
  description: 'Streams an AI-generated daily briefing summarizing your most recently modified files — key changes, recurring themes, and suggested next actions.',
  author: 'MindOS',
  icon: '✨',
  tags: ['ai', 'summary', 'briefing', 'daily'],
  builtin: true,
  entryPath: 'DAILY.md',
  match: ({ filePath }) => /\b(SUMMARY|summary|Summary|BRIEFING|briefing|Briefing|DAILY|daily|Daily)\b.*\.md$/i.test(filePath),
  load: () => import('./SummaryRenderer').then(m => ({ default: m.SummaryRenderer })),
};

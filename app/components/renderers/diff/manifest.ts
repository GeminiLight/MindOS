import type { RendererDefinition } from '@/lib/renderers/registry';

export const manifest: RendererDefinition = {
  id: 'diff-viewer',
  name: 'Diff Viewer',
  description: 'Visualizes agent file changes as a side-by-side diff timeline. Auto-activates on Agent-Diff.md with embedded agent-diff blocks.',
  author: 'MindOS',
  icon: '📝',
  tags: ['diff', 'agent', 'changes', 'history'],
  builtin: true,
  entryPath: 'Agent-Diff.md',
  match: ({ filePath }) => /\bAgent-Diff\b.*\.md$/i.test(filePath),
  load: () => import('./DiffRenderer').then(m => ({ default: m.DiffRenderer })),
};

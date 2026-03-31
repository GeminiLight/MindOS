import type { RendererDefinition } from '@/lib/renderers/registry';

export const manifest: RendererDefinition = {
  id: 'workflow',
  name: 'Workflow Runner (Markdown)',
  description: 'Legacy: Parses step-by-step workflow markdown into an interactive runner. Use .workflow.yaml for new workflows.',
  author: 'MindOS',
  icon: '⚡',
  tags: ['workflow', 'automation', 'steps', 'ai', 'legacy'],
  builtin: true,
  entryPath: 'Workflow.md',
  match: ({ filePath }) => /\b(Workflow|workflow|WORKFLOW)\b.*\.md$/i.test(filePath),
  load: () => import('./WorkflowRenderer').then(m => ({ default: m.WorkflowRenderer })),
};

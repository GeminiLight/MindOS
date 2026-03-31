import type { RendererDefinition } from '@/lib/renderers/registry';

export const manifest: RendererDefinition = {
  id: 'workflow-yaml',
  name: 'Workflow Runner (YAML)',
  description: 'Execute step-by-step YAML workflows with Skills & Agent support.',
  author: 'MindOS',
  icon: '⚡',
  tags: ['workflow', 'automation', 'steps', 'ai', 'yaml'],
  builtin: true,
  entryPath: 'Workflows/',
  match: ({ extension, filePath }) => {
    if (extension !== 'yaml' && extension !== 'yml') return false;
    return /\.workflow\.(yaml|yml)$/i.test(filePath);
  },
  load: () => import('./WorkflowYamlRenderer').then(m => ({ 
    default: m.WorkflowYamlRenderer 
  })),
};

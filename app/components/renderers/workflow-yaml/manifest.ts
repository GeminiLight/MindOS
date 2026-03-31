import type { RendererDefinition } from '@/lib/renderers/registry';

export const manifest: RendererDefinition = {
  id: 'workflow-yaml',
  name: 'Workflow Runner',
  description: 'Execute step-by-step YAML workflows with Skills & Agent support.',
  author: 'MindOS',
  icon: '⚡',
  tags: ['workflow', 'automation', 'steps', 'ai', 'yaml'],
  builtin: true,
  core: true,
  appBuiltinFeature: true,
  entryPath: '.mindos/workflows/',
  match: ({ extension, filePath }) => {
    if (extension !== 'yaml' && extension !== 'yml') return false;
    return /\.workflow\.(yaml|yml)$/i.test(filePath);
  },
  load: () => import('./WorkflowYamlRenderer').then(m => ({ 
    default: m.WorkflowYamlRenderer 
  })),
};

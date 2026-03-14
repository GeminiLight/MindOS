import type { RendererDefinition } from '@/lib/renderers/registry';

export const manifest: RendererDefinition = {
  id: 'agent-inspector',
  name: 'Agent Inspector',
  description: 'Visualizes agent tool-call logs as a filterable timeline. Auto-activates on .agent-log.json (JSON Lines format).',
  author: 'MindOS',
  icon: '🔍',
  tags: ['agent', 'inspector', 'log', 'mcp', 'tools'],
  builtin: true,
  entryPath: '.agent-log.json',
  match: ({ filePath }) => /\.agent-log\.json$/i.test(filePath),
  load: () => import('./AgentInspectorRenderer').then(m => ({ default: m.AgentInspectorRenderer })),
};

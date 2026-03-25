import type { RendererDefinition } from '@/lib/renderers/registry';

export const manifest: RendererDefinition = {
  id: 'agent-inspector',
  name: 'Agent Inspector',
  description: 'Visualizes agent tool-call logs as a filterable timeline. Auto-activates on .mindos/agent-audit-log.json and supports legacy .agent-log.json.',
  author: 'MindOS',
  icon: '🔍',
  tags: ['agent', 'inspector', 'log', 'mcp', 'tools'],
  builtin: true,
  core: true,
  appBuiltinFeature: true,
  entryPath: '.mindos/agent-audit-log.json',
  match: ({ filePath }) => /(^|\/)\.mindos\/agent-audit-log\.json$/i.test(filePath) || /\.agent-log\.json$/i.test(filePath),
  load: () => import('./AgentInspectorRenderer').then(m => ({ default: m.AgentInspectorRenderer })),
};

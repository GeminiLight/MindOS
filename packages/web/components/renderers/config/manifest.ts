import type { RendererDefinition } from '@/lib/renderers/registry';

export const manifest: RendererDefinition = {
  id: 'config-panel',
  name: 'Config Panel',
  description: 'Renders CONFIG.json as an editable control panel based on uiSchema/keySpecs. Changes are written back to the JSON file directly.',
  author: 'MindOS',
  icon: '🧩',
  tags: ['config', 'json', 'settings', 'schema'],
  builtin: true,
  core: true,
  appBuiltinFeature: true,
  entryPath: 'CONFIG.json',
  match: ({ filePath, extension }) => extension === 'json' && /(^|\/)CONFIG\.json$/i.test(filePath),
  load: () => import('./ConfigRenderer').then(m => ({ default: m.ConfigRenderer })),
};

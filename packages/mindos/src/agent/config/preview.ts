/** Browser-safe counterpart of the config writer. Do not import filesystem adapters here. */
import { buildMindosMcpServerEntry, type MindosMcpServerEntryOptions } from './entry.js';
import { buildTomlEntry } from './toml.js';
import { mergeYamlEntry } from './yaml.js';
import type { AgentConfigLocationDef, AgentConfigTransport } from './types.js';

export function previewMindosMcpConfig(
  def: Pick<AgentConfigLocationDef, 'key' | 'format' | 'globalNestedKey' | 'entryStyle'>,
  transport: AgentConfigTransport,
  options: MindosMcpServerEntryOptions = {},
): string {
  const entry = buildMindosMcpServerEntry(def, transport, options);
  if (def.format === 'toml') return buildTomlEntry(def.key, 'mindos', entry);
  if (def.format === 'yaml') return mergeYamlEntry('', def.key, 'mindos', entry).trimEnd();
  const root: Record<string, unknown> = {};
  let current = root;
  for (const part of (def.globalNestedKey ?? def.key).split('.')) {
    if (!part || ['__proto__', 'constructor', 'prototype'].includes(part)) throw new Error('Invalid MCP config key');
    const child: Record<string, unknown> = {};
    current[part] = child;
    current = child;
  }
  current.mindos = entry;
  return JSON.stringify(root, null, 2);
}

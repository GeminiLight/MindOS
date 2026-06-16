// Sunk into the core package (Wave 3, spec-agent-core-consolidation).
// Mapping rules and pi-subagent discovery live in
// packages/mindos/src/agent/tool/capability-registry.ts; this adapter injects the
// web app's services (settings, ACP detection, MCP cache, A2A registry) and
// resolves the bundled pi-subagents dir relative to this install layout.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AgentCapabilitiesServices, AgentRuntimesServices } from '@geminilight/mindos/server';
import { createAgentCapabilitiesServices as createCoreServices } from '@geminilight/mindos/agent/tool/capability-registry';
import { knowledgeBaseTools } from './tools';
import { checkNativeRuntimeHealth, detectLocalAcpAgents, resolveCommandPath } from '@/lib/acp/detect-local';
import { readSettings } from '@/lib/settings';
import { readMcpConfig, readMcpToolCache } from '@/lib/pi-integration/mcp-config';
import { getDiscoveredAgents } from '@/lib/a2a/client';
import { effectiveMindRoot } from '@/lib/mind-root';

export function createAgentCapabilitiesServices(): AgentCapabilitiesServices {
  return createCoreServices({
    knowledgeBaseTools,
    effectiveMindRoot,
    readSettings: readSettings as AgentRuntimesServices['readSettings'],
    detectLocalAcpAgents: detectLocalAcpAgents as AgentRuntimesServices['detectLocalAcpAgents'],
    resolveRuntimeCommand: resolveCommandPath as AgentRuntimesServices['resolveRuntimeCommand'],
    checkNativeRuntimeHealth: checkNativeRuntimeHealth as AgentRuntimesServices['checkNativeRuntimeHealth'],
    readMcpConfig,
    readMcpToolCache,
    getDiscoveredAgents,
    resolveBuiltinSubagentsDir,
  });
}

function resolveBuiltinSubagentsDir(): string | null {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(currentDir, '..', '..'),
    process.cwd(),
    path.join(process.cwd(), 'packages', 'web'),
  ];
  for (const base of candidates) {
    const dir = path.join(base, 'node_modules', 'pi-subagents', 'agents');
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

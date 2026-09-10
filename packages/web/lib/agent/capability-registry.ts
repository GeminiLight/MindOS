// Sunk into the core package (Wave 3, spec-agent-core-consolidation).
// Mapping rules and pi-subagent discovery live in
// packages/mindos/src/agent/tool/capability-registry.ts; this adapter injects the
// web app's services (settings, runtime descriptor listing, MCP cache, A2A
// registry) and resolves the bundled pi-subagents dir relative to this install
// layout. Descriptors are listed through the product detection handler so the
// web host shares one detection-cache probe with the runtime picker
// (spec-runtime-lane-contract).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  AgentCapabilitiesServices,
  AgentRuntimesPayload,
  AgentRuntimesServices,
} from '@geminilight/mindos/server';
import { handleAgentRuntimesGet } from '@geminilight/mindos/server';
import { createAgentCapabilitiesServices as createCoreServices } from '@geminilight/mindos/agent/tool/capability-registry';
import { knowledgeBaseTools } from './tools';
import { checkNativeRuntimeHealth, detectLocalAcpAgents, resolveCommandPath, resolveCommandPathCandidates } from '@/lib/acp/detect-local';
import { readSettings } from '@/lib/settings';
import { readMcpConfig, readMcpToolCache } from '@/lib/pi-integration/mcp-config';
import { getDiscoveredAgents } from '@/lib/a2a/client';
import { effectiveMindRoot } from '@/lib/mind-root';
import { findBuiltinWebRuntimePackagePath } from './builtin-extension-runtime';

export function createAgentCapabilitiesServices(): AgentCapabilitiesServices {
  return createCoreServices({
    knowledgeBaseTools,
    effectiveMindRoot,
    listRuntimeDescriptors: async () => {
      const response = await handleAgentRuntimesGet(new URLSearchParams(), {
        readSettings: readSettings as AgentRuntimesServices['readSettings'],
        detectLocalAcpAgents: detectLocalAcpAgents as AgentRuntimesServices['detectLocalAcpAgents'],
        resolveRuntimeCommand: resolveCommandPath as AgentRuntimesServices['resolveRuntimeCommand'],
        resolveRuntimeCommandCandidates: resolveCommandPathCandidates as AgentRuntimesServices['resolveRuntimeCommandCandidates'],
        checkNativeRuntimeHealth: checkNativeRuntimeHealth as AgentRuntimesServices['checkNativeRuntimeHealth'],
      });
      if (response.status !== 200 || !response.body || !('runtimes' in response.body)) {
        throw new Error('Could not load agent runtime descriptors.');
      }
      return (response.body as AgentRuntimesPayload).runtimes;
    },
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
    const dir = findBuiltinWebRuntimePackagePath(base, 'pi-subagents', 'agents');
    if (dir && fs.existsSync(dir)) return dir;
  }
  return null;
}

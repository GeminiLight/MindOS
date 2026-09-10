import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import {
  DEFAULT_MCP_AGENTS,
  detectAgentConfiguredMcpServersFromConfigs,
  detectAgentInstalledFromConfigs,
  detectAgentPresence as coreDetectAgentPresence,
  listInstalledSkillNames,
  resolveAgentConfigProbes,
  resolveAgentHiddenRoot,
  resolveSkillLinkAgents,
  resolveSkillWorkspaceProfile as coreResolveSkillWorkspaceProfile,
  type AgentConfigProbes,
  type MindosMcpAgentRegistryDef,
  type MindosSkillAgentRegistration,
  type MindosSkillLinkAgent,
} from '@geminilight/mindos/server';
import { effectiveMindRoot } from '@geminilight/mindos/foundation';
import { SKILL_AGENT_REGISTRY } from './mcp-agent-registry';
import type { SkillInstallMode as SkillInstallModeType } from './mcp-agent-registry';
import { loadCustomAgents } from './custom-agents';
export {
  SKILL_AGENT_REGISTRY,
  type SkillAgentRegistration,
  type SkillInstallMode,
} from './mcp-agent-registry';

// JSONC parsing and `~` expansion live in the core package (spec-core-consolidation);
// re-exported here because `custom-agents.ts`, the API routes and tests import them from this module.
import { expandHome, parseJsonc } from '@geminilight/mindos/foundation';
export { expandHome, parseJsonc };

/**
 * Single source of truth: the MCP agent registry is core's `DEFAULT_MCP_AGENTS`
 * (spec-agent-config-adapter). The Web host no longer keeps a hand copy — the
 * platform-specific paths are computed by core at module load, and the parity
 * contracts (`__tests__/core/agent-registry-parity.test.ts`,
 * `tests/agent-registry-contract.test.ts`) assert this record IS the core one.
 */
export const MCP_AGENTS: Record<string, AgentDef> = DEFAULT_MCP_AGENTS;

export type AgentDef = MindosMcpAgentRegistryDef;

export interface SkillWorkspaceProfile {
  mode: SkillInstallModeType;
  skillAgentName?: string;
  workspacePath: string;
}

export interface AgentRuntimeSignals {
  hiddenRootPath: string;
  hiddenRootPresent: boolean;
  conversationSignal: boolean;
  usageSignal: boolean;
  lastActivityAt?: string;
}

export interface AgentConfiguredMcpServers {
  servers: string[];
  sources: string[];
}

export interface AgentInstalledSkills {
  skills: string[];
  sourcePath: string;
}

/**
 * Filesystem / process probes for the core adapter layer, routed through THIS
 * module's `fs` and `child_process` imports so `vi.spyOn(fs, …)` and the
 * `child_process` mock in Web tests keep intercepting core's reads. Injecting
 * probes also disables core's process-wide presence / config-read caches (they
 * only make sense against the real filesystem), so the Web keeps its own 15s
 * presence cache below.
 */
function fsProbes(): AgentConfigProbes {
  return {
    pathExists: (p: string) => fs.existsSync(p),
    readTextFile: (p: string) => fs.readFileSync(p, 'utf-8'),
    readDir: (p: string) => fs.readdirSync(p, { withFileTypes: true }),
    stat: (p: string) => fs.statSync(p),
    commandExists: (command: string) => {
      try {
        execFileSync(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Detection services for the core config readers, routed through THIS module's
 * fs so behavior stays injectable in Web tests. Relative project-scoped configs
 * resolve against the mind root (the same base the install handlers write to),
 * never against the Web server's cwd.
 */
function detectionServices(options?: { projectRoot?: string }) {
  return {
    projectRoot: options?.projectRoot ?? safeMindRoot(),
    pathExists: (p: string) => fs.existsSync(p),
    readTextFile: (p: string) => fs.readFileSync(p, 'utf-8'),
  };
}

function safeMindRoot(): string | undefined {
  try {
    return effectiveMindRoot() || undefined;
  } catch {
    return undefined;
  }
}

/** The agent's hidden root (`~/.claude`, `~/.codex`, …) via the shared core resolver. */
function resolveHiddenRootPath(agent: AgentDef): string {
  return resolveAgentHiddenRoot(agent, resolveAgentConfigProbes(fsProbes()));
}

function readDirectoryEntries(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function detectSignalsFromName(name: string): { conversation: boolean; usage: boolean } {
  const lowered = name.toLowerCase();
  return {
    conversation: /(session|history|conversation|chat|transcript)/.test(lowered),
    usage: /(usage|token|cost|billing|metric|analytics)/.test(lowered),
  };
}

export function resolveSkillWorkspaceProfile(agentKey: string): SkillWorkspaceProfile {
  const registration = SKILL_AGENT_REGISTRY[agentKey] ?? { mode: 'unsupported' as const };
  const profile = coreResolveSkillWorkspaceProfile(
    agentKey,
    MCP_AGENTS[agentKey] ?? ({} as AgentDef),
    registration as MindosSkillAgentRegistration,
    resolveAgentConfigProbes(fsProbes()),
  );
  return profile as SkillWorkspaceProfile;
}

export function detectAgentConfiguredMcpServers(agentKey: string, options?: { projectRoot?: string }): AgentConfiguredMcpServers {
  const agent = MCP_AGENTS[agentKey];
  if (!agent) return { servers: [], sources: [] };
  return detectAgentConfiguredMcpServersFromConfigs(agent, detectionServices(options));
}

export function detectAgentInstalledSkills(agentKey: string): AgentInstalledSkills {
  const profile = resolveSkillWorkspaceProfile(agentKey);
  const sourcePath = profile.workspacePath;
  const skills = listInstalledSkillNames(sourcePath, resolveAgentConfigProbes(fsProbes()));
  return { skills, sourcePath };
}

export function detectAgentRuntimeSignals(agentKey: string): AgentRuntimeSignals {
  const agent = MCP_AGENTS[agentKey];
  if (!agent) {
    return { hiddenRootPath: '', hiddenRootPresent: false, conversationSignal: false, usageSignal: false };
  }
  const hiddenRootPath = resolveHiddenRootPath(agent);
  if (!fs.existsSync(hiddenRootPath)) {
    return { hiddenRootPath, hiddenRootPresent: false, conversationSignal: false, usageSignal: false };
  }

  // Depth-3 / 300-entry walk of the agent home for conversation + usage
  // signals. Web-only (the standalone product server's default runtime signals
  // do not walk); it backs the agent-detail Activity / Runtime sections.
  const maxDepth = 3;
  const maxEntries = 300;
  let scanned = 0;
  let conversationSignal = false;
  let usageSignal = false;
  let latestMtime = 0;
  const queue: Array<{ dir: string; depth: number }> = [{ dir: hiddenRootPath, depth: 0 }];

  while (queue.length > 0 && scanned < maxEntries) {
    const current = queue.shift();
    if (!current) break;
    const entries = readDirectoryEntries(current.dir);
    for (const entry of entries) {
      if (scanned >= maxEntries) break;
      scanned += 1;
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const fullPath = path.join(current.dir, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs > latestMtime) latestMtime = stat.mtimeMs;
        const signals = detectSignalsFromName(entry.name);
        if (signals.conversation) conversationSignal = true;
        if (signals.usage) usageSignal = true;
        if (entry.isDirectory() && current.depth < maxDepth) {
          queue.push({ dir: fullPath, depth: current.depth + 1 });
        }
      } catch {
        continue;
      }
    }
  }

  return {
    hiddenRootPath,
    hiddenRootPresent: true,
    conversationSignal,
    usageSignal,
    lastActivityAt: latestMtime > 0 ? new Date(latestMtime).toISOString() : undefined,
  };
}

/* ── MindOS MCP Install Detection ──────────────────────────────────────── */

/**
 * Whether MindOS is configured for `agentKey`, read through the shared
 * per-format config readers so a Codex-native `[mcp_servers.mindos]` table
 * with only `command` counts the same way it does in the product server.
 */
export function detectInstalled(
  agentKey: string,
  options?: { projectRoot?: string },
): { installed: boolean; scope?: string; transport?: string; configPath?: string; url?: string } {
  const agent = MCP_AGENTS[agentKey];
  if (!agent) return { installed: false };
  return detectAgentInstalledFromConfigs(agent, detectionServices(options));
}

/* ── Agent Presence Detection ──────────────────────────────────────────── */

// `GET /api/mcp/agents` probes ~27 agents per request (a `which` spawn each);
// presence rarely changes, so the Web host keeps a short memo. Core's own cache
// is off here because we inject fs probes (see fsProbes), so this is the only
// presence cache in the Web path.
const PRESENCE_CACHE_TTL_MS = 15_000;
const presenceCache = new Map<string, { at: number; value: boolean }>();

/** Test hook: forget memoised presence results. */
export function resetAgentPresenceCache(): void {
  presenceCache.clear();
}

export function detectAgentPresence(agentKey: string): boolean {
  const cached = presenceCache.get(agentKey);
  if (cached && Date.now() - cached.at < PRESENCE_CACHE_TTL_MS) return cached.value;
  const value = detectAgentPresenceUncached(agentKey);
  presenceCache.set(agentKey, { at: Date.now(), value });
  return value;
}

function detectAgentPresenceUncached(agentKey: string): boolean {
  const def = MCP_AGENTS[agentKey];
  if (!def) return false;
  return coreDetectAgentPresence(agentKey, def, resolveAgentConfigProbes(fsProbes()));
}

/* ── Skill Link Agents (skill × agent matrix) ──────────────────────────── */

/**
 * Downstream agents eligible for skill linking: present on this machine and
 * skill-capable (universal/additional). Unsupported-mode agents, agents not
 * detected on this machine, and MindOS itself are excluded. Custom agents are
 * appended with their configured skill directory (additional mode).
 */
export function listSkillLinkAgents(): MindosSkillLinkAgent[] {
  const linkAgents = resolveSkillLinkAgents({
    agents: MCP_AGENTS as unknown as Record<string, MindosMcpAgentRegistryDef>,
    skillAgentRegistry: SKILL_AGENT_REGISTRY as unknown as Record<string, MindosSkillAgentRegistration>,
    detectAgentPresence,
    resolveSkillWorkspaceProfile,
    // Route fs probing through THIS module's fs so behavior is injectable in
    // tests (the package's own fs import is not affected by web-side spies).
    pathExists: (p: string) => fs.existsSync(p),
  });

  const seenKeys = new Set(linkAgents.map((agent) => agent.key));
  for (const custom of loadCustomAgents()) {
    if (custom.key === 'mindos' || custom.key in MCP_AGENTS || seenKeys.has(custom.key)) continue;
    const presenceCandidates = [...(custom.presenceDirs ?? []), custom.baseDir].filter(Boolean);
    if (!presenceCandidates.some((dir) => fs.existsSync(expandHome(dir)))) continue;
    seenKeys.add(custom.key);
    linkAgents.push({
      key: custom.key,
      name: custom.name,
      mode: 'additional',
      // Same skill-dir resolution as getTrustedNativeSkillRoots in app/api/skills/route.ts.
      skillDir: expandHome(custom.skillDir || path.join(custom.baseDir, 'skills')),
    });
  }

  return linkAgents;
}

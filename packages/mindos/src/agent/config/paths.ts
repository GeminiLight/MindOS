import { isAbsolute, resolve } from 'node:path';
import { expandHome } from '../../foundation/shared/utils/path.js';
import { detectConfigFormat } from './formats.js';
import type { AgentConfigLocationDef, AgentConfigScope, McpServerEntryLocation } from './types.js';

export { expandHome };

/** A relative project-scoped config path was asked for without any project root to anchor it. */
export class AgentConfigProjectRootError extends Error {
  readonly status = 400;

  constructor(configPath: string) {
    super(`Project-scoped agent config "${configPath}" needs a project root; pass projectRoot or install into global scope.`);
    this.name = 'AgentConfigProjectRootError';
  }
}

export type AgentConfigPathServices = {
  homeDir?: string;
  projectRoot?: string;
};

/** Every config file of `def` at `scope`, primary (writable) path first. */
export function configPathCandidates(def: AgentConfigLocationDef, scope: AgentConfigScope): string[] {
  const primary = scope === 'global' ? def.global : def.project;
  const readAlso = scope === 'global' ? def.globalReadAlso : def.projectReadAlso;
  return [primary, ...(readAlso ?? [])].filter((entry): entry is string => !!entry);
}

/** The single config file installs write for `scope`; null when the agent has no such scope. */
export function primaryConfigPath(def: AgentConfigLocationDef, scope: AgentConfigScope): string | null {
  return (scope === 'global' ? def.global : def.project) || null;
}

/**
 * Absolute location of one agent config path. Global paths only expand `~`.
 * Relative project paths (`.mcp.json`, `.cursor/mcp.json`) resolve against
 * the explicit project root and never against `process.cwd()`: the Web
 * server's cwd is its runtime directory, not anything the user calls a project.
 */
export function resolveAgentConfigPath(
  configPath: string,
  scope: AgentConfigScope,
  services: AgentConfigPathServices,
): string {
  const expanded = expandHome(configPath, services.homeDir);
  if (scope !== 'project' || isAbsolute(expanded)) return expanded;
  const root = services.projectRoot?.trim();
  if (!root || !isAbsolute(root)) throw new AgentConfigProjectRootError(configPath);
  return resolve(root, expanded);
}

/** True when `configPath` at `scope` cannot be resolved without a project root. */
export function agentConfigPathNeedsProjectRoot(configPath: string, scope: AgentConfigScope, homeDir?: string): boolean {
  return scope === 'project' && !isAbsolute(expandHome(configPath, homeDir));
}

/**
 * Where `def` keeps its servers map for `scope`. Only the global config of
 * CoPaw-style agents nests the map under a dotted path (`mcp.clients`).
 */
export function entryLocation(def: AgentConfigLocationDef, scope: AgentConfigScope): McpServerEntryLocation {
  return {
    format: detectConfigFormat(def.format),
    sectionKey: def.key,
    nestedPath: scope === 'global' ? def.globalNestedKey : undefined,
  };
}

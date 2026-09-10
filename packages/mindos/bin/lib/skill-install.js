/**
 * Local install of the packaged MindOS skill into downstream agents.
 *
 * The copy goes through the shared `linkSkillToAgent` primitive (copy
 * strategy) from the generated agent-config bundle instead of a bare recursive
 * copy, so every install carries the `.mindos-managed` marker: the Skills
 * matrix reports it as MindOS-managed (`copied`, not `conflict`) and uninstall
 * may remove it. Installs copy rather than symlink on purpose — they target
 * npm / binary runtimes whose directory moves on update, so a link would
 * dangle.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { loadAgentConfigBundle } from './agent-config.js';
import { ROOT, WEB_APP_DIR } from './constants.js';
import { MCP_AGENTS } from './mcp-agents.js';
import { getActiveSkillName, resolveSkillWorkspaceProfile } from './agent-readiness.js';

const { linkSkillToAgent } = await loadAgentConfigBundle();

function defaultSkillSources() {
  return [
    join(ROOT, 'skills'),
    join(WEB_APP_DIR, 'data', 'skills'),
  ];
}

export function findSkillSourceRoot(skillName, options = {}) {
  const pathExists = options.pathExists ?? existsSync;
  const sources = options.skillSources ?? defaultSkillSources();
  return sources.find((source) => pathExists(join(source, skillName, 'SKILL.md'))) ?? null;
}

/** Result vocabulary matches `POST /api/mcp/install-skill`: exists | copied | repaired | missing-source | failed. */
function copySkillToWorkspace(skillName, workspacePath, sourceRoot, linkAgent, options = {}) {
  const pathExists = options.pathExists ?? existsSync;
  const stat = options.stat ?? statSync;
  const sourceDir = join(sourceRoot, skillName);
  const targetDir = join(workspacePath, skillName);
  const targetSkillFile = join(targetDir, 'SKILL.md');

  if (!pathExists(join(sourceDir, 'SKILL.md'))) {
    return { status: 'missing-source', skillPath: targetDir };
  }
  if (pathExists(targetSkillFile)) {
    return { status: 'exists', skillPath: targetDir };
  }

  // A directory without SKILL.md is a half-finished install we may complete.
  let repaired = false;
  if (pathExists(targetDir)) {
    try {
      repaired = stat(targetDir).isDirectory();
    } catch {
      repaired = true;
    }
  }

  const sourceRoots = [{ path: sourceRoot, source: 'builtin', origin: 'project-builtin', editable: false }];
  const outcome = linkSkillToAgent(skillName, linkAgent, sourceRoots, { strategy: 'copy' });
  if (!outcome.ok) {
    return { status: 'failed', skillPath: targetDir, error: outcome.message };
  }
  if (outcome.result === 'already') return { status: 'exists', skillPath: targetDir };
  return { status: repaired ? 'repaired' : 'copied', skillPath: targetDir };
}

export function installMindosSkillsForAgents(agentKeys, options = {}) {
  const skillName = options.skillName ?? getActiveSkillName(options);
  const sourceRoot = findSkillSourceRoot(skillName, options);
  const results = [];

  for (const agentKey of agentKeys) {
    const agent = MCP_AGENTS[agentKey];
    if (!agent) {
      results.push({
        agentKey,
        name: agentKey,
        status: 'unknown-agent',
        error: `Unknown agent: ${agentKey}`,
      });
      continue;
    }

    const profile = resolveSkillWorkspaceProfile(agentKey, options);
    if (!sourceRoot) {
      results.push({
        agentKey,
        name: agent.name,
        mode: profile.mode,
        workspacePath: profile.workspacePath,
        status: 'missing-source',
        error: `Packaged skill ${skillName} was not found.`,
      });
      continue;
    }

    const linkAgent = {
      key: agentKey,
      name: agent.name,
      mode: profile.mode === 'universal' ? 'universal' : 'additional',
      skillDir: profile.workspacePath,
    };
    const copied = copySkillToWorkspace(skillName, profile.workspacePath, sourceRoot, linkAgent, options);
    results.push({
      agentKey,
      name: agent.name,
      mode: profile.mode,
      skillAgentName: profile.skillAgentName,
      workspacePath: profile.workspacePath,
      ...copied,
    });
  }

  return {
    ok: results.every((result) => result.status === 'exists' || result.status === 'copied' || result.status === 'repaired'),
    skillName,
    sourceRoot,
    results,
  };
}

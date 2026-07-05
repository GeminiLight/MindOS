import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ROOT, WEB_APP_DIR } from './constants.js';
import { MCP_AGENTS } from './mcp-agents.js';
import { getActiveSkillName, resolveSkillWorkspaceProfile } from './agent-readiness.js';

function copyDirSync(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const sourcePath = join(src, entry.name);
    const targetPath = join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(sourcePath, targetPath);
    } else {
      copyFileSync(sourcePath, targetPath);
    }
  }
}

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

function copySkillToWorkspace(skillName, workspacePath, sourceRoot, options = {}) {
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

  let repaired = false;
  if (pathExists(targetDir)) {
    try {
      repaired = stat(targetDir).isDirectory();
    } catch {
      repaired = true;
    }
  }

  try {
    copyDirSync(sourceDir, targetDir);
    return { status: repaired ? 'repaired' : 'copied', skillPath: targetDir };
  } catch (error) {
    return {
      status: 'failed',
      skillPath: targetDir,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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

    const copied = copySkillToWorkspace(skillName, profile.workspacePath, sourceRoot, options);
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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  detectMindosMcpConfig,
  getActiveSkillName,
  inspectAgentReadiness,
  resolveSkillWorkspaceProfile,
} from '../../packages/mindos/bin/lib/agent-readiness.js';
import { installMindosSkillsForAgents } from '../../packages/mindos/bin/lib/skill-install.js';

let tempHome: string;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-agent-ready-'));
});

afterEach(() => {
  fs.rmSync(tempHome, { recursive: true, force: true });
});

function writeHomeFile(relativePath: string, content: string) {
  const target = path.join(tempHome, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf-8');
  return target;
}

function writeSkill(workspaceRelativePath: string, skillName = 'mindos') {
  writeHomeFile(path.join(workspaceRelativePath, skillName, 'SKILL.md'), `# ${skillName}\n`);
}

function readinessOptions() {
  return {
    homeDir: tempHome,
    cwd: tempHome,
    detectPresence: () => true,
    commandExists: (command: string) => command === 'mindos',
  };
}

describe('CLI agent readiness', () => {
  it('recognizes Codex TOML MCP plus universal Skill as ready', () => {
    writeHomeFile('.codex/config.toml', `
[mcp_servers.mindos]
type = "stdio"
command = "mindos"
args = ["mcp"]

[mcp_servers.mindos.env]
MCP_TRANSPORT = "stdio"
`);
    writeSkill('.agents/skills');

    const result = inspectAgentReadiness('codex', readinessOptions());

    expect(result.ready).toBe(true);
    expect(result.status).toBe('ready');
    expect(result.mcp.transport).toBe('stdio');
    expect(result.mcp.configPath).toBe(path.join(tempHome, '.codex', 'config.toml'));
    expect(result.skill.workspacePath).toBe(path.join(tempHome, '.agents', 'skills'));
  });

  it('requires SKILL.md, not just a skill directory name', () => {
    writeHomeFile('.codex/config.toml', `
[mcp_servers.mindos]
type = "stdio"
command = "mindos"
args = ["mcp"]
`);
    fs.mkdirSync(path.join(tempHome, '.agents', 'skills', 'mindos'), { recursive: true });

    const result = inspectAgentReadiness('codex', readinessOptions());

    expect(result.ready).toBe(false);
    expect(result.status).toBe('missing-skill');
    expect(result.skill.installed).toBe(false);
    expect(result.skill.installedSkills).toEqual([]);
  });

  it('uses mindos-zh when the default mindos skill is disabled', () => {
    writeHomeFile('.mindos/config.json', JSON.stringify({ disabledSkills: ['mindos'] }));
    writeHomeFile('.codex/config.toml', `
[mcp_servers.mindos]
type = "stdio"
command = "mindos"
args = ["mcp"]
`);
    writeSkill('.agents/skills', 'mindos-zh');

    expect(getActiveSkillName({ homeDir: tempHome })).toBe('mindos-zh');

    const result = inspectAgentReadiness('codex', readinessOptions());
    expect(result.ready).toBe(true);
    expect(result.skill.skillName).toBe('mindos-zh');
  });

  it('detects nested JSON MCP config for CoPaw', () => {
    writeHomeFile('.copaw/config.json', JSON.stringify({
      mcp: {
        clients: {
          mindos: {
            type: 'stdio',
            command: 'mindos',
            args: ['mcp'],
          },
        },
      },
    }, null, 2));
    writeSkill('.copaw/skills');

    const mcp = detectMindosMcpConfig('copaw', { homeDir: tempHome });
    expect(mcp.configured).toBe(true);
    expect(mcp.scope).toBe('global');

    const result = inspectAgentReadiness('copaw', readinessOptions());
    expect(result.ready).toBe(true);
    expect(result.skill.workspacePath).toBe(path.join(tempHome, '.copaw', 'skills'));
  });

  it('detects YAML MCP config for Hermes', () => {
    writeHomeFile('.hermes/config.yaml', `
mcp_servers:
  mindos:
    command: "mindos"
    args: ["mcp"]
    env:
      MCP_TRANSPORT: "stdio"
`);
    writeSkill('.hermes/skills');

    const result = inspectAgentReadiness('hermes', readinessOptions());

    expect(result.ready).toBe(true);
    expect(result.mcp.configured).toBe(true);
    expect(result.mcp.transport).toBe('stdio');
  });

  it('marks malformed stdio entries invalid when they do not run mindos mcp', () => {
    writeHomeFile('.codex/config.toml', `
[mcp_servers.mindos]
type = "stdio"
command = "mindos"
args = ["status"]
`);
    writeSkill('.agents/skills');

    const result = inspectAgentReadiness('codex', readinessOptions());

    expect(result.ready).toBe(false);
    expect(result.status).toBe('invalid-mcp');
    expect(result.mcp.issues).toContain('MindOS MCP stdio command must include the `mcp` argument.');
  });

  it('resolves universal and additional skill workspaces deterministically', () => {
    expect(resolveSkillWorkspaceProfile('codex', { homeDir: tempHome }).workspacePath)
      .toBe(path.join(tempHome, '.agents', 'skills'));
    expect(resolveSkillWorkspaceProfile('claude-code', { homeDir: tempHome }).workspacePath)
      .toBe(path.join(tempHome, '.claude', 'skills'));
  });

  it('installs packaged skills locally for universal and additional agents', () => {
    const sourceRoot = path.join(tempHome, 'source-skills');
    fs.mkdirSync(path.join(sourceRoot, 'mindos'), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, 'mindos', 'SKILL.md'), '# mindos\n', 'utf-8');

    const result = installMindosSkillsForAgents(['codex', 'claude-code'], {
      homeDir: tempHome,
      skillName: 'mindos',
      skillSources: [sourceRoot],
    });

    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(tempHome, '.agents', 'skills', 'mindos', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(tempHome, '.claude', 'skills', 'mindos', 'SKILL.md'))).toBe(true);
    expect(result.results.map((item) => item.status).sort()).toEqual(['copied', 'copied']);
  });

  it('repairs a partial skill directory that is missing SKILL.md', () => {
    const sourceRoot = path.join(tempHome, 'source-skills');
    fs.mkdirSync(path.join(sourceRoot, 'mindos'), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, 'mindos', 'SKILL.md'), '# mindos\n', 'utf-8');
    fs.mkdirSync(path.join(tempHome, '.agents', 'skills', 'mindos'), { recursive: true });

    const result = installMindosSkillsForAgents(['codex'], {
      homeDir: tempHome,
      skillName: 'mindos',
      skillSources: [sourceRoot],
    });

    expect(result.ok).toBe(true);
    expect(result.results[0].status).toBe('repaired');
    expect(fs.existsSync(path.join(tempHome, '.agents', 'skills', 'mindos', 'SKILL.md'))).toBe(true);
  });
});

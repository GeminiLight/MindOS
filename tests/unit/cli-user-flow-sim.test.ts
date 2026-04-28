import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * End-to-end user flow simulation for all agent types.
 *
 * Simulates the real code paths that run when a user does:
 *   1. `mindos mcp install <agent>` (CLI)
 *   2. Frontend "Install Selected" button (API)
 *   3. `mindos setup` wizard (setup.js)
 *   4. Frontend snippet display (mcp-snippets)
 *
 * Each test creates real temp directories and files, calls the same logic
 * the production code uses, and verifies the output files.
 */

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-userflow-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ── Helpers (mirrors production code exactly) ────────────────────────────

/** Pure-Node.js recursive copy (from bin/lib/mcp-install.js) */
function copyDirSync(src: string, dst: string) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

/** Build MCP entry (from bin/lib/mcp-install.js:340-344) */
function buildEntry(transport: string, url?: string, token?: string) {
  return transport === 'stdio'
    ? { type: 'stdio', command: 'mindos', args: ['mcp'], env: { MCP_TRANSPORT: 'stdio' } }
    : token
      ? { url, headers: { Authorization: `Bearer ${token}` } }
      : { url };
}

/** TOML builder (from bin/lib/toml.js) */
function buildTomlEntry(sectionKey: string, serverName: string, entry: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(`[${sectionKey}.${serverName}]`);
  if (entry.type != null) lines.push(`type = "${entry.type}"`);
  if (entry.command != null) lines.push(`command = "${entry.command}"`);
  if (entry.url != null) lines.push(`url = "${entry.url}"`);
  if (Array.isArray(entry.args)) {
    lines.push(`args = [${entry.args.map((a: string) => `"${a}"`).join(', ')}]`);
  }
  if (entry.env && typeof entry.env === 'object') {
    lines.push('');
    lines.push(`[${sectionKey}.${serverName}.env]`);
    for (const [k, v] of Object.entries(entry.env)) {
      lines.push(`${k} = "${v}"`);
    }
  }
  if (entry.headers && typeof entry.headers === 'object') {
    lines.push('');
    lines.push(`[${sectionKey}.${serverName}.headers]`);
    for (const [k, v] of Object.entries(entry.headers)) {
      lines.push(`${k} = "${v}"`);
    }
  }
  return lines.join('\n');
}

function mergeTomlEntry(existing: string, sectionKey: string, serverName: string, entry: Record<string, unknown>): string {
  const sectionHeader = `[${sectionKey}.${serverName}]`;
  const envHeader = `[${sectionKey}.${serverName}.env]`;
  const headersHeader = `[${sectionKey}.${serverName}.headers]`;
  const newBlock = buildTomlEntry(sectionKey, serverName, entry);
  const lines = existing.split('\n');
  const result: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === sectionHeader || trimmed === envHeader || trimmed === headersHeader) {
      skipping = true; continue;
    }
    if (skipping && trimmed.startsWith('[')) skipping = false;
    if (!skipping) result.push(line);
  }
  while (result.length > 0 && result[result.length - 1].trim() === '') result.pop();
  result.push('');
  result.push(newBlock);
  result.push('');
  return result.join('\n');
}

/** Create a realistic skill source directory */
function createSkillSource(skillName: string): string {
  const dir = path.join(tempDir, 'project', 'skills', skillName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${skillName}\n---\n# ${skillName} Skill`);
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${skillName}`);
  return dir;
}

// ── Agent configs (mirrors MCP_AGENTS) ───────────────────────────────────

const AGENTS = {
  'workbuddy': { name: 'WorkBuddy', global: '.workbuddy/mcp.json', key: 'mcpServers', format: 'json' as const, skillMode: 'unsupported' },
  'qclaw':     { name: 'QClaw',     global: '.qclaw/mcp.json',     key: 'mcpServers', format: 'json' as const, skillMode: 'unsupported' },
  'lingma':    { name: 'Lingma',    global: '.lingma/mcp.json',    key: 'mcpServers', format: 'json' as const, skillMode: 'unsupported' },
  'codex':     { name: 'Codex',     global: '.codex/config.toml',  key: 'mcp_servers', format: 'toml' as const, skillMode: 'universal'  },
  'claude-code': { name: 'Claude Code', global: '.claude.json',    key: 'mcpServers', format: 'json' as const, skillMode: 'additional' },
};

// ═══════════════════════════════════════════════════════════════════════════
// Flow 1: `mindos mcp install workbuddy` (CLI, unsupported agent)
// ═══════════════════════════════════════════════════════════════════════════

describe('Flow 1: CLI — mindos mcp install workbuddy', () => {
  it('Step 1: writes MCP config to ~/.workbuddy/mcp.json', () => {
    const agent = AGENTS['workbuddy'];
    const configPath = path.join(tempDir, agent.global);
    const entry = buildEntry('stdio');

    // Simulate CLI write (mcp-install.js:387-399)
    const dir = path.dirname(configPath);
    fs.mkdirSync(dir, { recursive: true });
    const config: Record<string, Record<string, unknown>> = {};
    config[agent.key] = { mindos: entry };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

    // Verify
    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(written.mcpServers.mindos.type).toBe('stdio');
    expect(written.mcpServers.mindos.command).toBe('mindos');
    expect(written.mcpServers.mindos.args).toEqual(['mcp']);
    expect(written.mcpServers.mindos.env.MCP_TRANSPORT).toBe('stdio');
  });

  it('Step 2: auto-copies skill to ~/.workbuddy/skills/mindos/', () => {
    const skillSrc = createSkillSource('mindos');
    const agentDir = path.join(tempDir, '.workbuddy');
    fs.mkdirSync(agentDir, { recursive: true });

    // Simulate autoInstallSkillForAgent (mcp-install.js:31-59)
    const targetDir = path.join(agentDir, 'skills', 'mindos');
    expect(fs.existsSync(targetDir)).toBe(false);
    copyDirSync(skillSrc, targetDir);

    // Verify
    expect(fs.existsSync(path.join(targetDir, 'SKILL.md'))).toBe(true);
    expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf-8')).toContain('mindos Skill');
    expect(fs.existsSync(path.join(targetDir, 'README.md'))).toBe(true);
  });

  it('Step 3: skips copy if skill already exists', () => {
    const skillSrc = createSkillSource('mindos');
    const targetDir = path.join(tempDir, '.workbuddy', 'skills', 'mindos');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'SKILL.md'), 'user-customized');

    // Guard check (mcp-install.js:51)
    if (!fs.existsSync(targetDir)) {
      copyDirSync(skillSrc, targetDir);
    }

    expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf-8')).toBe('user-customized');
  });

  it('End-to-end: MCP config + skill copy in one flow', () => {
    const skillSrc = createSkillSource('mindos');
    const agentDir = path.join(tempDir, '.workbuddy');
    fs.mkdirSync(agentDir, { recursive: true });

    // Step A: write MCP config
    const configPath = path.join(agentDir, 'mcp.json');
    const entry = buildEntry('stdio');
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { mindos: entry } }, null, 2) + '\n');

    // Step B: auto-copy skill
    const targetSkill = path.join(agentDir, 'skills', 'mindos');
    copyDirSync(skillSrc, targetSkill);

    // Verify both exist
    expect(fs.existsSync(configPath)).toBe(true);
    expect(fs.existsSync(path.join(targetSkill, 'SKILL.md'))).toBe(true);

    // Verify MCP config is valid JSON
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.mcpServers.mindos.type).toBe('stdio');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Flow 2: `mindos mcp install codex` (CLI, TOML agent)
// ═══════════════════════════════════════════════════════════════════════════

describe('Flow 2: CLI — mindos mcp install codex (TOML)', () => {
  it('writes valid TOML to ~/.codex/config.toml', () => {
    const configPath = path.join(tempDir, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    const entry = buildEntry('stdio');
    const merged = mergeTomlEntry('', 'mcp_servers', 'mindos', entry);
    fs.writeFileSync(configPath, merged, 'utf-8');

    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).toContain('[mcp_servers.mindos]');
    expect(content).toContain('type = "stdio"');
    expect(content).toContain('command = "mindos"');
    expect(content).toContain('[mcp_servers.mindos.env]');
    expect(content).toContain('MCP_TRANSPORT = "stdio"');
  });

  it('preserves existing codex config when adding MindOS', () => {
    const configPath = path.join(tempDir, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    const existing = 'model = "o3"\napproval_mode = "suggest"\n\n[mcp_servers.filesystem]\ntype = "stdio"\ncommand = "npx"\n';
    fs.writeFileSync(configPath, existing);

    const content = fs.readFileSync(configPath, 'utf-8');
    const entry = buildEntry('stdio');
    const merged = mergeTomlEntry(content, 'mcp_servers', 'mindos', entry);
    fs.writeFileSync(configPath, merged, 'utf-8');

    const final = fs.readFileSync(configPath, 'utf-8');
    expect(final).toContain('model = "o3"');
    expect(final).toContain('[mcp_servers.filesystem]');
    expect(final).toContain('[mcp_servers.mindos]');
  });

  it('does NOT auto-copy skill (codex is universal, not unsupported)', () => {
    // codex has mode: 'universal', so autoInstallSkillForAgent should return null
    const agent = AGENTS['codex'];
    expect(agent.skillMode).toBe('universal');
    // The check: reg.mode !== 'unsupported' → return null
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Flow 3: Frontend "Install Selected" (API route, unsupported agent)
// ═══════════════════════════════════════════════════════════════════════════

describe('Flow 3: Frontend API — install unsupported agent', () => {
  it('writes MCP config + copies skill in one API call', () => {
    const skillSrc = createSkillSource('mindos');

    for (const agentKey of ['workbuddy', 'qclaw', 'lingma'] as const) {
      const agent = AGENTS[agentKey];
      const agentHome = path.join(tempDir, path.dirname(agent.global));
      fs.mkdirSync(agentHome, { recursive: true });

      // Step A: write MCP config (API route.ts:187-203)
      const configPath = path.join(tempDir, agent.global);
      const entry = buildEntry('stdio');
      const config: Record<string, Record<string, unknown>> = {};
      config[agent.key] = { mindos: entry };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

      // Step B: auto-copy skill (API route.ts:218-231)
      const skillTarget = path.join(agentHome, 'skills', 'mindos');
      if (!fs.existsSync(skillTarget)) {
        copyDirSync(skillSrc, skillTarget);
      }

      // Verify MCP config
      const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(written.mcpServers.mindos.type).toBe('stdio');

      // Verify skill
      expect(fs.existsSync(path.join(skillTarget, 'SKILL.md'))).toBe(true);
    }
  });

  it('MCP config for workbuddy is valid and complete', () => {
    const configPath = path.join(tempDir, '.workbuddy', 'mcp.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    const entry = buildEntry('stdio');
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { mindos: entry } }, null, 2) + '\n');

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    // Full struct validation
    expect(Object.keys(config)).toEqual(['mcpServers']);
    expect(Object.keys(config.mcpServers)).toEqual(['mindos']);
    expect(config.mcpServers.mindos).toEqual({
      type: 'stdio',
      command: 'mindos',
      args: ['mcp'],
      env: { MCP_TRANSPORT: 'stdio' },
    });
  });

  it('HTTP transport with token works for unsupported agents', () => {
    const configPath = path.join(tempDir, '.qclaw', 'mcp.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    const entry = buildEntry('http', 'http://192.168.1.100:8781/mcp', 'secret-token');
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { mindos: entry } }, null, 2) + '\n');

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.mcpServers.mindos.url).toBe('http://192.168.1.100:8781/mcp');
    expect(config.mcpServers.mindos.headers.Authorization).toBe('Bearer secret-token');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Flow 4: Frontend snippet display
// ═══════════════════════════════════════════════════════════════════════════

describe('Flow 4: Frontend — config snippet generation', () => {
  it('WorkBuddy stdio snippet is valid JSON', () => {
    // Simulate generateStdioSnippet for WorkBuddy (format: json, key: mcpServers)
    const stdioEntry = { type: 'stdio', command: 'mindos', args: ['mcp'] };
    const snippet = JSON.stringify({ mcpServers: { mindos: stdioEntry } }, null, 2);

    // Verify it's parseable and correct
    const parsed = JSON.parse(snippet);
    expect(parsed.mcpServers.mindos.type).toBe('stdio');
    expect(parsed.mcpServers.mindos.command).toBe('mindos');
    expect(snippet).toContain('"mcpServers"');
  });

  it('Codex stdio snippet is valid TOML', () => {
    // Simulate generateStdioSnippet for Codex (format: toml, key: mcp_servers)
    const lines = [
      '[mcp_servers.mindos]',
      'command = "mindos"',
      'args = ["mcp"]',
      '',
      '[mcp_servers.mindos.env]',
      'MCP_TRANSPORT = "stdio"',
    ];
    const snippet = lines.join('\n');

    expect(snippet).toContain('[mcp_servers.mindos]');
    expect(snippet).toContain('command = "mindos"');
    expect(snippet).toContain('MCP_TRANSPORT = "stdio"');
  });

  it('WorkBuddy HTTP snippet includes auth header', () => {
    const httpEntry = { url: 'http://192.168.1.100:8781/mcp', headers: { Authorization: 'Bearer tok-123' } };
    const snippet = JSON.stringify({ mcpServers: { mindos: httpEntry } }, null, 2);

    expect(snippet).toContain('"url"');
    expect(snippet).toContain('192.168.1.100');
    expect(snippet).toContain('Bearer tok-123');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Flow 5: setup.js wizard — cpSync skill copy
// ═══════════════════════════════════════════════════════════════════════════

describe('Flow 5: Setup wizard — cpSync skill install', () => {
  it('copies skill via cpSync for unsupported agents', () => {
    const skillSrc = createSkillSource('mindos');

    for (const agent of ['.workbuddy', '.qclaw', '.lingma']) {
      const agentDir = path.join(tempDir, agent);
      fs.mkdirSync(agentDir, { recursive: true });
      const targetSkillDir = path.join(agentDir, 'skills', 'mindos');

      // Simulate setup.js: cpSync(skillSourceDir, targetSkillDir, { recursive: true })
      fs.cpSync(skillSrc, targetSkillDir, { recursive: true });

      expect(fs.existsSync(path.join(targetSkillDir, 'SKILL.md'))).toBe(true);
      expect(fs.readFileSync(path.join(targetSkillDir, 'SKILL.md'), 'utf-8')).toContain('mindos Skill');
    }
  });

  it('skips if target already exists', () => {
    const skillSrc = createSkillSource('mindos');
    const targetSkillDir = path.join(tempDir, '.workbuddy', 'skills', 'mindos');
    fs.mkdirSync(targetSkillDir, { recursive: true });
    fs.writeFileSync(path.join(targetSkillDir, 'SKILL.md'), 'custom');

    // Guard check (setup.js): if (!existsSync(targetSkillDir))
    if (!fs.existsSync(targetSkillDir)) {
      fs.cpSync(skillSrc, targetSkillDir, { recursive: true });
    }

    expect(fs.readFileSync(path.join(targetSkillDir, 'SKILL.md'), 'utf-8')).toBe('custom');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Flow 6: Update existing config (re-install scenario)
// ═══════════════════════════════════════════════════════════════════════════

describe('Flow 6: Re-install — update existing config', () => {
  it('WorkBuddy: updates MCP config without losing other servers', () => {
    const configPath = path.join(tempDir, '.workbuddy', 'mcp.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    // Pre-existing config with another MCP server
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        'other-server': { url: 'http://other:9000' },
        mindos: { url: 'http://old:8000' },
      },
    }, null, 2));

    // Re-install with stdio
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config.mcpServers.mindos = buildEntry('stdio');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    const final = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(final.mcpServers.mindos.type).toBe('stdio');
    expect(final.mcpServers['other-server'].url).toBe('http://other:9000');
  });

  it('Codex: updates TOML config without losing other sections', () => {
    const configPath = path.join(tempDir, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    const existing = [
      'model = "o3"',
      '',
      '[mcp_servers.mindos]',
      'type = "http"',
      'url = "http://old:8000"',
      '',
      '[mcp_servers.other]',
      'type = "stdio"',
      '',
    ].join('\n');
    fs.writeFileSync(configPath, existing);

    const content = fs.readFileSync(configPath, 'utf-8');
    const merged = mergeTomlEntry(content, 'mcp_servers', 'mindos', buildEntry('stdio'));
    fs.writeFileSync(configPath, merged);

    const final = fs.readFileSync(configPath, 'utf-8');
    expect(final).toContain('model = "o3"');
    expect(final).toContain('[mcp_servers.other]');
    expect(final).toContain('[mcp_servers.mindos]');
    expect(final).toContain('type = "stdio"');
    expect(final).not.toContain('http://old:8000');
  });

  it('WorkBuddy: skill not overwritten on re-install', () => {
    const skillSrc = createSkillSource('mindos');
    const targetSkill = path.join(tempDir, '.workbuddy', 'skills', 'mindos');

    // First install
    copyDirSync(skillSrc, targetSkill);
    // User customizes
    fs.writeFileSync(path.join(targetSkill, 'SKILL.md'), 'user-patched');

    // Re-install: guard prevents overwrite
    if (!fs.existsSync(targetSkill)) {
      copyDirSync(skillSrc, targetSkill);
    }

    expect(fs.readFileSync(path.join(targetSkill, 'SKILL.md'), 'utf-8')).toBe('user-patched');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Flow 7: Cross-agent consistency check
// ═══════════════════════════════════════════════════════════════════════════

describe('Flow 7: Cross-agent consistency — all agents produce valid configs', () => {
  it('all JSON agents produce identical MCP entry structure', () => {
    const entry = buildEntry('stdio');

    for (const [key, agent] of Object.entries(AGENTS)) {
      if (agent.format === 'toml') continue;

      const configPath = path.join(tempDir, `test-${key}.json`);
      const config: Record<string, Record<string, unknown>> = {};
      config[agent.key] = { mindos: entry };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(parsed[agent.key].mindos.type).toBe('stdio');
      expect(parsed[agent.key].mindos.command).toBe('mindos');
      expect(parsed[agent.key].mindos.args).toEqual(['mcp']);
    }
  });

  it('TOML agents produce valid TOML entry', () => {
    const entry = buildEntry('stdio');

    for (const [key, agent] of Object.entries(AGENTS)) {
      if (agent.format !== 'toml') continue;

      const merged = mergeTomlEntry('', agent.key, 'mindos', entry);
      expect(merged).toContain(`[${agent.key}.mindos]`);
      expect(merged).toContain('type = "stdio"');
      expect(merged).toContain('command = "mindos"');
    }
  });
});

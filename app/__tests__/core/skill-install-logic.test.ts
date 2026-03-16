import { describe, it, expect } from 'vitest';

/**
 * Tests the CLI skill install logic (scripts/setup.js) by replicating the
 * pure functions. This validates agent filtering, command building, and
 * source selection without actually spawning npx.
 */

/* ── Replicated constants from scripts/setup.js ──────────────────── */

const UNIVERSAL_AGENTS = new Set([
  'amp', 'cline', 'codex', 'cursor', 'gemini-cli',
  'github-copilot', 'kimi-cli', 'opencode', 'warp',
]);

const SKILL_UNSUPPORTED = new Set(['claude-desktop']);

const AGENT_NAME_MAP: Record<string, string> = {
  'claude-code': 'claude-code',
  'windsurf': 'windsurf',
  'trae': 'trae',
  'openclaw': 'openclaw',
  'codebuddy': 'codebuddy',
};

/* ── Replicated logic from scripts/setup.js ──────────────────────── */

function filterAgents(selectedAgents: string[]): string[] {
  return selectedAgents
    .filter(key => !UNIVERSAL_AGENTS.has(key) && !SKILL_UNSUPPORTED.has(key))
    .map(key => AGENT_NAME_MAP[key] || key);
}

function buildAgentFlags(additionalAgents: string[]): string {
  return additionalAgents.length > 0
    ? additionalAgents.map(a => `-a ${a}`).join(' ')
    : '-a universal';
}

function buildCommand(source: string, skillName: string, agentFlags: string): string {
  const quotedSource = /[/\\]/.test(source) ? `"${source}"` : source;
  return `npx skills add ${quotedSource} --skill ${skillName} ${agentFlags} -g -y`;
}

function resolveSkillName(template: string): string {
  return template === 'zh' ? 'mindos-zh' : 'mindos';
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe('CLI skill install — skill name resolution', () => {
  it('zh template → mindos-zh', () => {
    expect(resolveSkillName('zh')).toBe('mindos-zh');
  });

  it('en template → mindos', () => {
    expect(resolveSkillName('en')).toBe('mindos');
  });

  it('empty template → mindos', () => {
    expect(resolveSkillName('empty')).toBe('mindos');
  });

  it('custom template → mindos', () => {
    expect(resolveSkillName('custom')).toBe('mindos');
  });
});

describe('CLI skill install — agent filtering', () => {
  it('filters out all universal agents', () => {
    const agents = ['amp', 'cline', 'codex', 'cursor', 'gemini-cli', 'github-copilot', 'kimi-cli', 'opencode', 'warp'];
    expect(filterAgents(agents)).toEqual([]);
  });

  it('keeps non-universal agents', () => {
    expect(filterAgents(['claude-code', 'windsurf', 'trae'])).toEqual(['claude-code', 'windsurf', 'trae']);
  });

  it('filters out skill-unsupported agents', () => {
    expect(filterAgents(['claude-desktop'])).toEqual([]);
    expect(filterAgents(['claude-desktop', 'claude-code'])).toEqual(['claude-code']);
  });

  it('handles mixed universal + non-universal + unsupported', () => {
    const result = filterAgents(['cursor', 'claude-code', 'cline', 'windsurf', 'claude-desktop', 'trae']);
    expect(result).toEqual(['claude-code', 'windsurf', 'trae']);
  });

  it('maps agent names via AGENT_NAME_MAP', () => {
    const result = filterAgents(['openclaw', 'codebuddy']);
    expect(result).toEqual(['openclaw', 'codebuddy']);
  });

  it('passes through unknown non-universal agents as-is', () => {
    const result = filterAgents(['some-new-agent']);
    expect(result).toEqual(['some-new-agent']);
  });

  it('handles empty input', () => {
    expect(filterAgents([])).toEqual([]);
  });
});

describe('CLI skill install — agent flag building', () => {
  it('builds separate -a flags for multiple agents', () => {
    const flags = buildAgentFlags(['claude-code', 'windsurf', 'trae']);
    expect(flags).toBe('-a claude-code -a windsurf -a trae');
  });

  it('builds single -a flag for one agent', () => {
    expect(buildAgentFlags(['claude-code'])).toBe('-a claude-code');
  });

  it('falls back to -a universal for empty array', () => {
    expect(buildAgentFlags([])).toBe('-a universal');
  });

  it('never produces comma-separated agents', () => {
    const flags = buildAgentFlags(['claude-code', 'windsurf']);
    expect(flags).not.toContain(',');
  });
});

describe('CLI skill install — command building', () => {
  it('builds correct GitHub source command (quoted due to /)', () => {
    const cmd = buildCommand('GeminiLight/MindOS', 'mindos', '-a universal');
    // GitHub source contains / which triggers quoting — harmless, shell handles it fine
    expect(cmd).toBe('npx skills add "GeminiLight/MindOS" --skill mindos -a universal -g -y');
  });

  it('quotes local paths', () => {
    const cmd = buildCommand('/home/user/project/skills', 'mindos-zh', '-a claude-code');
    expect(cmd).toBe('npx skills add "/home/user/project/skills" --skill mindos-zh -a claude-code -g -y');
  });

  it('does not quote simple names without / or \\', () => {
    const cmd = buildCommand('some-npm-package', 'mindos', '-a universal');
    expect(cmd).not.toContain('"some-npm-package"');
    expect(cmd).toContain('some-npm-package');
  });

  it('quotes Windows-style local paths', () => {
    const cmd = buildCommand('C:\\Users\\me\\skills', 'mindos', '-a universal');
    expect(cmd).toContain('"C:\\Users\\me\\skills"');
  });
});

describe('CLI skill install — end-to-end scenarios', () => {
  function simulate(template: string, selectedAgents: string[]) {
    const skillName = resolveSkillName(template);
    const filtered = filterAgents(selectedAgents);
    const agentFlags = buildAgentFlags(filtered);
    return buildCommand('GeminiLight/MindOS', skillName, agentFlags);
  }

  it('S1: cursor + claude-code, zh', () => {
    const cmd = simulate('zh', ['cursor', 'claude-code']);
    expect(cmd).toBe('npx skills add "GeminiLight/MindOS" --skill mindos-zh -a claude-code -g -y');
  });

  it('S2: cursor + cline + gemini-cli, en', () => {
    const cmd = simulate('en', ['cursor', 'cline', 'gemini-cli']);
    expect(cmd).toBe('npx skills add "GeminiLight/MindOS" --skill mindos -a universal -g -y');
  });

  it('S3: claude-code + windsurf + trae + claude-desktop, zh', () => {
    const cmd = simulate('zh', ['claude-code', 'windsurf', 'trae', 'claude-desktop']);
    expect(cmd).toBe('npx skills add "GeminiLight/MindOS" --skill mindos-zh -a claude-code -a windsurf -a trae -g -y');
  });

  it('S4: claude-desktop only, en', () => {
    const cmd = simulate('en', ['claude-desktop']);
    expect(cmd).toBe('npx skills add "GeminiLight/MindOS" --skill mindos -a universal -g -y');
  });

  it('S5: all universal agents, zh', () => {
    const cmd = simulate('zh', ['amp', 'cline', 'codex', 'cursor']);
    expect(cmd).toBe('npx skills add "GeminiLight/MindOS" --skill mindos-zh -a universal -g -y');
  });

  it('S6: single non-universal (windsurf), en', () => {
    const cmd = simulate('en', ['windsurf']);
    expect(cmd).toBe('npx skills add "GeminiLight/MindOS" --skill mindos -a windsurf -g -y');
  });

  it('S7: all supported non-universal agents, zh', () => {
    const cmd = simulate('zh', ['claude-code', 'windsurf', 'trae', 'openclaw', 'codebuddy']);
    expect(cmd).toBe('npx skills add "GeminiLight/MindOS" --skill mindos-zh -a claude-code -a windsurf -a trae -a openclaw -a codebuddy -g -y');
  });
});

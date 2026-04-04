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

const SKILL_UNSUPPORTED = new Set<string>([]);

const SKILL_AGENT_REGISTRY: Record<string, { mode: 'universal' | 'additional' | 'unsupported'; skillAgentName?: string }> = {
  'claude-code': { mode: 'additional', skillAgentName: 'claude-code' },
  'cursor': { mode: 'universal' },
  'windsurf': { mode: 'additional', skillAgentName: 'windsurf' },
  'cline': { mode: 'universal' },
  'trae': { mode: 'additional', skillAgentName: 'trae' },
  'gemini-cli': { mode: 'universal' },
  'openclaw': { mode: 'additional', skillAgentName: 'openclaw' },
  'codebuddy': { mode: 'additional', skillAgentName: 'codebuddy' },
  'iflow-cli': { mode: 'additional', skillAgentName: 'iflow-cli' },
  'kimi-cli': { mode: 'universal' },
  'opencode': { mode: 'universal' },
  'pi': { mode: 'additional', skillAgentName: 'pi' },
  'augment': { mode: 'additional', skillAgentName: 'augment' },
  'qwen-code': { mode: 'additional', skillAgentName: 'qwen-code' },
  'qoder': { mode: 'additional', skillAgentName: 'qoder' },
  'trae-cn': { mode: 'additional', skillAgentName: 'trae-cn' },
  'roo': { mode: 'additional', skillAgentName: 'roo' },
  'github-copilot': { mode: 'universal' },
  'codex': { mode: 'universal' },
};

/* ── Replicated logic from scripts/setup.js ──────────────────────── */

function filterAgents(selectedAgents: string[]): string[] {
  return selectedAgents.flatMap((key) => {
    if (SKILL_UNSUPPORTED.has(key)) return [];
    if (UNIVERSAL_AGENTS.has(key)) return [];
    const reg = SKILL_AGENT_REGISTRY[key];
    if (!reg) return [key];
    if (reg.mode === 'unsupported' || reg.mode === 'universal') return [];
    return [reg.skillAgentName || key];
  });
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

  it('handles mixed universal + non-universal', () => {
    const result = filterAgents(['cursor', 'claude-code', 'cline', 'windsurf', 'trae']);
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

  it('S3: claude-code + windsurf + trae, zh', () => {
    const cmd = simulate('zh', ['claude-code', 'windsurf', 'trae']);
    expect(cmd).toBe('npx skills add "GeminiLight/MindOS" --skill mindos-zh -a claude-code -a windsurf -a trae -g -y');
  });

  it('S4: only universal agents, en', () => {
    const cmd = simulate('en', ['cursor', 'cline']);
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

  it('S8: new agents (augment + roo + pi), en', () => {
    const cmd = simulate('en', ['augment', 'roo', 'pi']);
    expect(cmd).toBe('npx skills add "GeminiLight/MindOS" --skill mindos -a augment -a roo -a pi -g -y');
  });

  it('S9: mix of old + new non-universal agents, zh', () => {
    const cmd = simulate('zh', ['claude-code', 'augment', 'trae-cn', 'qwen-code']);
    expect(cmd).toBe('npx skills add "GeminiLight/MindOS" --skill mindos-zh -a claude-code -a augment -a trae-cn -a qwen-code -g -y');
  });

  it('S9b: includes qoder in additional-agent flags', () => {
    const cmd = simulate('en', ['qoder', 'cursor']);
    expect(cmd).toBe('npx skills add "GeminiLight/MindOS" --skill mindos -a qoder -g -y');
  });

  it('S9c: github-copilot should use universal fallback (no explicit -a)', () => {
    const cmd = simulate('en', ['github-copilot']);
    expect(cmd).toBe('npx skills add "GeminiLight/MindOS" --skill mindos -a universal -g -y');
  });

  it('S10: kimi-cli + opencode are universal, should be filtered', () => {
    const cmd = simulate('en', ['kimi-cli', 'opencode', 'iflow-cli']);
    expect(cmd).toBe('npx skills add "GeminiLight/MindOS" --skill mindos -a iflow-cli -g -y');
  });
});

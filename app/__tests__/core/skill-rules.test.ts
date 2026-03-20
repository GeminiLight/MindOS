import { describe, it, expect, beforeEach } from 'vitest';
import { seedFile, testMindRoot } from '../setup';
import { loadSkillRules, type SkillRulesResult } from '@/lib/agent/skill-rules';

// ---------------------------------------------------------------------------
// loadSkillRules — reads skill-rules.md + user-rules.md from knowledge base
// ---------------------------------------------------------------------------

describe('skill-rules: loadSkillRules', () => {
  // Normal path: both files exist
  it('loads both skill-rules.md and user-rules.md when present', () => {
    seedFile('.agents/skills/mindos/skill-rules.md', '# Skill Rules\nCore rules here.');
    seedFile('.agents/skills/mindos/user-rules.md', '# User Rules\nPreferences here.');

    const result = loadSkillRules(testMindRoot, 'mindos');

    expect(result.skillRules.ok).toBe(true);
    expect(result.skillRules.content).toContain('# Skill Rules');
    expect(result.userRules.ok).toBe(true);
    expect(result.userRules.content).toContain('# User Rules');
  });

  // Normal path: only skill-rules exists
  it('loads skill-rules.md when user-rules.md is absent', () => {
    seedFile('.agents/skills/mindos/skill-rules.md', '# Rules only');

    const result = loadSkillRules(testMindRoot, 'mindos');

    expect(result.skillRules.ok).toBe(true);
    expect(result.skillRules.content).toContain('# Rules only');
    expect(result.userRules.ok).toBe(false);
  });

  // Normal path: Chinese skill variant
  it('loads from mindos-zh directory when skillName is mindos-zh', () => {
    seedFile('.agents/skills/mindos-zh/skill-rules.md', '# 中文规则');
    seedFile('.agents/skills/mindos-zh/user-rules.md', '# 用户偏好');

    const result = loadSkillRules(testMindRoot, 'mindos-zh');

    expect(result.skillRules.ok).toBe(true);
    expect(result.skillRules.content).toContain('# 中文规则');
    expect(result.userRules.ok).toBe(true);
    expect(result.userRules.content).toContain('# 用户偏好');
  });

  // Error path: directory does not exist at all
  it('returns ok:false for both when .agents/skills/ directory is absent', () => {
    // No seedFile — directory doesn't exist
    const result = loadSkillRules(testMindRoot, 'mindos');

    expect(result.skillRules.ok).toBe(false);
    expect(result.userRules.ok).toBe(false);
  });

  // Error path: mindRoot itself does not exist
  it('returns ok:false when mindRoot path does not exist', () => {
    const result = loadSkillRules('/tmp/nonexistent-mindos-root-xyz', 'mindos');

    expect(result.skillRules.ok).toBe(false);
    expect(result.userRules.ok).toBe(false);
  });

  // Boundary: empty file
  it('returns ok:true but empty content for empty files', () => {
    seedFile('.agents/skills/mindos/skill-rules.md', '');
    seedFile('.agents/skills/mindos/user-rules.md', '   \n  ');

    const result = loadSkillRules(testMindRoot, 'mindos');

    expect(result.skillRules.ok).toBe(true);
    expect(result.skillRules.content).toBe('');
    expect(result.skillRules.empty).toBe(true);

    expect(result.userRules.ok).toBe(true);
    expect(result.userRules.empty).toBe(true);
  });

  // Boundary: very large file — should be truncated
  it('truncates large files over the limit', () => {
    const hugeContent = 'x'.repeat(25_000);
    seedFile('.agents/skills/mindos/skill-rules.md', hugeContent);

    const result = loadSkillRules(testMindRoot, 'mindos');

    expect(result.skillRules.ok).toBe(true);
    expect(result.skillRules.truncated).toBe(true);
    expect(result.skillRules.content.length).toBeLessThan(25_000);
    expect(result.skillRules.content).toContain('[...truncated');
  });

  // Boundary: file with Unicode / emoji content
  it('handles Unicode and emoji content', () => {
    seedFile('.agents/skills/mindos/skill-rules.md', '# 规则 🎯\n用中文写的规则');

    const result = loadSkillRules(testMindRoot, 'mindos');

    expect(result.skillRules.ok).toBe(true);
    expect(result.skillRules.content).toContain('🎯');
    expect(result.skillRules.content).toContain('中文');
  });

  // Boundary: special characters in content
  it('handles special characters without corruption', () => {
    const content = '# Rules\n\nPath: `C:\\Users\\test`\nRegex: /^[a-z]+$/\n<!-- comment -->';
    seedFile('.agents/skills/mindos/skill-rules.md', content);

    const result = loadSkillRules(testMindRoot, 'mindos');

    expect(result.skillRules.ok).toBe(true);
    expect(result.skillRules.content).toBe(content);
  });
});

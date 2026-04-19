import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8');
const exists = (relativePath: string) => existsSync(path.join(root, relativePath));

describe('MindOS skill copy alignment', () => {
  it('keeps source and app skill copies aligned for default skill', () => {
    expect(read('skills/mindos/SKILL.md')).toBe(read('app/data/skills/mindos/SKILL.md'));
    expect(read('skills/mindos-zh/SKILL.md')).toBe(read('app/data/skills/mindos-zh/SKILL.md'));
  });

  it('keeps source and app skill copies aligned for max skill', () => {
    // Only check if both source and app copies exist
    if (exists('app/data/skills/mindos-max/SKILL.md')) {
      expect(read('skills/mindos-max/SKILL.md')).toBe(read('app/data/skills/mindos-max/SKILL.md'));
    }
    if (exists('app/data/skills/mindos-max-zh/SKILL.md')) {
      expect(read('skills/mindos-max-zh/SKILL.md')).toBe(read('app/data/skills/mindos-max-zh/SKILL.md'));
    }
  });

  it('removes second-brain wording from aligned skill descriptions', () => {
    const en = read('skills/mindos-max/SKILL.md').toLowerCase();
    const zh = read('skills/mindos-max-zh/SKILL.md');
    expect(en).not.toContain('second brain');
    expect(zh).not.toContain('第二大脑');
    expect(en).toContain('local knowledge assistant');
    expect(zh).toContain('本地知识助手');
  });
});

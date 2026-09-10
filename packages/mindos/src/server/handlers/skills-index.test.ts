import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectSkillInfos, type MindosSkillRoot } from './skills.js';
import { getSkillsIndex, resetSkillsIndexForTests, skillsIndexStats } from './skills-index.js';

let root: string;

function makeSkill(name: string, description = `${name} desc`): void {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nbody\n`, 'utf-8');
}

function roots(): MindosSkillRoot[] {
  return [{ path: root, source: 'user', origin: 'mindos-user', editable: true }];
}

beforeEach(() => {
  resetSkillsIndexForTests();
  root = mkdtempSync(join(tmpdir(), 'skills-index-'));
});

afterEach(() => {
  resetSkillsIndexForTests();
  rmSync(root, { recursive: true, force: true });
});

describe('getSkillsIndex', () => {
  it('scans once and reuses the result while nothing on disk changed', () => {
    makeSkill('alpha');
    const scan = vi.fn(() => [{ name: 'alpha' }]);
    const readDir = (path: string) => readdirSync(path, { withFileTypes: true });

    expect(getSkillsIndex(roots(), readDir, scan)).toEqual([{ name: 'alpha' }]);
    expect(getSkillsIndex(roots(), readDir, scan)).toEqual([{ name: 'alpha' }]);
    expect(getSkillsIndex(roots(), readDir, scan)).toEqual([{ name: 'alpha' }]);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(skillsIndexStats().scans).toBe(1);
  });

  it('re-scans when a new skill directory appears', () => {
    makeSkill('alpha');
    const scan = vi.fn(() => readdirSync(root, { withFileTypes: true }).map((entry) => ({ name: entry.name })));
    const readDir = (path: string) => readdirSync(path, { withFileTypes: true });

    expect(getSkillsIndex(roots(), readDir, scan).map((skill) => skill.name)).toEqual(['alpha']);
    makeSkill('beta');
    expect(getSkillsIndex(roots(), readDir, scan).map((skill) => skill.name)).toEqual(['alpha', 'beta']);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('re-scans when a skill directory disappears or its SKILL.md changes size', () => {
    makeSkill('alpha');
    makeSkill('beta');
    const scan = vi.fn(() => [{ name: 'x' }]);
    const readDir = (path: string) => readdirSync(path, { withFileTypes: true });

    getSkillsIndex(roots(), readDir, scan);
    rmSync(join(root, 'beta'), { recursive: true, force: true });
    getSkillsIndex(roots(), readDir, scan);
    expect(scan).toHaveBeenCalledTimes(2);

    writeFileSync(join(root, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: much longer description than before\n---\n', 'utf-8');
    getSkillsIndex(roots(), readDir, scan);
    expect(scan).toHaveBeenCalledTimes(3);
  });

  it('encodes a missing root as invalid so its appearance busts the cache', () => {
    const missing = join(root, 'not-created-yet');
    const missingRoots: MindosSkillRoot[] = [{ path: missing, source: 'user', origin: 'mindos-user', editable: true }];
    const scan = vi.fn(() => [{ name: 'none' }]);
    const readDir = (path: string) => readdirSync(path, { withFileTypes: true });

    getSkillsIndex(missingRoots, readDir, scan);
    getSkillsIndex(missingRoots, readDir, scan);
    expect(scan).toHaveBeenCalledTimes(1);

    mkdirSync(missing, { recursive: true });
    getSkillsIndex(missingRoots, readDir, scan);
    expect(scan).toHaveBeenCalledTimes(2);
  });
});

describe('collectSkillInfos through the index', () => {
  it('applies the disabled set without re-scanning, so toggles take effect immediately', () => {
    makeSkill('alpha');
    makeSkill('beta');

    const first = collectSkillInfos(roots(), new Set());
    expect(first.map((skill) => [skill.name, skill.enabled])).toEqual([['alpha', true], ['beta', true]]);
    const scansAfterFirst = skillsIndexStats().scans;

    const second = collectSkillInfos(roots(), new Set(['alpha']));
    expect(second.map((skill) => [skill.name, skill.enabled])).toEqual([['alpha', false], ['beta', true]]);
    expect(skillsIndexStats().scans).toBe(scansAfterFirst);

    // The cached scan result itself is never mutated by the disabled overlay.
    const third = collectSkillInfos(roots(), new Set());
    expect(third.map((skill) => [skill.name, skill.enabled])).toEqual([['alpha', true], ['beta', true]]);
    expect(skillsIndexStats().scans).toBe(scansAfterFirst);
  });
});

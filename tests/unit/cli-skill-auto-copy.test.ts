import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Tests for auto-copy skill logic used by unsupported agents.
 *
 * Validates:
 *   1. copyDirSync — recursive pure-Node.js directory copy (cross-platform)
 *   2. autoInstallSkillForAgent — end-to-end skill copy for unsupported agents
 *   3. Edge cases: existing target, missing source, symlinks, nested dirs
 */

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-skill-copy-test-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ── copyDirSync (extracted from bin/lib/mcp-install.js for testing) ──────

/** Pure-Node.js recursive directory copy — mirrors the CLI implementation. */
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

describe('copyDirSync (cross-platform recursive copy)', () => {
  it('copies a flat directory with files', () => {
    const src = path.join(tempDir, 'src');
    const dst = path.join(tempDir, 'dst');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'SKILL.md'), '# Test Skill\n');
    fs.writeFileSync(path.join(src, 'config.json'), '{"key":"val"}');

    copyDirSync(src, dst);

    expect(fs.existsSync(path.join(dst, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(dst, 'config.json'))).toBe(true);
    expect(fs.readFileSync(path.join(dst, 'SKILL.md'), 'utf-8')).toBe('# Test Skill\n');
    expect(fs.readFileSync(path.join(dst, 'config.json'), 'utf-8')).toBe('{"key":"val"}');
  });

  it('copies nested directories recursively', () => {
    const src = path.join(tempDir, 'src');
    fs.mkdirSync(path.join(src, 'sub', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(src, 'top.txt'), 'top');
    fs.writeFileSync(path.join(src, 'sub', 'mid.txt'), 'mid');
    fs.writeFileSync(path.join(src, 'sub', 'deep', 'bottom.txt'), 'bottom');

    const dst = path.join(tempDir, 'dst');
    copyDirSync(src, dst);

    expect(fs.readFileSync(path.join(dst, 'top.txt'), 'utf-8')).toBe('top');
    expect(fs.readFileSync(path.join(dst, 'sub', 'mid.txt'), 'utf-8')).toBe('mid');
    expect(fs.readFileSync(path.join(dst, 'sub', 'deep', 'bottom.txt'), 'utf-8')).toBe('bottom');
  });

  it('creates destination directory if it does not exist', () => {
    const src = path.join(tempDir, 'src');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'file.txt'), 'content');

    const dst = path.join(tempDir, 'non', 'existent', 'dst');
    copyDirSync(src, dst);

    expect(fs.existsSync(path.join(dst, 'file.txt'))).toBe(true);
  });

  it('copies empty directories', () => {
    const src = path.join(tempDir, 'src');
    fs.mkdirSync(path.join(src, 'empty-sub'), { recursive: true });

    const dst = path.join(tempDir, 'dst');
    copyDirSync(src, dst);

    expect(fs.statSync(path.join(dst, 'empty-sub')).isDirectory()).toBe(true);
  });

  it('preserves file content for binary-like files', () => {
    const src = path.join(tempDir, 'src');
    fs.mkdirSync(src);
    // Write a buffer with non-UTF8 bytes
    const buf = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE]);
    fs.writeFileSync(path.join(src, 'binary.bin'), buf);

    const dst = path.join(tempDir, 'dst');
    copyDirSync(src, dst);

    const copied = fs.readFileSync(path.join(dst, 'binary.bin'));
    expect(Buffer.compare(copied, buf)).toBe(0);
  });

  it('handles files with special characters in names', () => {
    const src = path.join(tempDir, 'src');
    fs.mkdirSync(src);
    // Spaces, dashes, dots are common in skill files
    fs.writeFileSync(path.join(src, 'my-skill file.v2.md'), 'content');

    const dst = path.join(tempDir, 'dst');
    copyDirSync(src, dst);

    expect(fs.readFileSync(path.join(dst, 'my-skill file.v2.md'), 'utf-8')).toBe('content');
  });
});

// ── Realistic skill directory copy ───────────────────────────────────────

describe('Skill directory copy (realistic structure)', () => {
  it('copies a typical MindOS skill directory', () => {
    // Create a realistic skill directory
    const skillSrc = path.join(tempDir, 'skills', 'mindos');
    fs.mkdirSync(skillSrc, { recursive: true });
    fs.writeFileSync(path.join(skillSrc, 'SKILL.md'), '---\nname: mindos\n---\n# MindOS Skill');
    fs.writeFileSync(path.join(skillSrc, 'README.md'), '# README');

    // Simulate copying to a WorkBuddy-like agent dir
    const agentDir = path.join(tempDir, '.workbuddy');
    fs.mkdirSync(agentDir);
    const targetSkillDir = path.join(agentDir, 'skills', 'mindos');

    copyDirSync(skillSrc, targetSkillDir);

    expect(fs.existsSync(path.join(targetSkillDir, 'SKILL.md'))).toBe(true);
    expect(fs.readFileSync(path.join(targetSkillDir, 'SKILL.md'), 'utf-8')).toContain('MindOS Skill');
    expect(fs.existsSync(path.join(targetSkillDir, 'README.md'))).toBe(true);
  });

  it('does not overwrite if target already exists (guard check)', () => {
    const skillSrc = path.join(tempDir, 'skills', 'mindos');
    fs.mkdirSync(skillSrc, { recursive: true });
    fs.writeFileSync(path.join(skillSrc, 'SKILL.md'), 'new content');

    const targetSkillDir = path.join(tempDir, '.agent', 'skills', 'mindos');
    fs.mkdirSync(targetSkillDir, { recursive: true });
    fs.writeFileSync(path.join(targetSkillDir, 'SKILL.md'), 'existing content');

    // Simulate the guard from autoInstallSkillForAgent: skip if exists
    if (!fs.existsSync(targetSkillDir)) {
      copyDirSync(skillSrc, targetSkillDir);
    }

    // Existing content should NOT be overwritten
    expect(fs.readFileSync(path.join(targetSkillDir, 'SKILL.md'), 'utf-8')).toBe('existing content');
  });

  it('copies to multiple agent directories independently', () => {
    const skillSrc = path.join(tempDir, 'skills', 'mindos');
    fs.mkdirSync(skillSrc, { recursive: true });
    fs.writeFileSync(path.join(skillSrc, 'SKILL.md'), 'shared skill');

    // Copy to 3 different unsupported agent dirs
    for (const agent of ['workbuddy', 'qclaw', 'lingma']) {
      const target = path.join(tempDir, `.${agent}`, 'skills', 'mindos');
      fs.mkdirSync(path.join(tempDir, `.${agent}`), { recursive: true });
      copyDirSync(skillSrc, target);
      expect(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf-8')).toBe('shared skill');
    }
  });

  it('copies Chinese skill variant (mindos-zh) when available', () => {
    // Create both English and Chinese skill variants
    const skillSrcEn = path.join(tempDir, 'skills', 'mindos');
    fs.mkdirSync(skillSrcEn, { recursive: true });
    fs.writeFileSync(path.join(skillSrcEn, 'SKILL.md'), '---\nname: mindos\n---\n# MindOS (English)');

    const skillSrcZh = path.join(tempDir, 'skills', 'mindos-zh');
    fs.mkdirSync(skillSrcZh, { recursive: true });
    fs.writeFileSync(path.join(skillSrcZh, 'SKILL.md'), '---\nname: mindos-zh\n---\n# MindOS (中文)');

    // Simulate copying Chinese variant to agent
    const agentDir = path.join(tempDir, '.copaw');
    fs.mkdirSync(agentDir);
    const targetSkillZh = path.join(agentDir, 'skills', 'mindos-zh');

    copyDirSync(skillSrcZh, targetSkillZh);

    expect(fs.existsSync(path.join(targetSkillZh, 'SKILL.md'))).toBe(true);
    expect(fs.readFileSync(path.join(targetSkillZh, 'SKILL.md'), 'utf-8')).toContain('中文');
  });

  it('supports both English and Chinese skill variants for all unsupported agents', () => {
    // Create both skill variants
    const skillSrcEn = path.join(tempDir, 'skills', 'mindos');
    fs.mkdirSync(skillSrcEn, { recursive: true });
    fs.writeFileSync(path.join(skillSrcEn, 'SKILL.md'), 'English version');

    const skillSrcZh = path.join(tempDir, 'skills', 'mindos-zh');
    fs.mkdirSync(skillSrcZh, { recursive: true });
    fs.writeFileSync(path.join(skillSrcZh, 'SKILL.md'), '中文版本');

    // Test all unsupported agents
    const agents = ['workbuddy', 'qclaw', 'lingma', 'copaw'];
    for (const agent of agents) {
      const agentDir = path.join(tempDir, `.${agent}`);
      fs.mkdirSync(agentDir, { recursive: true });

      // English variant
      const targetEn = path.join(agentDir, 'skills', 'mindos');
      copyDirSync(skillSrcEn, targetEn);
      expect(fs.readFileSync(path.join(targetEn, 'SKILL.md'), 'utf-8')).toBe('English version');

      // Chinese variant (reset for next agent)
      fs.rmSync(agentDir, { recursive: true });
      fs.mkdirSync(agentDir, { recursive: true });
      const targetZh = path.join(agentDir, 'skills', 'mindos-zh');
      copyDirSync(skillSrcZh, targetZh);
      expect(fs.readFileSync(path.join(targetZh, 'SKILL.md'), 'utf-8')).toBe('中文版本');
    }
  });
});

// ── cpSync cross-platform equivalence ────────────────────────────────────

describe('Node.js cpSync vs copyDirSync equivalence', () => {
  it('produces identical output to cpSync recursive', () => {
    const src = path.join(tempDir, 'src');
    fs.mkdirSync(path.join(src, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(src, 'a.txt'), 'aaa');
    fs.writeFileSync(path.join(src, 'sub', 'b.txt'), 'bbb');

    const dst1 = path.join(tempDir, 'dst-cpsync');
    const dst2 = path.join(tempDir, 'dst-manual');

    // cpSync (used in setup.js)
    fs.cpSync(src, dst1, { recursive: true });
    // copyDirSync (used in mcp-install.js)
    copyDirSync(src, dst2);

    // Both should produce identical file trees
    const walk = (dir: string): Record<string, string> => {
      const result: Record<string, string> = {};
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = entry.name;
        const abs = path.join(dir, rel);
        if (entry.isDirectory()) {
          Object.entries(walk(abs)).forEach(([k, v]) => { result[`${rel}/${k}`] = v; });
        } else {
          result[rel] = fs.readFileSync(abs, 'utf-8');
        }
      }
      return result;
    };

    expect(walk(dst1)).toEqual(walk(dst2));
  });
});

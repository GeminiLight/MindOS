import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('mindos init-skills safe path handling', () => {
  it('does not create user preferences through a symlinked .mindos directory', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-init-skills-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-init-skills-outside-'));
    try {
      fs.symlinkSync(outside, path.join(root, '.mindos'), 'dir');
      const { initializeUserPreferences } = await import('../../packages/mindos/bin/commands/init-skills.js');

      const result = initializeUserPreferences({
        mindRoot: root,
        disabledSkills: [],
        templateRoot: path.join(path.resolve(__dirname, '..', '..'), 'templates', 'skill-rules'),
      });

      expect(result).toEqual({ status: 'unsafe-path' });
      expect(fs.existsSync(path.join(outside, 'user-preferences.md'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

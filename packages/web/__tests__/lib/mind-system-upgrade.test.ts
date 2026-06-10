import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { cleanupMindRoot, mkTempMindRoot } from '../core/helpers';
import { MIND_SYSTEM_CONFIG_RELATIVE_PATH, listMindSystemSlots } from '@/lib/mind-system';
import { ensureDefaultMindSystemUpgrade } from '@/lib/mind-system-upgrade';

const DEFAULT_DIRS = ['MIND_DAO', 'MIND_FA', 'MIND_SHU', 'MIND_QI'] as const;
const DEFAULT_ASSISTANT_PROMPTS = [
  '.mindos/assistants/inbox-organizer/prompt.md',
  '.mindos/assistants/daily-signal/prompt.md',
  '.mindos/assistants/decision-synthesizer/prompt.md',
  '.mindos/assistants/rule-keeper/prompt.md',
  '.mindos/assistants/boundary-reviewer/prompt.md',
  '.mindos/assistants/method-organizer/prompt.md',
  '.mindos/assistants/checklist-builder/prompt.md',
  '.mindos/assistants/tool-inventory/prompt.md',
  '.mindos/assistants/resource-auditor/prompt.md',
] as const;

describe('default mind-system upgrade', () => {
  it('creates default Mind System folders, scaffolds, and normalized config', () => {
    const mindRoot = mkTempMindRoot();
    try {
      const result = ensureDefaultMindSystemUpgrade(mindRoot);

      expect(result.state).toBe('ready');
      expect(result.createdPaths).toEqual([...DEFAULT_DIRS]);
      expect(result.skippedPaths).toEqual([]);
      for (const dir of DEFAULT_DIRS) {
        expect(fs.statSync(path.join(mindRoot, dir)).isDirectory()).toBe(true);
        expect(fs.existsSync(path.join(mindRoot, dir, 'README.md'))).toBe(true);
        expect(fs.existsSync(path.join(mindRoot, dir, 'INSTRUCTION.md'))).toBe(true);
        expect(fs.statSync(path.join(mindRoot, dir, 'Drafts')).isDirectory()).toBe(true);
      }
      for (const promptPath of DEFAULT_ASSISTANT_PROMPTS) {
        const prompt = fs.readFileSync(path.join(mindRoot, promptPath), 'utf-8');
        expect(prompt).toContain('assistantId:');
        expect(prompt).toContain('## Role');
      }

      const config = JSON.parse(fs.readFileSync(path.join(mindRoot, MIND_SYSTEM_CONFIG_RELATIVE_PATH), 'utf-8'));
      expect(config.enabled).toBe(true);
      expect(Object.keys(config.slots)).toEqual(['dao', 'fa', 'shu', 'qi']);
      expect(config.slots.dao).toMatchObject({ systemId: 'MIND_DAO', path: 'MIND_DAO', label: '道' });
      expect(listMindSystemSlots(mindRoot).map(slot => slot.key)).toEqual(['dao', 'fa', 'shu', 'qi']);
    } finally {
      cleanupMindRoot(mindRoot);
    }
  });

  it('is idempotent and does not overwrite existing scaffold files', () => {
    const mindRoot = mkTempMindRoot();
    try {
      fs.mkdirSync(path.join(mindRoot, 'MIND_DAO'), { recursive: true });
      fs.mkdirSync(path.join(mindRoot, 'MIND_DAO', 'Drafts'), { recursive: true });
      fs.writeFileSync(path.join(mindRoot, 'MIND_DAO', 'README.md'), '# Custom Dao\n', 'utf-8');
      fs.writeFileSync(path.join(mindRoot, 'MIND_DAO', 'INSTRUCTION.md'), '# Custom Agent Rules\n', 'utf-8');
      fs.writeFileSync(path.join(mindRoot, 'MIND_DAO', 'Drafts', 'custom.md'), '# Existing Draft\n', 'utf-8');
      fs.mkdirSync(path.join(mindRoot, '.mindos', 'assistants', 'daily-signal'), { recursive: true });
      fs.writeFileSync(
        path.join(mindRoot, '.mindos', 'assistants', 'daily-signal', 'prompt.md'),
        '# Custom Daily Signal Prompt\n',
        'utf-8',
      );
      fs.mkdirSync(path.join(mindRoot, '.mindos', 'assistants', 'inbox-organizer'), { recursive: true });
      fs.writeFileSync(
        path.join(mindRoot, '.mindos', 'assistants', 'inbox-organizer', 'prompt.md'),
        '# Custom Inbox Organizer Prompt\n',
        'utf-8',
      );

      ensureDefaultMindSystemUpgrade(mindRoot);
      const result = ensureDefaultMindSystemUpgrade(mindRoot);

      expect(result.state).toBe('ready');
      expect(result.createdPaths).toEqual([]);
      expect(result.existingPaths).toEqual([...DEFAULT_DIRS]);
      expect(fs.readFileSync(path.join(mindRoot, 'MIND_DAO', 'README.md'), 'utf-8')).toBe('# Custom Dao\n');
      expect(fs.readFileSync(path.join(mindRoot, 'MIND_DAO', 'INSTRUCTION.md'), 'utf-8')).toBe('# Custom Agent Rules\n');
      expect(fs.readFileSync(path.join(mindRoot, 'MIND_DAO', 'Drafts', 'custom.md'), 'utf-8')).toBe('# Existing Draft\n');
      expect(fs.readFileSync(path.join(mindRoot, '.mindos/assistants/daily-signal/prompt.md'), 'utf-8'))
        .toBe('# Custom Daily Signal Prompt\n');
      expect(fs.readFileSync(path.join(mindRoot, '.mindos/assistants/inbox-organizer/prompt.md'), 'utf-8'))
        .toBe('# Custom Inbox Organizer Prompt\n');
      expect(fs.readFileSync(path.join(mindRoot, '.mindos/assistants/decision-synthesizer/prompt.md'), 'utf-8'))
        .toContain('assistantId: decision-synthesizer');
    } finally {
      cleanupMindRoot(mindRoot);
    }
  });

  it('skips a slot when the target path exists as a file', () => {
    const mindRoot = mkTempMindRoot();
    try {
      fs.writeFileSync(path.join(mindRoot, 'MIND_DAO'), 'not a directory', 'utf-8');

      const result = ensureDefaultMindSystemUpgrade(mindRoot);

      expect(result.state).toBe('partial');
      expect(result.skippedPaths).toEqual([{ path: 'MIND_DAO', reason: 'file_conflict' }]);
      expect(result.createdPaths).toEqual(['MIND_FA', 'MIND_SHU', 'MIND_QI']);
      expect(listMindSystemSlots(mindRoot).map(slot => slot.key)).toEqual(['fa', 'shu', 'qi']);
      expect(fs.readFileSync(path.join(mindRoot, 'MIND_DAO'), 'utf-8')).toBe('not a directory');
      expect(fs.existsSync(path.join(mindRoot, '.mindos/assistants/inbox-organizer/prompt.md'))).toBe(true);
      expect(fs.existsSync(path.join(mindRoot, '.mindos/assistants/daily-signal/prompt.md'))).toBe(false);
      expect(fs.existsSync(path.join(mindRoot, '.mindos/assistants/decision-synthesizer/prompt.md'))).toBe(false);
      expect(fs.existsSync(path.join(mindRoot, '.mindos/assistants/rule-keeper/prompt.md'))).toBe(true);
    } finally {
      cleanupMindRoot(mindRoot);
    }
  });

  it('does not write assistant prompts through a symlinked assistant registry', () => {
    const mindRoot = mkTempMindRoot();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-assistant-registry-outside-'));
    try {
      fs.mkdirSync(path.join(mindRoot, '.mindos'), { recursive: true });
      fs.symlinkSync(outside, path.join(mindRoot, '.mindos', 'assistants'), 'dir');

      const result = ensureDefaultMindSystemUpgrade(mindRoot);

      expect(result.state).toBe('partial');
      expect(result.createdPaths).toEqual([...DEFAULT_DIRS]);
      expect(result.skippedPaths.map(item => item.path).sort()).toEqual([...DEFAULT_ASSISTANT_PROMPTS].sort());
      expect(result.skippedPaths.every(item => item.reason === 'unsafe_path')).toBe(true);
      expect(fs.existsSync(path.join(outside, 'inbox-organizer', 'prompt.md'))).toBe(false);
      expect(fs.existsSync(path.join(outside, 'daily-signal', 'prompt.md'))).toBe(false);
      expect(fs.existsSync(path.join(outside, 'resource-auditor', 'prompt.md'))).toBe(false);
    } finally {
      cleanupMindRoot(mindRoot);
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('does not scaffold a Mind System slot through a symlinked slot directory', () => {
    const mindRoot = mkTempMindRoot();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-slot-outside-'));
    try {
      fs.symlinkSync(outside, path.join(mindRoot, 'MIND_DAO'), 'dir');

      const result = ensureDefaultMindSystemUpgrade(mindRoot);

      expect(result.state).toBe('partial');
      expect(result.skippedPaths).toContainEqual({ path: 'MIND_DAO', reason: 'unsafe_path' });
      expect(result.createdPaths).toEqual(['MIND_FA', 'MIND_SHU', 'MIND_QI']);
      expect(fs.existsSync(path.join(outside, 'README.md'))).toBe(false);
      expect(fs.existsSync(path.join(outside, 'INSTRUCTION.md'))).toBe(false);
      expect(fs.existsSync(path.join(outside, 'Drafts'))).toBe(false);
      expect(fs.existsSync(path.join(mindRoot, '.mindos/assistants/inbox-organizer/prompt.md'))).toBe(true);
      expect(fs.existsSync(path.join(mindRoot, '.mindos/assistants/daily-signal/prompt.md'))).toBe(false);
      expect(fs.existsSync(path.join(mindRoot, '.mindos/assistants/decision-synthesizer/prompt.md'))).toBe(false);
    } finally {
      cleanupMindRoot(mindRoot);
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('does not create folders when the mind system is hidden', () => {
    const mindRoot = mkTempMindRoot();
    try {
      const configPath = path.join(mindRoot, MIND_SYSTEM_CONFIG_RELATIVE_PATH);
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({
        version: 1,
        enabled: false,
        slots: {},
      }, null, 2), 'utf-8');

      const result = ensureDefaultMindSystemUpgrade(mindRoot);

      expect(result).toEqual({
        state: 'hidden',
        createdPaths: [],
        existingPaths: [],
        skippedPaths: [],
      });
      for (const dir of DEFAULT_DIRS) {
        expect(fs.existsSync(path.join(mindRoot, dir))).toBe(false);
      }
      const inboxPrompt = path.join(mindRoot, '.mindos', 'assistants', 'inbox-organizer', 'prompt.md');
      expect(fs.existsSync(inboxPrompt)).toBe(true);
      expect(fs.readFileSync(inboxPrompt, 'utf-8')).toContain('assistantId: inbox-organizer');
      expect(listMindSystemSlots(mindRoot)).toEqual([]);
    } finally {
      cleanupMindRoot(mindRoot);
    }
  });

  it('does not recognize old experiment folders or user-created similar folders', () => {
    const mindRoot = mkTempMindRoot();
    try {
      for (const dir of ['01 道', '02 法', '03 术', '04 器', 'Dao', 'Fa', 'Shu', 'Qi', 'Principles', '方法论']) {
        fs.mkdirSync(path.join(mindRoot, dir), { recursive: true });
      }

      const result = ensureDefaultMindSystemUpgrade(mindRoot);

      expect(result.state).toBe('ready');
      expect(result.createdPaths).toEqual([...DEFAULT_DIRS]);
      for (const dir of ['01 道', '02 法', '03 术', '04 器', 'Dao', 'Fa', 'Shu', 'Qi', 'Principles', '方法论']) {
        expect(fs.statSync(path.join(mindRoot, dir)).isDirectory()).toBe(true);
      }
      expect(listMindSystemSlots(mindRoot).map(slot => slot.path)).toEqual([...DEFAULT_DIRS]);
    } finally {
      cleanupMindRoot(mindRoot);
    }
  });
});

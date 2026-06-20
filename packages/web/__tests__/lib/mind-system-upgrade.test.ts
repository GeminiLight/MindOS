import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { cleanupMindRoot, mkTempMindRoot } from '../core/helpers';
import { listMindSystemSlots } from '@/lib/mind-system';
import { ensureDefaultMindSystemUpgrade } from '@/lib/mind-system-upgrade';
import {
  getDefaultMindSystemScaffoldContent,
  getMindSystemScaffoldDescriptor,
  isDefaultMindSystemScaffoldFile,
} from '@/lib/mind-system-scaffold';

const DEFAULT_DIRS = ['MIND_DAO', 'MIND_FA', 'MIND_SHU', 'MIND_QI'] as const;
const DEFAULT_ASSISTANT_PROMPTS = [
  '.mindos/assistants/inbox-organizer.md',
  '.mindos/assistants/dreaming.md',
] as const;

describe('default mind-system upgrade', () => {
  it('creates default Mind System folders and unified Space front matter without writing a registry', () => {
    const mindRoot = mkTempMindRoot();
    try {
      const result = ensureDefaultMindSystemUpgrade(mindRoot);

      expect(result.state).toBe('ready');
      expect(result.createdPaths).toEqual([...DEFAULT_DIRS]);
      expect(result.updatedPaths).toEqual([]);
      expect(result.skippedPaths).toEqual([]);
      for (const dir of DEFAULT_DIRS) {
        expect(fs.statSync(path.join(mindRoot, dir)).isDirectory()).toBe(true);
        expect(fs.existsSync(path.join(mindRoot, dir, 'README.md'))).toBe(true);
        expect(fs.existsSync(path.join(mindRoot, dir, 'INSTRUCTION.md'))).toBe(true);
        expect(fs.statSync(path.join(mindRoot, dir, 'Drafts')).isDirectory()).toBe(true);
      }
      for (const promptPath of DEFAULT_ASSISTANT_PROMPTS) {
        const prompt = fs.readFileSync(path.join(mindRoot, promptPath), 'utf-8');
        expect(prompt).toContain('version: 1');
        expect(prompt).toContain('mode: subagent');
        expect(prompt).toContain('## Role');
        expect(prompt).not.toContain('assistantId:');
        expect(prompt).not.toContain('surface:');
      }
      expect(fs.existsSync(path.join(mindRoot, '.mindos/assistants/dreaming/profile.json'))).toBe(false);

      const daoInstruction = fs.readFileSync(path.join(mindRoot, 'MIND_DAO', 'INSTRUCTION.md'), 'utf-8');
      expect(daoInstruction).toContain('mindSpace:');
      expect(daoInstruction).toContain('id: dao');
      expect(daoInstruction).toContain('type: system');
      expect(daoInstruction).toContain('source: builtin');
      expect(daoInstruction).toContain('version: 2');
      expect(daoInstruction).toContain('locale: zh');
      expect(daoInstruction).toContain('order: 10');
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
      fs.mkdirSync(path.join(mindRoot, '.mindos', 'assistants', 'inbox-organizer'), { recursive: true });
      fs.writeFileSync(
        path.join(mindRoot, '.mindos', 'assistants', 'inbox-organizer', 'prompt.md'),
        '# Custom Inbox Organizer Prompt\n',
        'utf-8',
      );
      fs.mkdirSync(path.join(mindRoot, '.mindos', 'assistants', 'dreaming'), { recursive: true });
      fs.writeFileSync(
        path.join(mindRoot, '.mindos', 'assistants', 'dreaming', 'prompt.md'),
        '# Custom Dreaming Prompt\n',
        'utf-8',
      );
      fs.writeFileSync(
        path.join(mindRoot, '.mindos', 'assistants', 'dreaming', 'profile.json'),
        '{"name":"Custom Dreaming"}\n',
        'utf-8',
      );

      ensureDefaultMindSystemUpgrade(mindRoot);
      const result = ensureDefaultMindSystemUpgrade(mindRoot);

      expect(result.state).toBe('ready');
      expect(result.createdPaths).toEqual([]);
      expect(result.existingPaths).toEqual([...DEFAULT_DIRS]);
      expect(result.updatedPaths).toEqual([]);
      expect(fs.readFileSync(path.join(mindRoot, 'MIND_DAO', 'README.md'), 'utf-8')).toBe('# Custom Dao\n');
      expect(fs.readFileSync(path.join(mindRoot, 'MIND_DAO', 'INSTRUCTION.md'), 'utf-8')).toBe('# Custom Agent Rules\n');
      expect(fs.readFileSync(path.join(mindRoot, 'MIND_DAO', 'Drafts', 'custom.md'), 'utf-8')).toBe('# Existing Draft\n');
      expect(fs.readFileSync(path.join(mindRoot, '.mindos/assistants/inbox-organizer/prompt.md'), 'utf-8'))
        .toBe('# Custom Inbox Organizer Prompt\n');
      expect(fs.readFileSync(path.join(mindRoot, '.mindos/assistants/inbox-organizer.md'), 'utf-8'))
        .toContain('# Custom Inbox Organizer Prompt');
      expect(fs.readFileSync(path.join(mindRoot, '.mindos/assistants/inbox-organizer.md'), 'utf-8'))
        .toContain('version: 1');
      expect(fs.readFileSync(path.join(mindRoot, '.mindos/assistants/dreaming/prompt.md'), 'utf-8'))
        .toBe('# Custom Dreaming Prompt\n');
      expect(fs.readFileSync(path.join(mindRoot, '.mindos/assistants/dreaming.md'), 'utf-8'))
        .toContain('# Custom Dreaming Prompt');
      expect(fs.readFileSync(path.join(mindRoot, '.mindos/assistants/dreaming/profile.json'), 'utf-8'))
        .toBe('{"name":"Custom Dreaming"}\n');
      expect(fs.existsSync(path.join(mindRoot, '.mindos/assistants/decision-synthesizer/prompt.md'))).toBe(false);
    } finally {
      cleanupMindRoot(mindRoot);
    }
  });

  it('upgrades existing scaffold files when they still match a historical built-in default', () => {
    const mindRoot = mkTempMindRoot();
    try {
      fs.mkdirSync(path.join(mindRoot, 'MIND_DAO'), { recursive: true });
      const relativePath = 'MIND_DAO/INSTRUCTION.md';
      const descriptor = getMindSystemScaffoldDescriptor(relativePath);
      const historicalDefault = descriptor?.knownDefaultContents.find(content => content !== descriptor.currentContent);
      expect(historicalDefault).toBeTruthy();
      fs.writeFileSync(path.join(mindRoot, relativePath), historicalDefault!, 'utf-8');

      expect(isDefaultMindSystemScaffoldFile(mindRoot, relativePath)).toBe(true);

      const result = ensureDefaultMindSystemUpgrade(mindRoot);

      expect(result.state).toBe('ready');
      expect(result.createdPaths).toEqual(['MIND_FA', 'MIND_SHU', 'MIND_QI']);
      expect(result.existingPaths).toEqual(['MIND_DAO']);
      expect(result.updatedPaths).toEqual([relativePath]);
      expect(fs.readFileSync(path.join(mindRoot, relativePath), 'utf-8'))
        .toBe(getDefaultMindSystemScaffoldContent(relativePath));
    } finally {
      cleanupMindRoot(mindRoot);
    }
  });

  it('does not upgrade scaffold files after the user edits the historical default', () => {
    const mindRoot = mkTempMindRoot();
    try {
      fs.mkdirSync(path.join(mindRoot, 'MIND_DAO'), { recursive: true });
      const relativePath = 'MIND_DAO/INSTRUCTION.md';
      const descriptor = getMindSystemScaffoldDescriptor(relativePath);
      const historicalDefault = descriptor?.knownDefaultContents.find(content => content !== descriptor.currentContent);
      expect(historicalDefault).toBeTruthy();
      const userEditedContent = `${historicalDefault!}\n# User note\n`;
      fs.writeFileSync(path.join(mindRoot, relativePath), userEditedContent, 'utf-8');

      const result = ensureDefaultMindSystemUpgrade(mindRoot);

      expect(result.state).toBe('ready');
      expect(result.updatedPaths).toEqual([]);
      expect(fs.readFileSync(path.join(mindRoot, relativePath), 'utf-8')).toBe(userEditedContent);
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
      expect(fs.existsSync(path.join(mindRoot, '.mindos/assistants/inbox-organizer.md'))).toBe(true);
      expect(fs.existsSync(path.join(mindRoot, '.mindos/assistants/dreaming.md'))).toBe(true);
      expect(fs.existsSync(path.join(mindRoot, '.mindos/assistants/daily-signal/prompt.md'))).toBe(false);
      expect(fs.existsSync(path.join(mindRoot, '.mindos/assistants/decision-synthesizer/prompt.md'))).toBe(false);
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
      expect(result.skippedPaths.map(item => item.path).sort()).toEqual([
        ...DEFAULT_ASSISTANT_PROMPTS,
      ].sort());
      expect(result.skippedPaths.every(item => item.reason === 'unsafe_path')).toBe(true);
      expect(fs.existsSync(path.join(outside, 'inbox-organizer.md'))).toBe(false);
      expect(fs.existsSync(path.join(outside, 'dreaming.md'))).toBe(false);
      expect(fs.existsSync(path.join(outside, 'daily-signal', 'prompt.md'))).toBe(false);
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
      expect(fs.existsSync(path.join(mindRoot, '.mindos/assistants/inbox-organizer.md'))).toBe(true);
      expect(fs.existsSync(path.join(mindRoot, '.mindos/assistants/dreaming.md'))).toBe(true);
      expect(fs.existsSync(path.join(mindRoot, '.mindos/assistants/daily-signal/prompt.md'))).toBe(false);
    } finally {
      cleanupMindRoot(mindRoot);
      fs.rmSync(outside, { recursive: true, force: true });
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

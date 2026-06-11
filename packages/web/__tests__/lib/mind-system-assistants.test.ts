import fs from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { cleanupMindRoot, mkTempMindRoot, seedFile } from '../core/helpers';
import {
  getAssistantProfilePath,
  getAssistantPromptPath,
  getMindSystemAssistants,
  getMindSystemAssistantSummary,
  listMindSystemAssistantSummaries,
} from '@/lib/mind-system-assistants';
import type { MindSystemSlot } from '@/lib/mind-system';

const daoSlot: MindSystemSlot = {
  key: 'dao',
  systemId: 'MIND_DAO',
  label: '道',
  path: 'MIND_DAO',
  role: 'world-model',
  order: 10,
  enabled: true,
};

const faSlot: MindSystemSlot = {
  key: 'fa',
  systemId: 'MIND_FA',
  label: '法',
  path: 'MIND_FA',
  role: 'principles',
  order: 20,
  enabled: true,
};

describe('mind-system assistants', () => {
  it('lets each built-in Mind System space reference multiple assistants without primary flags', () => {
    const assistants = getMindSystemAssistants({ key: 'dao' });

    expect(assistants.map(assistant => assistant.id)).toEqual(['daily-signal', 'decision-synthesizer']);
    expect(assistants[0]).toMatchObject({ schedule: { mode: 'daily' } });
    expect(assistants[1]).toMatchObject({ schedule: { mode: 'manual' } });
    expect(assistants[0]?.promptPath).toBe('.mindos/assistants/daily-signal/prompt.md');
    expect(assistants[1]?.promptPath).toBe('.mindos/assistants/decision-synthesizer/prompt.md');
    expect(assistants[0]?.profilePath).toBe('.mindos/assistants/daily-signal/profile.json');
    expect(assistants).not.toContainEqual(expect.objectContaining({ primary: expect.anything() }));
  });

  it('uses a flat hidden assistant prompt registry and rejects unsafe assistant ids', () => {
    expect(getAssistantPromptPath('daily-signal')).toBe('.mindos/assistants/daily-signal/prompt.md');
    expect(getAssistantProfilePath('daily-signal')).toBe('.mindos/assistants/daily-signal/profile.json');
    expect(() => getAssistantPromptPath('../daily-signal')).toThrow(/Unsafe assistant id/);
    expect(() => getAssistantProfilePath('../daily-signal')).toThrow(/Unsafe assistant id/);
    expect(() => getAssistantPromptPath('Daily Signal')).toThrow(/Unsafe assistant id/);
  });

  it('applies local assistant profile overrides without changing the assistant id', () => {
    const mindRoot = mkTempMindRoot();
    try {
      seedFile(mindRoot, '.mindos/assistants/daily-signal/profile.json', JSON.stringify({
        name: 'Morning signal editor',
        description: 'Prepare a shorter morning brief.',
        schedule: { mode: 'weekly' },
      }));

      const summary = getMindSystemAssistantSummary(mindRoot, daoSlot);

      expect(summary.assistants[0]).toMatchObject({
        id: 'daily-signal',
        name: 'Morning signal editor',
        desc: 'Prepare a shorter morning brief.',
        schedule: { mode: 'daily' },
        profilePath: '.mindos/assistants/daily-signal/profile.json',
      });
      expect(summary.assistants[1]).toMatchObject({
        id: 'decision-synthesizer',
        schedule: { mode: 'manual' },
      });
    } finally {
      cleanupMindRoot(mindRoot);
    }
  });

  it('ignores malformed or invalid assistant profile fields', () => {
    const mindRoot = mkTempMindRoot();
    try {
      seedFile(mindRoot, '.mindos/assistants/daily-signal/profile.json', JSON.stringify({
        name: '   ',
        desc: 42,
        schedule: { mode: 'weekly' },
      }));
      seedFile(mindRoot, '.mindos/assistants/decision-synthesizer/profile.json', '{broken json');

      const summary = getMindSystemAssistantSummary(mindRoot, daoSlot);

      expect(summary.assistants[0]).toMatchObject({
        id: 'daily-signal',
        schedule: { mode: 'daily' },
        profilePath: '.mindos/assistants/daily-signal/profile.json',
      });
      expect(summary.assistants[0]?.name).toBeUndefined();
      expect(summary.assistants[0]?.desc).toBeUndefined();
      expect(summary.assistants[1]).toMatchObject({
        id: 'decision-synthesizer',
        schedule: { mode: 'manual' },
      });
    } finally {
      cleanupMindRoot(mindRoot);
    }
  });

  it('counts visible markdown drafts and reports instruction readiness', () => {
    const mindRoot = mkTempMindRoot();
    try {
      seedFile(mindRoot, 'MIND_DAO/INSTRUCTION.md', '# Rules\n');
      seedFile(mindRoot, 'MIND_DAO/Drafts/one.md', '# One\n');
      seedFile(mindRoot, 'MIND_DAO/Drafts/nested/two.md', '# Two\n');
      seedFile(mindRoot, 'MIND_DAO/Drafts/ignored.txt', 'not markdown\n');
      seedFile(mindRoot, 'MIND_DAO/Drafts/.hidden.md', '# Hidden\n');
      seedFile(mindRoot, '.mindos/assistants/daily-signal/prompt.md', '# Custom prompt\n');

      const summary = getMindSystemAssistantSummary(mindRoot, daoSlot);

      expect(summary.instructionReady).toBe(true);
      expect(summary.draftCount).toBe(2);
      expect(summary.assistants.map(assistant => assistant.id)).toEqual(['daily-signal', 'decision-synthesizer']);
      expect(summary.assistants[0]).toMatchObject({
        id: 'daily-signal',
        promptPath: '.mindos/assistants/daily-signal/prompt.md',
        promptReady: true,
      });
      expect(summary.assistants[1]).toMatchObject({
        id: 'decision-synthesizer',
        promptReady: false,
      });
    } finally {
      cleanupMindRoot(mindRoot);
    }
  });

  it('does not invent summaries for hidden or absent slots', () => {
    const mindRoot = mkTempMindRoot();
    try {
      fs.mkdirSync(path.join(mindRoot, 'MIND_DAO'), { recursive: true });

      const summaries = listMindSystemAssistantSummaries(mindRoot, [daoSlot]);

      expect(Object.keys(summaries)).toEqual(['dao']);
      expect(summaries.dao?.instructionReady).toBe(false);
      expect(summaries.dao?.draftCount).toBe(0);
      expect(summaries.fa).toBeUndefined();
    } finally {
      cleanupMindRoot(mindRoot);
    }
  });

  it('treats a Drafts file conflict as zero drafts without throwing', () => {
    const mindRoot = mkTempMindRoot();
    try {
      seedFile(mindRoot, 'MIND_FA/INSTRUCTION.md', '# Rules\n');
      seedFile(mindRoot, 'MIND_FA/Drafts', 'file conflict\n');

      const summary = getMindSystemAssistantSummary(mindRoot, faSlot);

      expect(summary.instructionReady).toBe(true);
      expect(summary.draftCount).toBe(0);
    } finally {
      cleanupMindRoot(mindRoot);
    }
  });

  it('treats an unreadable Drafts directory as zero drafts without throwing', () => {
    const mindRoot = mkTempMindRoot();
    const originalReaddirSync = fs.readdirSync;
    const readdirSpy = vi.spyOn(fs, 'readdirSync').mockImplementation((target, options) => {
      if (String(target).endsWith(`${path.sep}Drafts`)) {
        throw new Error('permission denied');
      }
      return originalReaddirSync(target, options as never) as never;
    });

    try {
      seedFile(mindRoot, 'MIND_FA/INSTRUCTION.md', '# Rules\n');
      seedFile(mindRoot, 'MIND_FA/Drafts/one.md', '# One\n');

      const summary = getMindSystemAssistantSummary(mindRoot, faSlot);

      expect(summary.instructionReady).toBe(true);
      expect(summary.draftCount).toBe(0);
    } finally {
      readdirSpy.mockRestore();
      cleanupMindRoot(mindRoot);
    }
  });
});

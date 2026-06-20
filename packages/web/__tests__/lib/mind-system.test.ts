import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { cleanupMindRoot, mkTempMindRoot } from '../core/helpers';
import {
  defaultMindSystemSlots,
  listMindSystemSlots,
  mindSystemPathExists,
} from '@/lib/mind-system';
import { applyInitialSpaces, applyTemplate } from '@/lib/template';

describe('mind-system metadata', () => {
  it('exposes default Mind System metadata without creating visible folders', () => {
    const mindRoot = mkTempMindRoot();
    try {
      const slots = defaultMindSystemSlots();

      expect(slots.map(slot => slot.key)).toEqual(['dao', 'fa', 'shu', 'qi']);
      expect(slots[0]).toMatchObject({ key: 'dao', path: 'MIND_DAO' });
      expect(fs.existsSync(path.join(mindRoot, 'MIND_DAO'))).toBe(false);
      expect(fs.existsSync(path.join(mindRoot, '99 验'))).toBe(false);
      expect(listMindSystemSlots(mindRoot)).toEqual([]);
    } finally {
      cleanupMindRoot(mindRoot);
    }
  });

  it('recognizes Mind System spaces by unified mindSpace id front matter', () => {
    const mindRoot = mkTempMindRoot();
    try {
      fs.mkdirSync(path.join(mindRoot, 'CustomDao'), { recursive: true });
      fs.writeFileSync(path.join(mindRoot, 'CustomDao', 'INSTRUCTION.md'), `---
mindSpace:
  id: dao
  type: system
  source: builtin
  version: 1
  locale: zh
  order: 7
---

# Custom Dao
`, 'utf-8');

      const slots = listMindSystemSlots(mindRoot);

      expect(slots).toHaveLength(1);
      expect(slots[0]).toMatchObject({
        key: 'dao',
        label: '道',
        path: 'CustomDao',
        order: 7,
      });
    } finally {
      cleanupMindRoot(mindRoot);
    }
  });

  it('lists Dao, Fa, Shu, and Qi as special UI slots while leaving Shi and Yan as normal folders', () => {
    const mindRoot = mkTempMindRoot();
    try {
      for (const dir of ['MIND_DAO', 'MIND_FA', 'MIND_SHU', 'MIND_QI', '05 势', '99 验']) {
        fs.mkdirSync(path.join(mindRoot, dir), { recursive: true });
      }
      for (const dir of ['MIND_DAO', 'MIND_FA', 'MIND_SHU', 'MIND_QI']) {
        fs.writeFileSync(path.join(mindRoot, dir, 'INSTRUCTION.md'), `# ${dir} instructions\n`, 'utf-8');
      }
      const slots = listMindSystemSlots(mindRoot);

      expect(slots.map(slot => slot.key)).toEqual(['dao', 'fa', 'shu', 'qi']);
      expect(mindSystemPathExists(mindRoot, slots[0])).toBe(true);
      expect(mindSystemPathExists(mindRoot, slots[1])).toBe(true);
    } finally {
      cleanupMindRoot(mindRoot);
    }
  });

  it('does not expose configured system slots when their visible folders are missing', () => {
    const mindRoot = mkTempMindRoot();
    try {
      fs.mkdirSync(path.join(mindRoot, 'MIND_DAO'), { recursive: true });
      fs.writeFileSync(path.join(mindRoot, 'MIND_DAO', 'INSTRUCTION.md'), '# Dao instructions\n', 'utf-8');
      fs.writeFileSync(path.join(mindRoot, 'MIND_FA'), '# Not a folder', 'utf-8');
      const slots = listMindSystemSlots(mindRoot);

      expect(slots.map(slot => slot.key)).toEqual(['dao']);
      expect(slots.some(slot => slot.key === 'fa')).toBe(false);
    } finally {
      cleanupMindRoot(mindRoot);
    }
  });

  it('is upgraded when setup applies any built-in template', () => {
    const mindRoot = mkTempMindRoot();
    try {
      applyTemplate('empty', mindRoot);

      expect(fs.existsSync(path.join(mindRoot, 'README.md'))).toBe(true);
      expect(fs.existsSync(path.join(mindRoot, 'MIND_DAO', 'README.md'))).toBe(true);
      expect(fs.existsSync(path.join(mindRoot, 'MIND_DAO', 'INSTRUCTION.md'))).toBe(true);
      const daoInstruction = fs.readFileSync(path.join(mindRoot, 'MIND_DAO', 'INSTRUCTION.md'), 'utf-8');
      expect(daoInstruction).toContain('mindSpace:');
      expect(daoInstruction).toContain('id: dao');
      expect(daoInstruction).toContain('type: system');
      expect(daoInstruction).toContain('source: builtin');
      expect(daoInstruction).toContain('version: 2');
      expect(daoInstruction).toContain('locale: zh');
      expect(daoInstruction).toContain('order: 10');
    } finally {
      cleanupMindRoot(mindRoot);
    }
  });

  it('applies initial Mind Spaces with skip-existing and provenance front matter', () => {
    const mindRoot = mkTempMindRoot();
    try {
      const existingReadme = path.join(mindRoot, '产品', 'README.md');
      fs.mkdirSync(path.dirname(existingReadme), { recursive: true });
      fs.writeFileSync(existingReadme, '# Custom product space', 'utf-8');

      const result = applyInitialSpaces(['product', 'social'], mindRoot, 'zh');

      expect(result.installed[0]).toMatchObject({ id: 'product', locale: 'zh', skipped: ['产品/README.md'] });
      expect(result.installed[0]?.copied).toEqual(expect.arrayContaining(['产品/INSTRUCTION.md']));
      expect(result.installed[1]).toMatchObject({ id: 'social', locale: 'zh', skipped: [] });
      expect(result.installed[1]?.copied).toEqual(expect.arrayContaining(['社交/README.md', '社交/INSTRUCTION.md']));
      expect(fs.readFileSync(existingReadme, 'utf-8')).toBe('# Custom product space');
      expect(fs.existsSync(path.join(mindRoot, '社交', 'README.md'))).toBe(true);

      const productInstruction = fs.readFileSync(path.join(mindRoot, '产品', 'INSTRUCTION.md'), 'utf-8');
      expect(productInstruction).toContain('mindSpace:');
      expect(productInstruction).toContain('id: product');
      expect(productInstruction).toContain('type: space');
      expect(productInstruction).toContain('source: builtin');
      expect(productInstruction).toContain('version: 1');
      expect(productInstruction).toContain('locale: zh');
      expect(productInstruction).toContain('order: 140');
      expect(fs.existsSync(path.join(mindRoot, 'MIND_DAO', 'INSTRUCTION.md'))).toBe(true);
      expect(fs.existsSync(path.join(mindRoot, '.mindos', 'assistants', 'inbox-organizer.md'))).toBe(true);
      expect(fs.existsSync(path.join(mindRoot, '.mindos', 'assistants', 'dreaming.md'))).toBe(true);
      const receiptPath = path.join(mindRoot, '.mindos', 'setup', 'space-kits.json');
      expect(fs.existsSync(receiptPath)).toBe(false);
    } finally {
      cleanupMindRoot(mindRoot);
    }
  });

  it('reinstalling initial Mind Spaces only skips existing files and writes no receipt', () => {
    const mindRoot = mkTempMindRoot();
    try {
      applyInitialSpaces(['product'], mindRoot, 'en');
      const second = applyInitialSpaces(['product'], mindRoot, 'en');

      const receiptPath = path.join(mindRoot, '.mindos', 'setup', 'space-kits.json');
      expect(fs.existsSync(receiptPath)).toBe(false);
      expect(second.installed).toEqual([
        {
          id: 'product',
          locale: 'en',
          copied: [],
          skipped: expect.arrayContaining(['Product/INSTRUCTION.md', 'Product/README.md']),
        },
      ]);
    } finally {
      cleanupMindRoot(mindRoot);
    }
  });

  it('rejects invalid initial Mind Space ids before copying any selected space', () => {
    const mindRoot = mkTempMindRoot();
    try {
      expect(() => applyInitialSpaces(['product', '../bad' as never], mindRoot, 'en')).toThrow('Invalid initial space: ../bad');
      expect(fs.existsSync(path.join(mindRoot, 'Product'))).toBe(false);
    } finally {
      cleanupMindRoot(mindRoot);
    }
  });
});

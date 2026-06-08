import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { cleanupMindRoot, mkTempMindRoot } from '../core/helpers';
import {
  MIND_SYSTEM_CONFIG_RELATIVE_PATH,
  ensureMindSystemConfig,
  getMindSystemConfigPath,
  listMindSystemSlots,
  mindSystemPathExists,
} from '@/lib/mind-system';
import { applyTemplate } from '@/lib/template';

describe('mind-system registry', () => {
  it('creates the hidden mind-system registry without creating visible content folders', () => {
    const mindRoot = mkTempMindRoot();
    try {
      const config = ensureMindSystemConfig(mindRoot);
      const configPath = getMindSystemConfigPath(mindRoot);

      expect(fs.existsSync(configPath)).toBe(true);
      expect(Object.keys(config.slots)).toEqual(['dao', 'fa', 'shu', 'qi']);
      expect(config.slots.dao.path).toBe('01 道');
      expect(fs.existsSync(path.join(mindRoot, '01 道'))).toBe(false);
      expect(fs.existsSync(path.join(mindRoot, '99 验'))).toBe(false);
      expect(listMindSystemSlots(mindRoot)).toEqual([]);
    } finally {
      cleanupMindRoot(mindRoot);
    }
  });

  it('preserves user labels and bound paths while adding new default slots', () => {
    const mindRoot = mkTempMindRoot();
    try {
      const configPath = path.join(mindRoot, MIND_SYSTEM_CONFIG_RELATIVE_PATH);
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({
        version: 1,
        slots: {
          dao: {
            label: '方向',
            path: '世界模型',
            role: 'custom-world-model',
            order: 1,
            primary: true,
            enabled: true,
          },
          shi: {
            label: '势',
            path: '05 势',
            role: 'current-context',
            order: 50,
            primary: false,
            enabled: true,
          },
          yan: {
            label: '验',
            path: '99 验',
            role: 'review-loop',
            order: 990,
            primary: false,
            enabled: true,
          },
        },
      }, null, 2), 'utf-8');

      const config = ensureMindSystemConfig(mindRoot);
      expect(config.slots.dao.label).toBe('方向');
      expect(config.slots.dao.path).toBe('世界模型');
      expect(config.slots.dao.role).toBe('custom-world-model');
      expect(config.slots.fa.path).toBe('02 法');
      expect('shi' in config.slots).toBe(false);
      expect('yan' in config.slots).toBe(false);

      const persisted = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as typeof config;
      expect(Object.keys(persisted.slots)).toEqual(['dao', 'fa', 'shu', 'qi']);
      expect(persisted.slots.dao.label).toBe('方向');
      expect('shi' in persisted.slots).toBe(false);
      expect('yan' in persisted.slots).toBe(false);
    } finally {
      cleanupMindRoot(mindRoot);
    }
  });

  it('lists Dao, Fa, Shu, and Qi as special UI slots while leaving Shi and Yan as normal folders', () => {
    const mindRoot = mkTempMindRoot();
    try {
      for (const dir of ['01 道', '02 法', '03 术', '04 器', '05 势', '99 验']) {
        fs.mkdirSync(path.join(mindRoot, dir), { recursive: true });
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
      fs.mkdirSync(path.join(mindRoot, '01 道'), { recursive: true });
      fs.writeFileSync(path.join(mindRoot, '02 法'), '# Not a folder', 'utf-8');
      const slots = listMindSystemSlots(mindRoot);

      expect(slots.map(slot => slot.key)).toEqual(['dao']);
      expect(slots.some(slot => slot.key === 'fa')).toBe(false);
    } finally {
      cleanupMindRoot(mindRoot);
    }
  });

  it('is created when setup applies any built-in template', () => {
    const mindRoot = mkTempMindRoot();
    try {
      applyTemplate('empty', mindRoot);

      expect(fs.existsSync(path.join(mindRoot, MIND_SYSTEM_CONFIG_RELATIVE_PATH))).toBe(true);
      expect(fs.existsSync(path.join(mindRoot, 'README.md'))).toBe(true);
      expect(fs.existsSync(path.join(mindRoot, '01 道'))).toBe(false);
    } finally {
      cleanupMindRoot(mindRoot);
    }
  });
});

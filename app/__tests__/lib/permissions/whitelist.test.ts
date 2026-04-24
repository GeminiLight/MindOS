/**
 * Tests for WhitelistManager
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WhitelistManager } from '@/lib/permissions/whitelist';

describe('WhitelistManager', () => {
  let manager: WhitelistManager;

  beforeEach(() => {
    manager = new WhitelistManager();
  });

  describe('add', () => {
    it('adds a pattern to the whitelist', () => {
      manager.add('npm install', 'command');

      const entries = manager.getAll();
      expect(entries).toHaveLength(1);
      expect(entries[0].pattern).toBe('npm install');
      expect(entries[0].type).toBe('command');
      expect(entries[0].addedAt).toBeInstanceOf(Date);
    });

    it('does not add duplicate patterns', () => {
      manager.add('npm install', 'command');
      manager.add('npm install', 'command');

      const entries = manager.getAll();
      expect(entries).toHaveLength(1);
    });

    it('allows same pattern for different types', () => {
      manager.add('test', 'command');
      manager.add('test', 'file');

      const entries = manager.getAll();
      expect(entries).toHaveLength(2);
    });

    it('adds expiry time if provided', () => {
      const expiresAt = new Date(Date.now() + 3600000);
      manager.add('test', 'command', expiresAt);

      const entries = manager.getAll();
      expect(entries[0].expiresAt).toEqual(expiresAt);
    });

    it('updates expiry time for existing pattern', () => {
      const firstExpiry = new Date(Date.now() + 1800000);
      const secondExpiry = new Date(Date.now() + 3600000);

      manager.add('test', 'command', firstExpiry);
      manager.add('test', 'command', secondExpiry);

      const entries = manager.getAll();
      expect(entries).toHaveLength(1);
      expect(entries[0].expiresAt).toEqual(secondExpiry);
    });
  });

  describe('isWhitelisted', () => {
    it('returns true for exact match', () => {
      manager.add('npm install', 'command');

      expect(manager.isWhitelisted('npm install', 'command')).toBe(true);
    });

    it('returns true for regex pattern match', () => {
      manager.add('npm install.*', 'command');

      expect(manager.isWhitelisted('npm install lodash', 'command')).toBe(true);
      expect(manager.isWhitelisted('npm install --save-dev vitest', 'command')).toBe(true);
    });

    it('returns false for non-matching pattern', () => {
      manager.add('npm install', 'command');

      expect(manager.isWhitelisted('npm uninstall', 'command')).toBe(false);
    });

    it('returns false for wrong type', () => {
      manager.add('test', 'command');

      expect(manager.isWhitelisted('test', 'file')).toBe(false);
    });

    it('returns false for expired entries', () => {
      const pastDate = new Date(Date.now() - 1000);
      manager.add('test', 'command', pastDate);

      expect(manager.isWhitelisted('test', 'command')).toBe(false);
    });

    it('returns true for non-expired entries', () => {
      const futureDate = new Date(Date.now() + 3600000);
      manager.add('test', 'command', futureDate);

      expect(manager.isWhitelisted('test', 'command')).toBe(true);
    });

    it('handles invalid regex gracefully', () => {
      manager.add('[invalid(regex', 'command');

      expect(manager.isWhitelisted('test', 'command')).toBe(false);
    });
  });

  describe('remove', () => {
    it('removes a pattern from the whitelist', () => {
      manager.add('test', 'command');
      expect(manager.getAll()).toHaveLength(1);

      const removed = manager.remove('test', 'command');
      expect(removed).toBe(true);
      expect(manager.getAll()).toHaveLength(0);
    });

    it('returns false if pattern not found', () => {
      const removed = manager.remove('nonexistent', 'command');
      expect(removed).toBe(false);
    });

    it('only removes matching type', () => {
      manager.add('test', 'command');
      manager.add('test', 'file');

      manager.remove('test', 'command');

      const entries = manager.getAll();
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe('file');
    });
  });

  describe('getAll', () => {
    it('returns all entries', () => {
      manager.add('pattern1', 'command');
      manager.add('pattern2', 'file');
      manager.add('pattern3', 'path');

      const entries = manager.getAll();
      expect(entries).toHaveLength(3);
    });

    it('returns a copy of entries', () => {
      manager.add('test', 'command');

      const entries1 = manager.getAll();
      const entries2 = manager.getAll();

      expect(entries1).not.toBe(entries2);
      expect(entries1).toEqual(entries2);
    });
  });

  describe('getByType', () => {
    beforeEach(() => {
      manager.add('cmd1', 'command');
      manager.add('cmd2', 'command');
      manager.add('file1', 'file');
      manager.add('path1', 'path');
    });

    it('returns only command entries', () => {
      const entries = manager.getByType('command');
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.type === 'command')).toBe(true);
    });

    it('returns only file entries', () => {
      const entries = manager.getByType('file');
      expect(entries).toHaveLength(1);
      expect(entries[0].pattern).toBe('file1');
    });

    it('returns only path entries', () => {
      const entries = manager.getByType('path');
      expect(entries).toHaveLength(1);
      expect(entries[0].pattern).toBe('path1');
    });
  });

  describe('clear', () => {
    it('clears all entries', () => {
      manager.add('pattern1', 'command');
      manager.add('pattern2', 'file');

      expect(manager.getAll()).toHaveLength(2);

      manager.clear();

      expect(manager.getAll()).toHaveLength(0);
    });
  });

  describe('clearExpired', () => {
    it('removes expired entries', () => {
      const pastDate = new Date(Date.now() - 1000);
      const futureDate = new Date(Date.now() + 3600000);

      manager.add('expired', 'command', pastDate);
      manager.add('active', 'command', futureDate);
      manager.add('no-expiry', 'command');

      expect(manager.getAll()).toHaveLength(3);

      manager.clearExpired();

      const entries = manager.getAll();
      expect(entries).toHaveLength(2);
      expect(entries.find((e) => e.pattern === 'expired')).toBeUndefined();
      expect(entries.find((e) => e.pattern === 'active')).toBeDefined();
      expect(entries.find((e) => e.pattern === 'no-expiry')).toBeDefined();
    });
  });

  describe('getStats', () => {
    it('returns correct statistics', () => {
      const pastDate = new Date(Date.now() - 1000);
      const futureDate = new Date(Date.now() + 3600000);

      manager.add('cmd1', 'command');
      manager.add('cmd2', 'command', futureDate);
      manager.add('file1', 'file', pastDate);
      manager.add('path1', 'path');

      const stats = manager.getStats();

      expect(stats.total).toBe(4);
      expect(stats.active).toBe(3); // cmd1, cmd2, path1 (file1 is expired)
      expect(stats.expired).toBe(1); // file1
      expect(stats.byType.command).toBe(2);
      expect(stats.byType.file).toBe(1);
      expect(stats.byType.path).toBe(1);
    });
  });
});

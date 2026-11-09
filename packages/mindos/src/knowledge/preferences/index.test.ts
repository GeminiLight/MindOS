import fs, { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileMutationLockPath, withFileMutation } from '../views/file-lock.js';
import {
  USER_PREFERENCES_PATH,
  appendUserPreference,
  insertPreferenceBullet,
  readUserPreferences,
  withUserPreferencesLock,
  writeUserPreferences,
} from './index.js';

describe('user preferences are written through one coordinated path', () => {
  let mindRoot: string;
  const now = new Date('2026-11-09T08:00:00.000Z');
  const read = () => readFileSync(join(mindRoot, USER_PREFERENCES_PATH), 'utf-8');

  beforeEach(() => {
    mindRoot = mkdtempSync(join(tmpdir(), 'mindos-preferences-'));
  });

  afterEach(() => rmSync(mindRoot, { recursive: true, force: true }));

  describe('appending a rule', () => {
    it('creates the file from the template on first write', () => {
      appendUserPreference(mindRoot, { rule: '写 TypeScript 时不要使用 any 类型。', marker: 'echo-card:a1' }, now);

      const content = read();
      expect(content).toContain('# User Skill Rules');
      expect(content).toContain('## Preferences');
      expect(content).toContain('写 TypeScript 时不要使用 any 类型。');
      expect(content).toContain('<!-- echo-card:a1 -->');
      expect(content).toContain('2026-11-09');
    });

    it('is idempotent for the same marker', () => {
      appendUserPreference(mindRoot, { rule: 'rule one', marker: 'echo-card:a1' }, now);
      const before = read();

      const second = appendUserPreference(mindRoot, { rule: 'rule one', marker: 'echo-card:a1' }, now);

      expect(second.appended).toBe(false);
      expect(read()).toBe(before);
    });

    it('keeps earlier rules and hand-written categories intact', () => {
      mkdirSync(join(mindRoot, '.mindos'), { recursive: true });
      writeFileSync(join(mindRoot, USER_PREFERENCES_PATH), [
        '# User Skill Rules',
        '<!-- auto-confirm-all: false -->',
        '',
        '## Preferences',
        '',
        '### Writing',
        '- Keep commit messages in English — _2026-10-01_',
        '',
        '## Suppressed Hooks',
        '',
      ].join('\n'), 'utf-8');

      appendUserPreference(mindRoot, { rule: 'rule one', marker: 'echo-card:a1' }, now);
      const content = read();

      expect(content).toContain('- Keep commit messages in English — _2026-10-01_');
      expect(content).toContain('### Writing');
      expect(content).toContain('## Suppressed Hooks');
      expect(content).toContain('rule one');
    });

    it('flattens a multi-line rule into one bullet', () => {
      appendUserPreference(mindRoot, { rule: 'line one\nline two\n\nline three', marker: 'echo-card:a1' }, now);

      const bullet = read().split('\n').find((line) => line.includes('echo-card:a1'));
      expect(bullet).toContain('line one line two line three');
    });

    it('rejects an empty rule rather than writing a blank bullet', () => {
      expect(() => appendUserPreference(mindRoot, { rule: '   ', marker: 'echo-card:a1' }, now)).toThrow(/rule/i);
    });

    it('rejects a marker that would break the HTML comment it lives in', () => {
      expect(() => appendUserPreference(mindRoot, { rule: 'r', marker: 'bad-->marker' }, now)).toThrow(/marker/i);
    });
  });

  describe('coordination between different writers', () => {
    it('serializes an agent-style whole-file write against a promotion append', () => {
      appendUserPreference(mindRoot, { rule: 'from promotion', marker: 'echo-card:a1' }, now);

      // An agent captured a preference in conversation: read, modify, write back.
      // Taking the same lock is what stops it from clobbering the append below.
      withUserPreferencesLock(mindRoot, () => {
        const current = readUserPreferences(mindRoot) ?? '';
        writeUserPreferences(mindRoot, `${current.trimEnd()}\n- typed by the agent — _2026-11-09_\n`);
      });

      appendUserPreference(mindRoot, { rule: 'from a later promotion', marker: 'echo-card:a2' }, now);
      const content = read();

      expect(content).toContain('from promotion');
      expect(content).toContain('typed by the agent');
      expect(content).toContain('from a later promotion');
    });

    it('lets a nested take of the same lock proceed instead of deadlocking', () => {
      // A writer that already holds the lock may call a helper that also wants
      // it. Blocking there would hang the whole request, not just lose a write.
      const content = withUserPreferencesLock(mindRoot, () => {
        appendUserPreference(mindRoot, { rule: 'nested write', marker: 'echo-card:a1' }, now);
        return readUserPreferences(mindRoot);
      });

      expect(content).toContain('nested write');
    });

    it('contends on the same lock file the agent write path uses', () => {
      // The bug this fixes was two *correct* locks on different paths, which
      // serialize nothing. Identity is the fix, so it is what gets asserted.
      let observed = '';
      withUserPreferencesLock(mindRoot, () => {
        observed = fs.readdirSync(join(mindRoot, '.mindos/views/locks')).join(',');
      });

      const expected = fileMutationLockPath(mindRoot, USER_PREFERENCES_PATH).split('/').pop();
      expect(observed).toBe(expected);
    });

    it('blocks an agent-style async write while a promotion append holds the lock', async () => {
      const order: string[] = [];
      let releaseAppend = () => {};
      const appendHeld = new Promise<void>((resolve) => { releaseAppend = resolve; });

      // Hold the lock synchronously, then let the async writer try to take it.
      const agentWrite = (async () => {
        await appendHeld;
        await withFileMutation(mindRoot, USER_PREFERENCES_PATH, async () => {
          order.push('agent');
        });
      })();

      withUserPreferencesLock(mindRoot, () => {
        releaseAppend();
        order.push('promotion');
      });
      await agentWrite;

      expect(order).toEqual(['promotion', 'agent']);
    });

    it('releases the lock when the operation throws', () => {
      expect(() => withUserPreferencesLock(mindRoot, () => { throw new Error('boom'); })).toThrow('boom');

      // Still writable: a leaked lock would make this throw "busy" instead.
      expect(appendUserPreference(mindRoot, { rule: 'after failure', marker: 'echo-card:a1' }, now).appended).toBe(true);
    });
  });

  describe('reading', () => {
    it('returns null when the file does not exist yet', () => {
      expect(readUserPreferences(mindRoot)).toBeNull();
    });

    it('returns the file as written', () => {
      appendUserPreference(mindRoot, { rule: 'rule one', marker: 'echo-card:a1' }, now);
      expect(readUserPreferences(mindRoot)).toBe(read());
    });
  });

  describe('insertPreferenceBullet is pure and keeps the file usable', () => {
    it('builds the template when there is nothing to extend', () => {
      const result = insertPreferenceBullet(null, '- rule', 'Echo agreements');
      expect(result).toContain('## Preferences');
      expect(result).toContain('### Echo agreements');
      expect(result.endsWith('\n')).toBe(true);
    });

    it('adds the category once across repeated inserts', () => {
      const first = insertPreferenceBullet(null, '- one', 'Echo agreements');
      const second = insertPreferenceBullet(first, '- two', 'Echo agreements');

      expect(second.match(/^### Echo agreements$/gm)).toHaveLength(1);
      expect(second).toContain('- one');
      expect(second).toContain('- two');
    });

    it('appends structure rather than rewriting an unexpected file shape', () => {
      const result = insertPreferenceBullet('just notes the user typed\n', '- rule', 'Echo agreements');

      expect(result).toContain('just notes the user typed');
      expect(result).toContain('## Preferences');
      expect(result).toContain('- rule');
    });

    it('keeps an empty file usable', () => {
      expect(insertPreferenceBullet('', '- rule', 'Echo agreements')).toContain('- rule');
    });
  });
});

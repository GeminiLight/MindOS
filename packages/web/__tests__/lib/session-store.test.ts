import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { deleteSessionDir, getSessionDir, sessionDirExists } from '@/lib/pi-integration/session-store';

let tempRoot: string;
let originalHome: string | undefined;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-session-store-'));
  originalHome = process.env.HOME;
  process.env.HOME = tempRoot;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('session-store', () => {
  it('getSessionDir returns sanitized path under ~/.mindos/sessions/', () => {
    const dir = getSessionDir('abc-123');
    expect(dir).toBe(path.join(tempRoot, '.mindos', 'sessions', 'abc-123'));
  });

  it('sanitizes dangerous sessionId characters', () => {
    const dir = getSessionDir('../../../etc/passwd');
    expect(dir).not.toContain('..');
    expect(dir).toContain('sessions');
  });

  it('sessionDirExists returns false for non-existent session', () => {
    expect(sessionDirExists('nonexistent')).toBe(false);
  });

  it('deleteSessionDir returns false for non-existent session', () => {
    expect(deleteSessionDir('nonexistent')).toBe(false);
  });

  it('sessionDirExists detects persisted jsonl sessions', () => {
    const dir = getSessionDir('dir-test');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'session.jsonl'), '{}\n');
    expect(fs.existsSync(dir)).toBe(true);
    expect(sessionDirExists('dir-test')).toBe(true);
  });

  it('deleteSessionDir removes persisted session directories', () => {
    const dir = getSessionDir('dir-delete');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'session.jsonl'), '{}\n');
    expect(deleteSessionDir('dir-delete')).toBe(true);
    expect(fs.existsSync(dir)).toBe(false);
  });
});

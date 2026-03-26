import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { deleteSessionDir, getOrCreateSessionManager, getSessionDir, sessionDirExists } from '@/lib/pi-integration/session-store';

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

  it('creates a persistent session manager when sessionId is provided', () => {
    const sm = getOrCreateSessionManager('test-session-1', '/tmp/cwd');
    expect(sm.isPersisted()).toBe(true);
  });

  it('returns inMemory when sessionId is undefined', () => {
    const sm = getOrCreateSessionManager(undefined, '/tmp/cwd');
    expect(sm.isPersisted()).toBe(false);
  });

  it('sessionDirExists returns false for non-existent session', () => {
    expect(sessionDirExists('nonexistent')).toBe(false);
  });

  it('deleteSessionDir returns false for non-existent session', () => {
    expect(deleteSessionDir('nonexistent')).toBe(false);
  });

  it('creates session dir on getOrCreateSessionManager', () => {
    getOrCreateSessionManager('dir-test', '/tmp/cwd');
    const dir = getSessionDir('dir-test');
    expect(fs.existsSync(dir)).toBe(true);
  });
});

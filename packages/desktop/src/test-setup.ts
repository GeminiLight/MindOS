import { afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every test file gets an actual isolated home before its modules load. ESM
// Electron mocks do not intercept desktop-home's CommonJS require fallback;
// unit tests must never load the real Electron runtime or inspect a user's home.
const previousHome = process.env.MINDOS_DESKTOP_HOME_DIR;
const testHome = mkdtempSync(join(tmpdir(), 'mindos-desktop-test-'));
process.env.MINDOS_DESKTOP_HOME_DIR = testHome;

afterAll(() => {
  if (previousHome === undefined) delete process.env.MINDOS_DESKTOP_HOME_DIR;
  else process.env.MINDOS_DESKTOP_HOME_DIR = previousHome;
  rmSync(testHome, { recursive: true, force: true });
});

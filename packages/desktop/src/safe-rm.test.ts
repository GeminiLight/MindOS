import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { assessDeletionRisk } from './safe-rm';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('safe-rm deletion risk assessment', () => {
  it('does not treat in-config child paths with consecutive dots as system paths', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'mindos-safe-rm-'));
    tempRoots.push(home);
    const configDir = path.join(home, '.mindos');

    const risks = assessDeletionRisk(path.join(configDir, '..cache', 'runtime'), configDir);

    expect(risks.isSystemPath).toBe(false);
  });

  it('treats sibling paths outside config as system paths', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'mindos-safe-rm-'));
    tempRoots.push(home);
    const configDir = path.join(home, '.mindos');

    const risks = assessDeletionRisk(path.join(home, '.mindos-other', 'runtime'), configDir);

    expect(risks.isSystemPath).toBe(true);
  });
});

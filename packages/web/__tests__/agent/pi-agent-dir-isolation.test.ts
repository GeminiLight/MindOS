import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Session setup syncs the web-search config and may give back a legacy link
// in ~/.pi; run it against a temp home, never the developer's real one.
const home = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  return { dir: mkdtempSync(join(tmpdir(), 'mindos-pi-home-')) };
});

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, default: { ...actual, homedir: () => home.dir }, homedir: () => home.dir };
});
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, default: { ...actual, homedir: () => home.dir }, homedir: () => home.dir };
});

const { getMindosWebPiRuntimePaths } = await import('@/lib/agent/mindos-pi-runtime-host');
const { getMindosPiAgentDir, resetMindosPiAgentDirForTests } = await import('@geminilight/mindos/foundation');

/**
 * MindOS embeds Pi but is its own product, so the embedded Pi's agent
 * directory is MindOS-owned. It used to be `~/.pi` — the user's own Pi home —
 * where Pi auto-discovers extensions, skills and prompts; isolation held only
 * because Pi's real directory is `~/.pi/agent`, one segment over.
 */

const ORIGINAL = process.env.PI_CODING_AGENT_DIR;

beforeEach(() => resetMindosPiAgentDirForTests());

afterEach(() => {
  resetMindosPiAgentDirForTests();
  fs.rmSync(path.join(home.dir, '.mindos'), { recursive: true, force: true });
  if (ORIGINAL === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = ORIGINAL;
});

function paths() {
  return getMindosWebPiRuntimePaths({
    projectRoot: path.join(home.dir, 'mindos-project'),
    mindRoot: path.join(home.dir, 'mindos-mind'),
    serverSettings: {},
  });
}

// Core resolves the home directory inside its built dist, which vi.mock does
// not reach, so these assertions describe the shape of the path rather than
// a particular home. Production resolves both sides with the real os.
describe('the embedded Pi agent directory', () => {
  it('is MindOS-owned, under ~/.mindos', () => {
    const { agentDir } = paths();
    expect(agentDir).toBe(getMindosPiAgentDir());
    expect(path.basename(agentDir)).toBe('pi');
    expect(path.basename(path.dirname(agentDir))).toBe('.mindos');
  });

  it('is never the user\'s own Pi home', () => {
    const { agentDir } = paths();
    const segments = agentDir.split(path.sep);
    expect(segments).not.toContain('.pi');
  });

  it('is what Pi extensions resolve too, so they read the same state the session uses', () => {
    const { agentDir } = paths();
    expect(process.env.PI_CODING_AGENT_DIR).toBe(agentDir);
  });
});

// @vitest-environment node
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ~/.mindos/web-search.json is the single source of truth for web search.
 * pi-web-access (third party) reads its config from PI_CODING_AGENT_DIR, which
 * MindOS points at ~/.mindos/pi, so the config is exposed there — inside
 * ~/.mindos.
 *
 * The previous implementation exposed it by replacing the user's own
 * ~/.pi/web-search.json with a symlink. That changed the user's standalone Pi,
 * and when their file failed to parse it was deleted without being migrated.
 */

// Seeded before any import: a module that resolves the home directory eagerly
// must still land in a temp dir, never a path relative to the repo.
const home = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  return { dir: mkdtempSync(join(tmpdir(), 'mindos-websearch-seed-')) };
});

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, default: { ...actual, homedir: () => home.dir }, homedir: () => home.dir };
});

const config = await import('@/lib/web-search-config');

const mindosFile = () => path.join(home.dir, '.mindos', 'web-search.json');
const exposedFile = () => path.join(home.dir, '.mindos', 'pi', 'web-search.json');
const userPiFile = () => path.join(home.dir, '.pi', 'web-search.json');

function readExposed(): unknown {
  return JSON.parse(fs.readFileSync(exposedFile(), 'utf-8'));
}

beforeEach(() => {
  home.dir = fs.mkdtempSync(path.join(tmpdir(), 'mindos-websearch-home-'));
});

afterEach(() => {
  fs.rmSync(home.dir, { recursive: true, force: true });
});

describe('saving the web search config', () => {
  it('writes the MindOS file and exposes it where pi-web-access reads', () => {
    config.writeWebSearchConfig({ provider: 'exa', exaApiKey: 'k1' });

    expect(config.readWebSearchConfig()).toEqual({ provider: 'exa', exaApiKey: 'k1' });
    expect(readExposed()).toEqual({ provider: 'exa', exaApiKey: 'k1' });
  });

  it('keeps the exposed copy current across saves', () => {
    config.writeWebSearchConfig({ provider: 'exa' });
    config.writeWebSearchConfig({ provider: 'perplexity' });

    expect(readExposed()).toEqual({ provider: 'perplexity' });
  });

  it('never creates anything in the user\'s ~/.pi', () => {
    config.writeWebSearchConfig({ provider: 'exa' });

    expect(fs.existsSync(path.join(home.dir, '.pi'))).toBe(false);
  });
});

describe('the user\'s own Pi config is left alone', () => {
  it('does not touch a real ~/.pi/web-search.json', () => {
    fs.mkdirSync(path.dirname(userPiFile()), { recursive: true });
    fs.writeFileSync(userPiFile(), '{"provider":"gemini","geminiApiKey":"theirs"}');

    config.writeWebSearchConfig({ provider: 'exa' });
    config.syncPiWebSearchConfig();

    expect(fs.lstatSync(userPiFile()).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(userPiFile(), 'utf-8')).toBe('{"provider":"gemini","geminiApiKey":"theirs"}');
  });

  it('keeps a ~/.pi file that does not parse, which the old code deleted unmigrated', () => {
    fs.mkdirSync(path.dirname(userPiFile()), { recursive: true });
    fs.writeFileSync(userPiFile(), '{ // a comment makes this invalid JSON\n "provider": "gemini" }');

    config.writeWebSearchConfig({ provider: 'exa' });
    config.syncPiWebSearchConfig();

    expect(fs.readFileSync(userPiFile(), 'utf-8')).toContain('a comment makes this invalid JSON');
  });
});

describe('giving back the link earlier releases left in ~/.pi', () => {
  function plantLegacyLink(): void {
    fs.mkdirSync(path.dirname(mindosFile()), { recursive: true });
    fs.writeFileSync(mindosFile(), '{"provider":"exa","exaApiKey":"k1"}\n');
    fs.mkdirSync(path.dirname(userPiFile()), { recursive: true });
    fs.symlinkSync(mindosFile(), userPiFile());
  }

  it('turns our symlink back into a plain file with the content Pi was reading', () => {
    plantLegacyLink();

    config.syncPiWebSearchConfig();

    expect(fs.lstatSync(userPiFile()).isSymbolicLink()).toBe(false);
    expect(JSON.parse(fs.readFileSync(userPiFile(), 'utf-8'))).toEqual({ provider: 'exa', exaApiKey: 'k1' });
  });

  it('stops MindOS edits from leaking into the user\'s Pi once given back', () => {
    plantLegacyLink();
    config.syncPiWebSearchConfig();

    config.writeWebSearchConfig({ provider: 'perplexity' });

    expect(JSON.parse(fs.readFileSync(userPiFile(), 'utf-8'))).toEqual({ provider: 'exa', exaApiKey: 'k1' });
  });

  it('leaves a symlink alone when it points somewhere other than MindOS', () => {
    const elsewhere = path.join(home.dir, 'dotfiles', 'web-search.json');
    fs.mkdirSync(path.dirname(elsewhere), { recursive: true });
    fs.writeFileSync(elsewhere, '{"provider":"gemini"}');
    fs.mkdirSync(path.dirname(userPiFile()), { recursive: true });
    fs.symlinkSync(elsewhere, userPiFile());

    config.syncPiWebSearchConfig();

    expect(fs.readlinkSync(userPiFile())).toBe(elsewhere);
  });

  it('removes our link when it points at a MindOS file that no longer exists', () => {
    fs.mkdirSync(path.dirname(userPiFile()), { recursive: true });
    fs.symlinkSync(mindosFile(), userPiFile());

    config.syncPiWebSearchConfig();

    expect(fs.existsSync(userPiFile())).toBe(false);
    expect(() => fs.lstatSync(userPiFile())).toThrow();
  });
});

describe('exposing an existing config at session start', () => {
  it('exposes a config saved before this upgrade, without waiting for the next save', () => {
    fs.mkdirSync(path.dirname(mindosFile()), { recursive: true });
    fs.writeFileSync(mindosFile(), '{"provider":"exa"}\n');

    config.syncPiWebSearchConfig();

    expect(readExposed()).toEqual({ provider: 'exa' });
  });

  it('exposes nothing when the user never configured web search', () => {
    config.syncPiWebSearchConfig();

    expect(fs.existsSync(exposedFile())).toBe(false);
  });

  it('is safe to run on every session start', () => {
    config.writeWebSearchConfig({ provider: 'exa' });

    config.syncPiWebSearchConfig();
    config.syncPiWebSearchConfig();

    expect(readExposed()).toEqual({ provider: 'exa' });
  });
});

describe('reading', () => {
  it('returns an empty config when nothing was saved', () => {
    expect(config.readWebSearchConfig()).toEqual({});
  });

  it('returns an empty config instead of throwing on a corrupt file', () => {
    fs.mkdirSync(path.dirname(mindosFile()), { recursive: true });
    fs.writeFileSync(mindosFile(), 'not json');

    expect(config.readWebSearchConfig()).toEqual({});
  });
});

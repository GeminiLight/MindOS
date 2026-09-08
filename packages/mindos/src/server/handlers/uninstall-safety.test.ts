import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleUninstallPost } from './uninstall.js';

let home: string;
const spawn = vi.fn(() => ({ stdin: { write: vi.fn(), end: vi.fn() }, unref: vi.fn() }));
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'mindos-remove-config-')); spawn.mockClear(); });
afterEach(() => rmSync(home, { recursive: true, force: true }));
function configure(value: unknown) { mkdirSync(join(home, '.mindos'), { recursive: true }); writeFileSync(join(home, '.mindos/config.json'), JSON.stringify(value)); }
function request(env: Record<string, string> = {}) { return handleUninstallPost({ removeConfig: true }, { homeDir: home, env, cliPath: '/fixture/cli.js', spawn }); }

it.each(['same', 'inside', 'ancestor', 'alias'])('rejects %s directory overlap before spawning anything', kind => {
  const dir = join(home, '.mindos'); mkdirSync(dir);
  let mindRoot = kind === 'same' ? dir : kind === 'ancestor' ? home : join(dir, '资料 📝');
  mkdirSync(mindRoot, { recursive: true });
  if (kind === 'alias') { const alias = join(home, 'alias'); symlinkSync(mindRoot, alias, process.platform === 'win32' ? 'junction' : 'dir'); mindRoot = alias; }
  configure({ mindRoot });
  expect(request()).toMatchObject({ status: 409, body: { error: expect.stringContaining('Refusing configuration cleanup') } });
  expect(spawn).not.toHaveBeenCalled(); expect(existsSync(dir)).toBe(true);
});

it.each([null, [], { mindRoot: null }, { mindRoot: 12 }, { mindRoot: '' }, { mindRoot: 'relative/notes' }, { mindRoot: '~another/notes' }])('fails closed for untrustworthy configuration %j', config => {
  configure(config); expect(request().status).toBe(409); expect(spawn).not.toHaveBeenCalled();
});

it('protects an environment-provided knowledge base before cleaning the child environment', () => {
  configure({}); expect(request({ MIND_ROOT: join(home, '.mindos', 'notes') }).status).toBe(409); expect(spawn).not.toHaveBeenCalled();
});

it('protects the default knowledge base when it aliases into configuration', () => {
  configure({});
  const notes = join(home, '.mindos', 'notes'); mkdirSync(notes);
  mkdirSync(join(home, 'MindOS'));
  symlinkSync(notes, join(home, 'MindOS', 'mind'), process.platform === 'win32' ? 'junction' : 'dir');
  expect(request().status).toBe(409); expect(spawn).not.toHaveBeenCalled();
});

it('protects a missing knowledge base under an aliased ancestor', () => {
  configure({});
  const alias = join(home, 'alias');
  symlinkSync(join(home, '.mindos'), alias, process.platform === 'win32' ? 'junction' : 'dir');
  configure({ mindRoot: join(alias, 'future', 'notes') });
  expect(request().status).toBe(409); expect(spawn).not.toHaveBeenCalled();
});

it('fails closed when the configured root is a dangling directory alias', () => {
  const alias = join(home, 'dangling');
  symlinkSync(join(home, 'missing'), alias, process.platform === 'win32' ? 'junction' : 'dir');
  configure({ mindRoot: alias });
  expect(request().status).toBe(409); expect(spawn).not.toHaveBeenCalled();
});

it('reports invalid JSON without launching the command', () => {
  configure({}); writeFileSync(join(home, '.mindos', 'config.json'), '{broken');
  expect(request().status).toBe(409); expect(spawn).not.toHaveBeenCalled();
});

it('expands a current-user path before comparing deletion scope', () => {
  configure({ mindRoot: '~/.mindos/notes' });
  expect(request().status).toBe(409); expect(spawn).not.toHaveBeenCalled();
});

it('allows a sibling whose name shares only a prefix', () => {
  configure({ mindRoot: join(home, '.mindos-notes') });
  expect(request().status).toBe(200); expect(spawn).toHaveBeenCalledTimes(1);
});

it('allows a clean first run with no configuration directory', () => {
  expect(request().status).toBe(200); expect(spawn).toHaveBeenCalledTimes(1);
});

it('rejects a present directory without readable configuration', () => {
  mkdirSync(join(home, '.mindos')); expect(request().status).toBe(409); expect(spawn).not.toHaveBeenCalled();
});

it('refuses a symlinked configuration directory instead of guessing cleanup scope', () => {
  const real = join(home, 'real-config'); mkdirSync(real); writeFileSync(join(real, 'config.json'), '{}');
  symlinkSync(real, join(home, '.mindos'), process.platform === 'win32' ? 'junction' : 'dir');
  expect(request().status).toBe(409); expect(spawn).not.toHaveBeenCalled();
});

it('does not block uninstall that explicitly keeps configuration', () => {
  configure({ mindRoot: join(home, '.mindos') });
  expect(handleUninstallPost({ removeConfig: false }, { homeDir: home, env: {}, cliPath: '/fixture/cli.js', spawn }).status).toBe(200);
});

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { validateBranchStory, type BranchStory } from './index.js';

function directory(home: string, create = false): string {
  const base = path.join(home, '.mindos');
  const dir = path.join(base, 'branch-replays');
  for (const p of [base, dir]) {
    if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink()) throw new Error('Replay storage cannot be a symlink');
  }
  if (create) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function listBranchStories(homeDir = os.homedir()): BranchStory[] {
  const dir = directory(homeDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(n => /^replay-[\w-]+\.json$/.test(n)).slice(0, 50).map(name => {
    const file = path.join(dir, name);
    if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 5_000_000) throw new Error('Invalid saved replay file');
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as BranchStory;
    return validateBranchStory(value.source, value);
  }).sort((a, b) => (b.source.updatedAt ?? 0) - (a.source.updatedAt ?? 0));
}

export function saveBranchStory(story: BranchStory, homeDir = os.homedir()): void {
  const checked = validateBranchStory(story.source, story);
  const serialized = JSON.stringify(checked);
  if (Buffer.byteLength(serialized) > 5_000_000) throw new Error('Replay exceeds the private storage budget');
  const dir = directory(homeDir, true);
  const file = path.join(dir, checked.id + '.json');
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error('Replay destination cannot be a symlink');
  const temp = path.join(dir, `.${checked.id}-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

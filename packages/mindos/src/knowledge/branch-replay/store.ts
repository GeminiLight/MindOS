import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { validateBranchStory, isReplayInternalText, extractBranchStory, type BranchStory } from './index.js';

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
    return readBranchStory(name.slice(0, -5), homeDir);
  }).filter((story): story is BranchStory => !!story).sort((a, b) => (b.source.updatedAt ?? 0) - (a.source.updatedAt ?? 0));
}

/** Direct lookup does not lose a curated story outside the library preview window. */
export function readBranchStory(id: string, homeDir = os.homedir()): BranchStory | null {
  if (!/^replay-(?:codex|claude|example)-[\w-]{1,100}$/.test(id)) throw new Error('Invalid replay identity');
  const file = path.join(directory(homeDir), id + '.json');
  if (!fs.existsSync(file)) return null;
  if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 5_000_000) throw new Error('Invalid saved replay file');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as BranchStory;
  const checked = validateBranchStory(raw.source, raw);
  if (checked.id !== id) throw new Error('Saved replay identity does not match its source');
  const visible = checked.source.messages.filter(message => !isReplayInternalText(message.text));
  // A legacy offline cache may have mistaken 是不是 (a neutral question) for 不是.
  const neutralQuestion = checked.summary === '从原始会话中的反馈与调整，重新走一次判断过程。' && checked.scenes.some(scene => /^是不是/.test(scene.context));
  const internalScene = checked.scenes.some(scene => isReplayInternalText(scene.context) || isReplayInternalText(scene.title) || scene.choices.some(choice => isReplayInternalText(choice.description) || choice.outcome.steps.some(step => isReplayInternalText(step.text))));
  if (visible.length !== checked.source.messages.length || internalScene || neutralQuestion) {
    const source = { ...checked.source, messages: visible };
    // Old caches may contain scheduler text. Repair the read projection without
    // rewriting curated files, and reconstruct only if a scene depended on it.
    if (internalScene || neutralQuestion) return extractBranchStory(source);
    try { return validateBranchStory(source, checked); }
    catch { return extractBranchStory(source); }
  }
  return checked;
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

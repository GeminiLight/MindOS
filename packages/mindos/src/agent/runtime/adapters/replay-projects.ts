import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ReplayMessage } from '../../../knowledge/branch-replay/index.js';

/** Read Git's identity files only. No commands or basename-based guesses. */
export function replayProjectIdentity(cwd?: string): { id: string; title: string; path: string } {
  if (!cwd?.trim() || !path.isAbsolute(cwd)) return { id: 'unassigned', title: '未归属项目', path: '' };
  let canonical = path.resolve(cwd);
  try { canonical = fs.realpathSync(canonical); } catch { /* Deleted work directories remain individually discoverable. */ }
  let root = canonical;
  for (let depth = 0; depth < 32; depth++) {
    const git = path.join(root, '.git');
    try {
      const stat = fs.statSync(git);
      if (stat.isDirectory()) { canonical = root; break; }
      if (stat.isFile() && stat.size < 4096) {
        const match = /^gitdir:\s*(.+)\s*$/m.exec(fs.readFileSync(git, 'utf8'));
        if (match) {
          canonical = root;
          const gitdir = path.resolve(root, match[1]!.trim()), commonFile = path.join(gitdir, 'commondir');
          if (fs.existsSync(commonFile) && fs.statSync(commonFile).size < 4096) {
            const common = fs.realpathSync(path.resolve(gitdir, fs.readFileSync(commonFile, 'utf8').trim()));
            if (path.basename(common) === '.git') canonical = path.dirname(common);
          }
          break;
        }
      }
    } catch { /* An unreadable parent must not hide a session. */ }
    const parent = path.dirname(root); if (parent === root) break; root = parent;
  }
  return { id: 'project-' + createHash('sha256').update(canonical).digest('hex').slice(0, 24), title: path.basename(canonical) || canonical, path: canonical };
}

/** Preserve full local neighborhoods: sampled gaps must never create a false before/after. */
export function sampleReplayMessages(all: ReplayMessage[]) {
  const selected = new Set<number>();
  const add = (i: number) => { if (i >= 0 && i < all.length && selected.size < 512) selected.add(i); };
  for (let i = 0; i < Math.min(20, all.length); i++) add(i);
  for (let i = Math.max(0, all.length - 60); i < all.length; i++) add(i);
  for (let i = 1; i < all.length - 1; i++) {
    const message = all[i]!;
    if ((message.role === 'user' && /不是|不要|不需要|取舍|但是|风险|instead|rather than|trade.?off/i.test(message.text)) || /(?:方案|路径|option)\s*[ABCD１２1234]/i.test(message.text)) {
      for (let j = i - 2; j <= i + 2; j++) add(j);
    }
  }
  if (all.length <= 512) for (let i = 0; i < all.length; i++) add(i);
  const remaining = 512 - selected.size;
  for (let i = 0; i < remaining; i++) add(Math.floor(i * Math.max(0, all.length - 1) / Math.max(1, remaining - 1)));
  let chars = 0;
  const messages = [...selected].sort((a, b) => a - b).flatMap(i => {
    const message = all[i]!; if (chars + message.text.length > 2_000_000) return [];
    chars += message.text.length; return [{ ...message, sequence: i }];
  });
  return { messages, coverage: { totalMessages: all.length, includedMessages: messages.length, truncated: messages.length < all.length } };
}

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Git hooks (pre-push etc.) export GIT_DIR — and may export GIT_WORK_TREE,
 * GIT_INDEX_FILE, GIT_OBJECT_DIRECTORY, GIT_PREFIX — pointing at the hook's
 * own repository. A child `git` spawned with that env and a *different* cwd
 * silently treats the cwd as the hook repo's work tree: `git add -A` stages
 * a deletion of the entire real tree plus the temp files, and `git commit`
 * lands on the real branch.
 *
 * Real incident (2026-06-12): running the test suite from a pre-push hook
 * let sync-test "seed remote" commits land on the development worktree and
 * delete nearly the whole tree. Product sync code must therefore scrub these
 * repo-targeting vars from its own process so every git it spawns operates
 * on the explicit cwd/mindRoot — regardless of how the process was launched.
 */

const repoRoot = path.resolve(__dirname, '../..');
const syncJsPath = path.join(repoRoot, 'packages/mindos/bin/lib/sync.js');

const GIT_REPO_TARGETING_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
  'GIT_QUARANTINE_PATH',
];

/** Env for this test's own git calls: never inherit repo-targeting vars. */
function cleanGitEnv(): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  ) as NodeJS.ProcessEnv;
  env.GIT_AUTHOR_NAME = 'MindOS Test';
  env.GIT_AUTHOR_EMAIL = 'mindos-test@example.com';
  env.GIT_COMMITTER_NAME = 'MindOS Test';
  env.GIT_COMMITTER_EMAIL = 'mindos-test@example.com';
  return env;
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: 'pipe', env: cleanGitEnv() }).trim();
}

function initRepoWithCommit(dir: string, file: string, content: string): string {
  fs.mkdirSync(dir, { recursive: true });
  git(['init'], dir);
  git(['checkout', '-B', 'main'], dir);
  fs.writeFileSync(path.join(dir, file), content, 'utf-8');
  git(['add', '-A'], dir);
  git(['commit', '-m', `init ${file}`], dir);
  return git(['rev-parse', 'HEAD'], dir);
}

describe('git env isolation (hook-exported GIT_DIR must not redirect repo operations)', () => {
  it('importing bin/lib/sync.js scrubs repo-targeting GIT_* vars so spawned git hits the cwd repo, not the GIT_DIR repo', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-git-env-'));
    try {
      // The "real repo" a hypothetical hook would be running for.
      const decoyRepo = path.join(tempDir, 'decoy');
      const decoyHead = initRepoWithCommit(decoyRepo, 'precious.md', 'do not touch\n');

      // The temp repo sync code legitimately works on (mindRoot analogue).
      const workRepo = path.join(tempDir, 'work');
      initRepoWithCommit(workRepo, 'note.md', 'v1\n');
      fs.writeFileSync(path.join(workRepo, 'note.md'), 'v2\n', 'utf-8');

      // Simulate the hook context: launch a fresh node with GIT_DIR pointing
      // at the decoy, import the product sync lib, then run add/commit in the
      // work repo with plain inherited env — exactly what sync.js does.
      const childScript = [
        "const { execFileSync } = await import('node:child_process');",
        `await import(${JSON.stringify(pathToFileURL(syncJsPath).href)});`,
        `const cwd = ${JSON.stringify(workRepo)};`,
        "execFileSync('git', ['add', '-A'], { cwd, stdio: 'pipe' });",
        "execFileSync('git', ['commit', '-m', 'work-repo commit'], { cwd, stdio: 'pipe' });",
        "console.log('GIT_DIR_AFTER_IMPORT=' + (process.env.GIT_DIR ?? '<unset>'));",
      ].join('\n');

      const childEnv = cleanGitEnv();
      childEnv.GIT_DIR = path.join(decoyRepo, '.git');
      childEnv.GIT_AUTHOR_NAME = 'MindOS Test';
      childEnv.GIT_AUTHOR_EMAIL = 'mindos-test@example.com';
      childEnv.GIT_COMMITTER_NAME = 'MindOS Test';
      childEnv.GIT_COMMITTER_EMAIL = 'mindos-test@example.com';

      const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', childScript], {
        cwd: tempDir,
        encoding: 'utf-8',
        stdio: 'pipe',
        env: childEnv,
      });

      // The scrub must happen inside the product lib, not rely on the caller.
      expect(stdout).toContain('GIT_DIR_AFTER_IMPORT=<unset>');

      // The decoy ("real repo") gained no commits and stayed clean.
      expect(git(['rev-parse', 'HEAD'], decoyRepo)).toBe(decoyHead);
      expect(git(['status', '--porcelain'], decoyRepo)).toBe('');
      expect(fs.readFileSync(path.join(decoyRepo, 'precious.md'), 'utf-8')).toBe('do not touch\n');

      // The commit landed where it belongs: the work repo.
      expect(git(['log', '-1', '--format=%s'], workRepo)).toBe('work-repo commit');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('sync.js documents the scrubbed var list (keep in sync with server handlers)', () => {
    const source = fs.readFileSync(syncJsPath, 'utf-8');
    for (const key of GIT_REPO_TARGETING_VARS) {
      expect(source, `sync.js must scrub ${key}`).toContain(`'${key}'`);
    }
  });
});

#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { buildPrePushCommands, isDocLike, unique } from './pre-push-plan.mjs';

const ZERO_SHA = /^0{40}$/;

function run(command, args, options = {}) {
  const label = [command, ...args].join(' ');
  console.log(`\n$ ${label}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function read(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  if (result.status !== 0) return '';
  return result.stdout.trim();
}

function gitLocalEnvVarNames() {
  const output = read('git', ['rev-parse', '--local-env-vars']);
  return output ? output.split('\n').filter(Boolean) : [];
}

function envWithoutGitHookVars(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of gitLocalEnvVarNames()) {
    delete env[key];
  }
  return env;
}

function parseUpdates(stdin) {
  return stdin
    .trim()
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/);
      return { localRef, localSha, remoteRef, remoteSha };
    })
    .filter((update) => update.localSha && !ZERO_SHA.test(update.localSha));
}

function baseFor(update) {
  if (update.remoteSha && !ZERO_SHA.test(update.remoteSha)) {
    return update.remoteSha;
  }

  const originMain = read('git', ['rev-parse', '--verify', 'origin/main']);
  if (originMain) {
    const mergeBase = read('git', ['merge-base', originMain, update.localSha]);
    if (mergeBase) return mergeBase;
  }

  const parent = read('git', ['rev-parse', '--verify', `${update.localSha}^`]);
  return parent || update.localSha;
}

function changedFilesForRange(base, head) {
  const output = read('git', ['diff', '--name-only', `${base}..${head}`]);
  return output ? output.split('\n').filter(Boolean) : [];
}

function fallbackChangedFiles() {
  const staged = read('git', ['diff', '--cached', '--name-only']);
  const unstaged = read('git', ['diff', '--name-only']);
  const untracked = read('git', ['ls-files', '--others', '--exclude-standard']);
  return unique([
    ...(staged ? staged.split('\n') : []),
    ...(unstaged ? unstaged.split('\n') : []),
    ...(untracked ? untracked.split('\n') : []),
  ]);
}

const stdin = readFileSync(0, 'utf8');
const updates = parseUpdates(stdin);
const ranges = updates.map((update) => ({ base: baseFor(update), head: update.localSha }));
const changedFiles = ranges.length > 0
  ? unique(ranges.flatMap((range) => changedFilesForRange(range.base, range.head)))
  : fallbackChangedFiles();

console.log('MindOS pre-push checks');
if (updates.length > 0) {
  for (const update of updates) {
    console.log(`- ${update.localRef} -> ${update.remoteRef}`);
  }
}
console.log(`- changed files: ${changedFiles.length}`);

if (changedFiles.length === 0) {
  console.log('No changed files detected; skipping checks.');
  process.exit(0);
}

if (ranges.length > 0) {
  for (const range of ranges) {
    run('git', ['diff', '--check', `${range.base}..${range.head}`]);
  }
} else {
  run('git', ['diff', '--check']);
}

if (changedFiles.every(isDocLike)) {
  console.log('\nDocumentation-only push: whitespace check passed; skipping code tests.');
  process.exit(0);
}

const commands = buildPrePushCommands(changedFiles);

if (commands.length === 0) {
  console.log('\nNo automatic code test selected for this path set.');
  console.log('Run focused tests manually if the change affects runtime behavior.');
  process.exit(0);
}

for (const { command, args } of commands) {
  run(command, args, {
    env: envWithoutGitHookVars({
      MINDOS_WEB_PORT: process.env.MINDOS_WEB_PORT || '19456',
      MINDOS_MCP_PORT: process.env.MINDOS_MCP_PORT || '19781',
    }),
  });
}

console.log('\nPre-push checks passed.');

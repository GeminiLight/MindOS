import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const systems = ['ubuntu-latest', 'macos-latest', 'windows-latest'];
function result(channel, reliability, contracts, reason) {
  const required = channel || reliability || contracts;
  return { channel, reliability, contracts, required, reason,
    matrix: { os: channel || reliability ? systems : ['ubuntu-latest'] } };
}
const full = (reason) => result(true, true, true, reason);

export function planChecks(files, manual = false) {
  if (manual) return full('manual');
  if (!Array.isArray(files) || !files.length || files.some((f) =>
    typeof f !== 'string' || !f || f.startsWith('/') || f.split('/').includes('..'))) {
    return full('unknown-change-list');
  }
  let channel = false, reliability = false, contracts = false;
  for (const file of new Set(files)) {
    // Documentation and the separately validated website do not import app code.
    if (/^(wiki|docs|landing)\//.test(file) || /^(README(?:_zh)?\.md|LICENSE|AGENTS\.md|CLAUDE\.md)$/.test(file)
      || file.startsWith('scripts/website/') || /^tests\/(landing-website\.test\.ts|e2e\/landing)/.test(file)) continue;
    // Installer and Rust checks keep their own workflows, including native steps.
    if (/^packages\/(desktop|desktop-tauri)\//.test(file)
      || /^scripts\/[^/]*desktop[^/]*$/.test(file) || /^tests\/desktop-/.test(file)
      || /^\.github\/workflows\/(test-desktop-install|build-desktop|build-tauri-desktop)\.yml$/.test(file)) continue;
    if (file.startsWith('scripts/ci/') || /^tests\/(ci-|actions-cost-policy|reliability-workflow|workflow-migration-contract)/.test(file)
      || /^\.github\/workflows\/(test-reliability|test-channel-cross-platform|cache-ci-dependencies)\.yml$/.test(file)) {
      contracts = true; continue;
    }
    if (/^tests\//.test(file)) { contracts = true; continue; }
    if (file.startsWith('packages/mobile/')) { reliability = true; continue; }
    if (/^packages\/web\/(lib\/im\/|app\/api\/channels\/|__tests__\/(channel-|im\/|api\/channels-))/.test(file)
      || /^packages\/mindos\/bin\/(commands\/channel\.js|lib\/channel-)/.test(file)) {
      channel = true; continue;
    }
    // Shared core, lockfiles, Web code and new/unclassified inputs may affect both.
    channel = true; reliability = true; contracts = true;
  }
  return result(channel, reliability, contracts, 'changed-files');
}

export function changedFiles({ base, head, cwd = process.cwd() }) {
  if (![base, head].every((ref) => typeof ref === 'string' && /^[a-f0-9]{40,64}$/i.test(ref))) return null;
  try {
    // --no-renames includes deletions AND additions so moves cannot hide old ownership.
    const output = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', `${base}...${head}`, '--'],
      { cwd, encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    return output.split('\0').filter(Boolean);
  } catch { return null; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const plan = planChecks(changedFiles({ base: process.env.PR_BASE_SHA, head: process.env.PR_HEAD_SHA }),
    process.env.GITHUB_EVENT_NAME === 'workflow_dispatch');
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(plan)
      .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}\n`).join(''));
  }
  console.log(JSON.stringify(plan));
}

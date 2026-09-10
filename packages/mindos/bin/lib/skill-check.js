import { existsSync, readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { ROOT } from './constants.js';
import { bold, dim, cyan, green, yellow, isTTY } from './colors.js';

const SKILLS = ['mindos', 'mindos-zh'];
const INSTALLED_BASE = resolve(homedir(), '.agents', 'skills');
const CONFIG_PATH = resolve(homedir(), '.mindos', 'config.json');

/**
 * Simple semver "a > b" comparison (major.minor.patch only).
 */
function semverGt(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

/**
 * Extract version from `<!-- version: X.Y.Z -->` comment in a file.
 * Returns null if file doesn't exist or has no version tag.
 */
export function extractSkillVersion(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const match = content.match(/<!--\s*version:\s*([\d.]+)\s*-->/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/* ── Config helpers (read-only view of the legacy installedSkillAgents ledger) ── */

/**
 * Read config.json, best-effort.
 */
function readConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Read the legacy installed-skill-agents list from config. The CLI never
 * writes this field any more: links on disk are the only truth, and the
 * product server drops the ledger after its one-time migration.
 * @returns {Array<{ agent: string, skill: string, path: string }>}
 */
export function getInstalledSkillAgents() {
  const config = readConfig();
  return Array.isArray(config.installedSkillAgents) ? config.installedSkillAgents : [];
}

/* ── Version checking ─────────────────────────────────────────── */

/**
 * Compare installed vs bundled skill versions.
 * Checks both the default ~/.agents/skills/ path AND all agent-specific
 * paths recorded in config.installedSkillAgents.
 *
 * @param {string} [root] — package root (defaults to ROOT)
 * @returns {Array<{ name, installed, bundled, installPath, bundledPath, agent? }>}
 */
export function checkSkillVersions(root) {
  const base = root || ROOT;
  const mismatches = [];
  const seen = new Set(); // dedup by installPath

  // 1. Check default ~/.agents/skills/ (legacy path)
  for (const name of SKILLS) {
    const installPath = resolve(INSTALLED_BASE, name, 'SKILL.md');
    const bundledPath = resolve(base, 'skills', name, 'SKILL.md');
    if (!existsSync(installPath) || !existsSync(bundledPath)) continue;
    const installed = extractSkillVersion(installPath);
    const bundled = extractSkillVersion(bundledPath);
    if (!installed || !bundled) continue;
    if (semverGt(bundled, installed)) {
      mismatches.push({ name, installed, bundled, installPath, bundledPath });
    }
    seen.add(installPath);
  }

  // 2. Check agent-specific paths from config
  const agentRecords = getInstalledSkillAgents();
  for (const record of agentRecords) {
    const installPath = record.path;
    if (!installPath || seen.has(installPath)) continue;
    seen.add(installPath);

    const skillName = record.skill || 'mindos';
    const bundledPath = resolve(base, 'skills', skillName, 'SKILL.md');
    if (!existsSync(bundledPath)) continue;

    if (!existsSync(installPath)) {
      // Path doesn't exist — skill not installed yet or was removed.
      // Don't clean up the record: user may install the skill later,
      // and we want to auto-update it when they do.
      continue;
    }

    const installed = extractSkillVersion(installPath);
    const bundled = extractSkillVersion(bundledPath);
    if (!installed || !bundled) continue;
    if (semverGt(bundled, installed)) {
      mismatches.push({
        name: skillName,
        installed,
        bundled,
        installPath,
        bundledPath,
        agent: record.agent,
      });
    }
  }

  return mismatches;
}

/**
 * Copy bundled SKILL.md over the installed version.
 * Creates parent directory if needed.
 */
export function updateSkill(bundledPath, installPath) {
  const dir = dirname(installPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  copyFileSync(bundledPath, installPath);
}

/**
 * Print skill update hints and optionally prompt user to update.
 */
export async function promptSkillUpdate(mismatches) {
  if (!mismatches || mismatches.length === 0) return;

  for (const m of mismatches) {
    const agentLabel = m.agent ? ` (${m.agent})` : '';
    console.log(`\n  ${yellow('⬆')}  Skill ${bold(m.name)}${agentLabel}: ${dim(`v${m.installed}`)} → ${cyan(`v${m.bundled}`)}`);
  }

  // Non-interactive mode: just print hint
  if (!isTTY() || process.env.LAUNCHED_BY_LAUNCHD === '1' || process.env.INVOCATION_ID) {
    console.log(`     ${dim('Run `mindos start` in a terminal to update interactively.')}`);
    return;
  }

  // Interactive prompt (10s timeout)
  return new Promise((res) => {
    let done = false;
    const finish = () => { if (!done) { done = true; res(); } };

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const timer = setTimeout(() => { rl.close(); finish(); }, 10_000);
    rl.on('close', finish);

    rl.question(`     Update skill${mismatches.length > 1 ? 's' : ''}? ${dim('(Y/n)')} `, (answer) => {
      clearTimeout(timer);
      rl.close();
      const yes = !answer || answer.trim().toLowerCase() !== 'n';
      if (yes) {
        for (const m of mismatches) {
          try {
            updateSkill(m.bundledPath, m.installPath);
            const agentLabel = m.agent ? ` (${m.agent})` : '';
            console.log(`  ${green('✓')} ${dim(`Updated ${m.name}${agentLabel} → v${m.bundled}`)}`);
          } catch (err) {
            console.log(`  ${yellow('!')} ${dim(`Failed to update ${m.name}: ${err.message}`)}`);
          }
        }
      }
      finish();
    });
  });
}

/**
 * Main entry: check + prompt. Best-effort, never throws.
 */
export async function runSkillCheck() {
  if (process.env.MINDOS_NO_SKILL_CHECK === '1') return;
  try {
    const mismatches = checkSkillVersions();
    await promptSkillUpdate(mismatches);
  } catch { /* best-effort, don't block startup */ }
}

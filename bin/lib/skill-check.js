import { existsSync, readFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { ROOT } from './constants.js';
import { bold, dim, cyan, green, yellow, isTTY } from './colors.js';

const SKILLS = ['mindos', 'mindos-zh'];
const INSTALLED_BASE = resolve(homedir(), '.agents', 'skills');

/**
 * Simple semver "a > b" comparison (major.minor.patch only).
 * Intentionally inlined (same as update-check.js) to keep this module
 * self-contained — no cross-module dependency for a 10-line function.
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

/**
 * Compare installed vs bundled skill versions.
 * @param {string} [root] — package root to read bundled skills from.
 *   Defaults to the static ROOT (fine for startup). Pass the post-update
 *   root when called from `mindos update` so we read the NEW package's skills.
 * Returns array of mismatches where bundled > installed.
 */
export function checkSkillVersions(root) {
  const base = root || ROOT;
  const mismatches = [];
  for (const name of SKILLS) {
    const installPath = resolve(INSTALLED_BASE, name, 'SKILL.md');
    const bundledPath = resolve(base, 'skills', name, 'SKILL.md');

    if (!existsSync(installPath)) continue;
    if (!existsSync(bundledPath)) continue;

    const installed = extractSkillVersion(installPath);
    const bundled = extractSkillVersion(bundledPath);

    if (!installed || !bundled) continue;
    if (semverGt(bundled, installed)) {
      mismatches.push({ name, installed, bundled, installPath, bundledPath });
    }
  }
  return mismatches;
}

/**
 * Copy bundled SKILL.md over the installed version.
 */
export function updateSkill(bundledPath, installPath) {
  copyFileSync(bundledPath, installPath);
}

/**
 * Print skill update hints and optionally prompt user to update.
 *
 * - TTY + not daemon: interactive readline prompt (default Y)
 * - Non-TTY / daemon / MINDOS_NO_SKILL_CHECK=1: one-line hint, no block
 */
export async function promptSkillUpdate(mismatches) {
  if (!mismatches || mismatches.length === 0) return;

  // Print mismatch info
  for (const m of mismatches) {
    console.log(`\n  ${yellow('⬆')}  Skill ${bold(m.name)}: ${dim(`v${m.installed}`)} → ${cyan(`v${m.bundled}`)}`);
  }

  // Non-interactive mode: just print hint
  if (!isTTY() || process.env.LAUNCHED_BY_LAUNCHD === '1' || process.env.INVOCATION_ID) {
    console.log(`     ${dim('Run `mindos start` in a terminal to update interactively.')}`);
    return;
  }

  // Interactive prompt (10s timeout to avoid blocking startup indefinitely)
  return new Promise((res) => {
    let done = false;
    const finish = () => { if (!done) { done = true; res(); } };

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const timer = setTimeout(() => { rl.close(); finish(); }, 10_000);

    rl.on('close', finish); // handles broken pipe / EOF

    rl.question(`     Update skill${mismatches.length > 1 ? 's' : ''}? ${dim('(Y/n)')} `, (answer) => {
      clearTimeout(timer);
      rl.close();
      const yes = !answer || answer.trim().toLowerCase() !== 'n';
      if (yes) {
        for (const m of mismatches) {
          try {
            updateSkill(m.bundledPath, m.installPath);
            console.log(`  ${green('✓')} ${dim(`Updated ${m.name} → v${m.bundled}`)}`);
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

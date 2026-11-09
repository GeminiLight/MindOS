/**
 * Read/write web search config at ~/.mindos/web-search.json.
 *
 * ~/.mindos/web-search.json is the single source of truth for all web search
 * config. pi-web-access (third party) reads its config from
 * `$PI_CODING_AGENT_DIR/web-search.json`, and MindOS points that variable at
 * its own ~/.mindos/pi (see `installMindosPiAgentDir`). So the file is
 * exposed there — inside ~/.mindos. MindOS never writes the user's ~/.pi.
 *
 * Earlier releases exposed it by replacing ~/.pi/web-search.json with a
 * symlink to the MindOS file. That rewired the user's standalone Pi, and when
 * their file failed to parse it was deleted without being migrated.
 * `syncPiWebSearchConfig` gives such a link back as a plain file.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { getMindosPiAgentDir } from '@geminilight/mindos/foundation';

const FILE_NAME = 'web-search.json';

// Resolved per call, not at import: the home directory is process state, and
// fixing it at module load made the paths impossible to reason about in tests.
function mindosConfigPath(): string {
  return path.join(os.homedir(), '.mindos', FILE_NAME);
}

/** Where pi-web-access looks, given the agent dir MindOS installs. */
function exposedConfigPath(): string {
  return path.join(getMindosPiAgentDir(os.homedir()), FILE_NAME);
}

/** Only ever inspected to undo what earlier releases left there. */
function legacyUserPiPath(): string {
  return path.join(os.homedir(), '.pi', FILE_NAME);
}

export interface WebSearchExtConfig {
  provider?: string;        // 'auto' | 'exa' | 'perplexity' | 'gemini'
  exaApiKey?: string;
  perplexityApiKey?: string;
  geminiApiKey?: string;
  [key: string]: unknown;   // preserve other pi-web-access fields
}

/** Read config from ~/.mindos/web-search.json */
export function readWebSearchConfig(): WebSearchExtConfig {
  try {
    const file = mindosConfigPath();
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

/** Write config to ~/.mindos/web-search.json and expose it to pi-web-access. */
export function writeWebSearchConfig(config: WebSearchExtConfig): void {
  const file = mindosConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  syncPiWebSearchConfig();
}

/**
 * Make the MindOS config visible where pi-web-access reads, and give back any
 * link earlier releases left in the user's ~/.pi. Cheap and idempotent, so it
 * runs at every session start: a config saved before this upgrade must reach
 * pi-web-access without waiting for the user's next save.
 */
export function syncPiWebSearchConfig(): void {
  releaseLegacyUserPiLink();
  exposeToPiWebAccess();
}

function exposeToPiWebAccess(): void {
  const source = mindosConfigPath();
  const target = exposedConfigPath();
  try {
    if (!fs.existsSync(source)) return;
    fs.mkdirSync(path.dirname(target), { recursive: true });

    try {
      if (fs.readlinkSync(target) === source) return;
    } catch {
      // Not a symlink, or absent.
    }
    // Everything at `target` is MindOS-owned (it lives in ~/.mindos), so it
    // can be replaced without asking.
    fs.rmSync(target, { force: true });
    try {
      fs.symlinkSync(source, target);
    } catch {
      // Windows without admin rights or Developer Mode cannot create symlinks.
      // A copy works too: every save calls back into here and refreshes it.
      fs.copyFileSync(source, target);
    }
  } catch {
    // Non-fatal: pi-web-access falls back to its own default provider.
  }
}

/**
 * Earlier releases replaced ~/.pi/web-search.json with a symlink to the MindOS
 * file. Only that exact link is ours to undo; a real file, or a link pointing
 * anywhere else, belongs to the user and is never touched. The link is turned
 * back into a plain file holding what the user's Pi was reading through it, so
 * their standalone Pi keeps working and stops following MindOS edits.
 */
function releaseLegacyUserPiLink(): void {
  const legacy = legacyUserPiPath();
  const source = mindosConfigPath();
  try {
    if (fs.readlinkSync(legacy) !== source) return;
  } catch {
    return; // Not a symlink, or absent: not ours.
  }
  try {
    if (!fs.existsSync(source)) {
      fs.unlinkSync(legacy); // Dangling link to a MindOS file that is gone.
      return;
    }
    // Write beside it, then rename over the link: rename replaces the link
    // itself, atomically, so the user's Pi never sees a missing file.
    const temp = `${legacy}.mindos-release-${process.pid}`;
    fs.writeFileSync(temp, fs.readFileSync(source));
    fs.renameSync(temp, legacy);
  } catch {
    // Non-fatal: leaving the old link in place is no worse than before.
  }
}

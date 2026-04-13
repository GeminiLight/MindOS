/**
 * Read/write web search config at ~/.mindos/web-search.json.
 *
 * ~/.mindos/web-search.json is the single source of truth for all web search config.
 *
 * pi-web-access (third-party) hardcodes ~/.pi/web-search.json, so we maintain
 * a symlink ~/.pi/web-search.json → ~/.mindos/web-search.json transparently.
 * Users never need to know about ~/.pi/ — all docs and UI point to ~/.mindos/.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const MINDOS_CONFIG_PATH = path.join(os.homedir(), '.mindos', 'web-search.json');
/** Internal: pi-web-access reads from here. Kept in sync via symlink. */
const PI_CONFIG_PATH = path.join(os.homedir(), '.pi', 'web-search.json');

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
    if (!fs.existsSync(MINDOS_CONFIG_PATH)) return {};
    return JSON.parse(fs.readFileSync(MINDOS_CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

/** Write config to ~/.mindos/web-search.json and sync symlink for pi-web-access. */
export function writeWebSearchConfig(config: WebSearchExtConfig): void {
  const dir = path.dirname(MINDOS_CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(MINDOS_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  ensurePiSymlink();
}

/**
 * Ensure ~/.pi/web-search.json is a symlink to ~/.mindos/web-search.json.
 *
 * Call this at startup so pi-web-access (which hardcodes ~/.pi/) reads
 * the same config that MindOS manages at ~/.mindos/.
 * If ~/.pi/web-search.json is a real file, its content is merged into
 * ~/.mindos/web-search.json before being replaced by the symlink.
 */
export function ensurePiSymlink(): void {
  try {
    const piDir = path.dirname(PI_CONFIG_PATH);
    if (!fs.existsSync(piDir)) fs.mkdirSync(piDir, { recursive: true });

    // Already a correct symlink?
    try {
      if (fs.readlinkSync(PI_CONFIG_PATH) === MINDOS_CONFIG_PATH) return;
    } catch {
      // Not a symlink or doesn't exist — continue
    }

    // If a real file exists at ~/.pi/, migrate its content then replace with symlink
    if (fs.existsSync(PI_CONFIG_PATH)) {
      const stat = fs.lstatSync(PI_CONFIG_PATH);
      if (!stat.isSymbolicLink()) {
        try {
          const piData = JSON.parse(fs.readFileSync(PI_CONFIG_PATH, 'utf-8'));
          const mindosData = readWebSearchConfig();
          const merged = { ...piData, ...mindosData };
          const mindosDir = path.dirname(MINDOS_CONFIG_PATH);
          if (!fs.existsSync(mindosDir)) fs.mkdirSync(mindosDir, { recursive: true });
          fs.writeFileSync(MINDOS_CONFIG_PATH, JSON.stringify(merged, null, 2) + '\n');
        } catch { /* ignore parse errors during migration */ }
      }
      fs.unlinkSync(PI_CONFIG_PATH);
    }

    // On Windows, symlinks require admin privileges or Developer Mode.
    // Fall back to copying the file instead.
    try {
      fs.symlinkSync(MINDOS_CONFIG_PATH, PI_CONFIG_PATH);
    } catch {
      // Symlink failed (Windows without admin/dev mode) — copy file as fallback
      try {
        fs.copyFileSync(MINDOS_CONFIG_PATH, PI_CONFIG_PATH);
      } catch { /* non-fatal */ }
    }
  } catch {
    // Non-fatal: worst case pi-web-access uses its own default (Exa MCP fallback)
  }
}

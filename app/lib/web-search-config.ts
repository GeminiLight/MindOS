/**
 * Read/write pi-web-access config at ~/.mindos/web-search.json.
 *
 * pi-web-access reads from ~/.pi/web-search.json (hardcoded).
 * We maintain a symlink ~/.pi/web-search.json → ~/.mindos/web-search.json
 * so both MindOS Settings UI and pi-web-access see the same config.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const MINDOS_CONFIG_PATH = path.join(os.homedir(), '.mindos', 'web-search.json');
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

/** Write config to ~/.mindos/web-search.json and ensure symlink from ~/.pi/ */
export function writeWebSearchConfig(config: WebSearchExtConfig): void {
  // Ensure ~/.mindos/ exists
  const mindosDir = path.dirname(MINDOS_CONFIG_PATH);
  if (!fs.existsSync(mindosDir)) fs.mkdirSync(mindosDir, { recursive: true });

  fs.writeFileSync(MINDOS_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');

  // Ensure symlink: ~/.pi/web-search.json → ~/.mindos/web-search.json
  ensureSymlink();
}

/** Create symlink ~/.pi/web-search.json → ~/.mindos/web-search.json if needed */
function ensureSymlink(): void {
  try {
    const piDir = path.dirname(PI_CONFIG_PATH);
    if (!fs.existsSync(piDir)) fs.mkdirSync(piDir, { recursive: true });

    // Check if symlink already exists and points to the right place
    try {
      const existing = fs.readlinkSync(PI_CONFIG_PATH);
      if (existing === MINDOS_CONFIG_PATH) return; // Already correct
    } catch {
      // Not a symlink or doesn't exist
    }

    // Remove existing file/symlink if any (but only if it's a symlink or if we need to replace)
    if (fs.existsSync(PI_CONFIG_PATH)) {
      const stat = fs.lstatSync(PI_CONFIG_PATH);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(PI_CONFIG_PATH);
      } else {
        // It's a real file — migrate its content to ~/.mindos/ first
        try {
          const existing = JSON.parse(fs.readFileSync(PI_CONFIG_PATH, 'utf-8'));
          const current = readWebSearchConfig();
          // Merge: existing pi config as base, mindos config as override
          const merged = { ...existing, ...current };
          fs.writeFileSync(MINDOS_CONFIG_PATH, JSON.stringify(merged, null, 2) + '\n');
        } catch { /* ignore parse errors */ }
        fs.unlinkSync(PI_CONFIG_PATH);
      }
    }

    fs.symlinkSync(MINDOS_CONFIG_PATH, PI_CONFIG_PATH);
  } catch (err) {
    // Non-fatal: pi-web-access will still work if user manually configures ~/.pi/web-search.json
    console.warn('[web-search-config] Failed to create symlink:', err);
  }
}

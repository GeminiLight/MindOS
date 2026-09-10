/**
 * Config-format facade for third-party agent MCP configs.
 *
 * Agents keep their MCP server maps in one of three formats:
 *
 * - JSON / JSONC (`.mcp.json`, `~/.claude.json`, VS Code-family `settings.json`,
 *   Kilo `kilo.jsonc`, CoPaw `config.json` whose global map nests under
 *   `mcp.clients`): edited in place through `jsonc-parser` so the user's
 *   comments and formatting survive. Implemented here.
 * - TOML (Codex `~/.codex/config.toml`): `mcp-config-toml.ts`.
 * - YAML (Hermes `~/.hermes/config.yaml`): `mcp-config-yaml.ts`.
 *
 * This module knows nothing about which agents exist or where their files
 * live. `mcp-install.ts` resolves an agent + scope into an
 * `McpServerEntryLocation` and delegates every read / write / remove to the
 * dispatchers at the bottom of this file. The format-specific walkers are
 * re-exported so callers and tests import one module. The CLI consumes the
 * very same code through the esbuild bundle `bin/lib/generated/agent-config.mjs`.
 */

import crypto from 'node:crypto';
import { renameSync, unlinkSync, writeFileSync } from 'node:fs';
import {
  parseJsonc,
  parseJsoncDocument,
  removeJsoncValue,
  setJsoncValue,
} from '../../foundation/shared/utils/jsonc.js';
import { listTomlServerNames, mergeTomlEntry, parseTomlMcpServerEntry, removeTomlEntry } from './toml.js';
import type { AgentConfigFormat, McpServerEntryLocation } from './types.js';
import { listYamlServerNames, mergeYamlEntry, parseYamlMcpServerEntry, removeYamlEntry } from './yaml.js';

export { buildTomlEntry, listTomlServerNames, mergeTomlEntry, parseTomlMcpServerEntry, removeTomlEntry } from './toml.js';
export { buildYamlEntry, listYamlServerNames, mergeYamlEntry, parseYamlMcpServerEntry, removeYamlEntry } from './yaml.js';
export { stripBom } from './text.js';

export type McpConfigFormat = AgentConfigFormat;
export type { McpServerEntryLocation };


/** Agents default to JSON/JSONC; only an explicit `toml` / `yaml` selects a line walker. */
export function detectConfigFormat(format: string | undefined): McpConfigFormat {
  return format === 'toml' || format === 'yaml' ? format : 'json';
}

// ---------------------------------------------------------------------------
// Atomic write
// ---------------------------------------------------------------------------

/**
 * Write via a same-directory temp file + rename so a crash mid-write can
 * never leave a third-party agent config truncated or half-written. The temp
 * name carries pid, time and a random tail so two writers in one process (or
 * a pid reused across restarts) never clobber each other's temp file.
 */
export function writeFileAtomically(absPath: string, content: string): void {
  const tmpPath = `${absPath}.tmp-${process.pid}.${Date.now().toString(36)}.${crypto.randomBytes(3).toString('hex')}`;
  try {
    writeFileSync(tmpPath, content, 'utf-8');
    renameSync(tmpPath, absPath);
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // Nothing to clean up (the temp file was never created).
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Key safety (prototype-pollution guards shared by every format)
// ---------------------------------------------------------------------------

function isUnsafeObjectKey(key: string): boolean {
  return key === '__proto__' || key === 'prototype' || key === 'constructor';
}

export function assertSafeObjectKeyPath(dotPath: string, label: string): string[] {
  const parts = dotPath.split('.').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0 || parts.some(isUnsafeObjectKey)) {
    throw new Error(`Invalid ${label}`);
  }
  return parts;
}

export function assertSafeObjectKey(key: string, label: string): void {
  if (!key || isUnsafeObjectKey(key)) throw new Error(`Invalid ${label}`);
}

export function assertSafeMcpServerName(serverName: string): void {
  if (!serverName.trim() || /[\r\n\0]/.test(serverName) || isUnsafeObjectKey(serverName)) {
    throw new Error('Invalid MCP server name');
  }
}

export function readOwnRecord(obj: Record<string, unknown>, key: string): Record<string, unknown> | null {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return null;
  const value = obj[key];
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

export function getNestedPath(obj: Record<string, unknown>, dotPath: string): Record<string, unknown> | null {
  const parts = assertSafeObjectKeyPath(dotPath, 'nested config path');
  let current: unknown = obj;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return null;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current && typeof current === 'object' ? current as Record<string, unknown> : null;
}

// ---------------------------------------------------------------------------
// JSON / JSONC
// ---------------------------------------------------------------------------

export type JsonConfigDocument = {
  text: string;
  value: Record<string, unknown>;
  warnings: string[];
};

/**
 * Parse an existing JSON/JSONC agent config for in-place editing. Edits are
 * applied to the original text (`jsonc-parser` modify), so comments and
 * formatting survive. Recoverable syntax issues (the parser still yields an
 * object) become warnings the caller surfaces; anything else throws.
 */
export function readJsonConfigDocument(absPath: string, text: string): JsonConfigDocument {
  if (!text.trim()) return { text, value: {}, warnings: [] };
  const { value, errors } = parseJsoncDocument(text);
  if (value === undefined) {
    // A comment-only file parses to nothing: treat it as an empty config (the
    // comment itself survives because the edit is applied to the original text).
    let empty = false;
    try {
      empty = Object.keys(parseJsonc(text)).length === 0;
    } catch {
      empty = false;
    }
    if (empty) return { text, value: {}, warnings: [] };
    throw new SyntaxError(`Failed to parse ${absPath}: ${errors.join('; ')}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SyntaxError(`Failed to parse ${absPath}: expected a JSON object at the document root`);
  }
  const warnings = errors.length > 0
    ? [`${absPath} has JSONC syntax issues (${errors.join('; ')}); MindOS edited it in place without repairing them`]
    : [];
  return { text, value: value as Record<string, unknown>, warnings };
}

/** JSON path of a server entry inside an agent config. */
function jsonServerEntryPath(location: McpServerEntryLocation, serverName: string): string[] {
  if (location.nestedPath) {
    return [...assertSafeObjectKeyPath(location.nestedPath, 'nested config path'), serverName];
  }
  assertSafeObjectKey(location.sectionKey, 'agent config key');
  return [location.sectionKey, serverName];
}

function jsonServerContainer(
  document: JsonConfigDocument,
  location: McpServerEntryLocation,
): Record<string, unknown> | null {
  if (location.nestedPath) return getNestedPath(document.value, location.nestedPath);
  assertSafeObjectKey(location.sectionKey, 'agent config key');
  return readOwnRecord(document.value, location.sectionKey);
}

function readJsonServerEntry(
  content: string,
  location: McpServerEntryLocation,
  serverName: string,
): Record<string, unknown> | null {
  const config = parseJsonc(content);
  const container = location.nestedPath
    ? getNestedPath(config, location.nestedPath)
    : readOwnRecord(config, location.sectionKey);
  const entry = container ? readOwnRecord(container, serverName) : null;
  return entry ? JSON.parse(JSON.stringify(entry)) as Record<string, unknown> : null;
}

/** Insert or replace `serverName` in place; returns parse warnings for the caller. */
function writeJsonServerEntry(
  absPath: string,
  existingText: string,
  location: McpServerEntryLocation,
  serverName: string,
  entry: Record<string, unknown>,
): string[] {
  const document = readJsonConfigDocument(absPath, existingText);
  writeFileAtomically(absPath, setJsoncValue(document.text, jsonServerEntryPath(location, serverName), entry));
  return document.warnings;
}

/** Remove `serverName` in place when present; the file is untouched otherwise. */
function removeJsonServerEntry(
  absPath: string,
  existingText: string,
  location: McpServerEntryLocation,
  serverName: string,
): string[] {
  const document = readJsonConfigDocument(absPath, existingText);
  const container = jsonServerContainer(document, location);
  if (!container || !(serverName in container)) return document.warnings;
  writeFileAtomically(absPath, removeJsoncValue(document.text, jsonServerEntryPath(location, serverName)));
  return document.warnings;
}

// ---------------------------------------------------------------------------
// Format dispatch
// ---------------------------------------------------------------------------

/** Read `serverName` from config text; null when it is not configured. Throws on unparsable JSON. */
export function readMcpServerEntryFromText(
  content: string,
  location: McpServerEntryLocation,
  serverName: string,
): Record<string, unknown> | null {
  assertSafeMcpServerName(serverName);
  if (location.format === 'toml') return parseTomlMcpServerEntry(content, location.sectionKey, serverName);
  if (location.format === 'yaml') return parseYamlMcpServerEntry(content, location.sectionKey, serverName);
  return readJsonServerEntry(content, location, serverName);
}

/**
 * Names of every server configured at `location`, sorted. Unparsable JSON
 * yields an empty list (a broken config configures nothing); TOML / YAML are
 * line walkers and never throw.
 */
export function listMcpServerNamesFromText(content: string, location: McpServerEntryLocation): string[] {
  if (location.format === 'toml') return listTomlServerNames(content, location.sectionKey);
  if (location.format === 'yaml') return listYamlServerNames(content, location.sectionKey);
  let config: Record<string, unknown>;
  try {
    config = parseJsonc(content);
  } catch {
    return [];
  }
  const container = location.nestedPath
    ? getNestedPath(config, location.nestedPath)
    : readOwnRecord(config, location.sectionKey);
  return Object.keys(container ?? {})
    .filter((name) => !isUnsafeObjectKey(name))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Insert or replace `serverName` and write the file atomically. Returns the
 * non-fatal warnings (only JSONC files with recoverable syntax issues produce any).
 */
export function writeMcpServerEntryToFile(
  absPath: string,
  existingText: string,
  location: McpServerEntryLocation,
  serverName: string,
  entry: Record<string, unknown>,
): string[] {
  assertSafeMcpServerName(serverName);
  if (location.format === 'toml') {
    writeFileAtomically(absPath, mergeTomlEntry(existingText, location.sectionKey, serverName, entry));
    return [];
  }
  if (location.format === 'yaml') {
    writeFileAtomically(absPath, mergeYamlEntry(existingText, location.sectionKey, serverName, entry));
    return [];
  }
  return writeJsonServerEntry(absPath, existingText, location, serverName, entry);
}

/** Remove `serverName` and write the file atomically; same warnings contract as the writer. */
export function removeMcpServerEntryFromFile(
  absPath: string,
  existingText: string,
  location: McpServerEntryLocation,
  serverName: string,
): string[] {
  assertSafeMcpServerName(serverName);
  if (location.format === 'toml') {
    writeFileAtomically(absPath, removeTomlEntry(existingText, location.sectionKey, serverName));
    return [];
  }
  if (location.format === 'yaml') {
    writeFileAtomically(absPath, removeYamlEntry(existingText, location.sectionKey, serverName));
    return [];
  }
  return removeJsonServerEntry(absPath, existingText, location, serverName);
}

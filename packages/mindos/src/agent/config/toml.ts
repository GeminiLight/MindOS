/**
 * TOML walker for Codex `~/.codex/config.toml`.
 *
 * A server is a `[mcp_servers.<name>]` table plus optional
 * `[mcp_servers.<name>.env]` / `.headers` sub-tables. Names that are not bare
 * keys are quoted (`[mcp_servers."my.server"]`); the legacy unquoted spelling
 * is still recognised on read and removed on write. Reads also understand an
 * inline table `name = { ... }` directly under `[mcp_servers]`.
 */

import {
  bareOrQuotedKey,
  collapseBlankLines,
  parseScalarLiteral,
  trimTrailingBlankLines,
} from './text.js';

/** Remove comments only outside quoted values; hashes in tokens and URLs are data. */
function withoutTomlComment(line: string): string {
  let quote: string | null = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote === '"' && char === '\\' && !escaped) { escaped = true; continue; }
    if (!escaped) {
      if (quote && char === quote) quote = null;
      else if (!quote && (char === '"' || char === "'")) quote = char;
      else if (!quote && char === '#') return line.slice(0, index).trim();
    }
    escaped = false;
  }
  return line.trim();
}

function tomlTablePath(sectionKey: string, serverName: string, ...suffixes: string[]): string {
  return [
    ...sectionKey.split('.').filter(Boolean).map(bareOrQuotedKey),
    bareOrQuotedKey(serverName),
    ...suffixes.map(bareOrQuotedKey),
  ].join('.');
}

/** Every table header that belongs to one server: quoted-path and legacy unquoted spellings. */
function tomlServerTableHeaders(sectionKey: string, serverName: string): Set<string> {
  return new Set([
    `[${tomlTablePath(sectionKey, serverName)}]`,
    `[${tomlTablePath(sectionKey, serverName, 'env')}]`,
    `[${tomlTablePath(sectionKey, serverName, 'headers')}]`,
    `[${sectionKey}.${serverName}]`,
    `[${sectionKey}.${serverName}.env]`,
    `[${sectionKey}.${serverName}.headers]`,
  ]);
}

/** `name = { ... }` (bare or quoted key) directly under the bare `[section]` header. */
function isTomlInlineServerLine(trimmed: string, serverName: string): boolean {
  const match = trimmed.match(/^("(?:[^"\\]|\\.)*"|[A-Za-z0-9_-]+)\s*=/);
  if (!match?.[1]) return false;
  const key = match[1].startsWith('"') ? JSON.parse(match[1]) as string : match[1];
  return key === serverName;
}

/**
 * Drop each table (header plus body up to the next header) that belongs to
 * `serverName`, and its inline table `name = { ... }` under the bare
 * `[section]` header, so a merge never leaves two definitions of one server.
 */
function stripTomlServerTables(existing: string, sectionKey: string, serverName: string): string[] {
  const headers = tomlServerTableHeaders(sectionKey, serverName);
  const result: string[] = [];
  let skipping = false;
  let inRootSection = false;

  for (const line of existing.split('\n')) {
    const trimmed = withoutTomlComment(line);
    const parts = trimmed.startsWith('[') && trimmed.endsWith(']') ? splitTomlHeaderPath(trimmed.slice(1, -1)) : [];
    const target = [...sectionKey.split('.'), serverName];
    if (headers.has(trimmed) || (parts.length >= target.length && target.every((part, index) => parts[index] === part))) {
      skipping = true;
      inRootSection = false;
      continue;
    }
    if (trimmed.startsWith('[')) {
      skipping = false;
      inRootSection = trimmed === `[${sectionKey}]`;
    } else if (inRootSection && isTomlInlineServerLine(trimmed, serverName)) {
      continue;
    }
    if (!skipping) result.push(line);
  }
  return result;
}

/** Split a table header path into segments, honouring double-quoted segments (`a."b.c".d`). */
function splitTomlHeaderPath(header: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < header.length; i += 1) {
    const ch = header[i];
    if (ch === '"' && header[i - 1] !== '\\') {
      quoted = !quoted;
    } else if (ch === '.' && !quoted) {
      segments.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  segments.push(current.trim());
  return segments.map((segment) => {
    if (segment.startsWith('"') && segment.endsWith('"') && segment.length >= 2) {
      try {
        return JSON.parse(segment) as string;
      } catch {
        return segment.slice(1, -1);
      }
    }
    return segment;
  }).filter(Boolean);
}

/** Server names configured under `sectionKey`: `[section.name]` tables (any spelling) and inline `name = {` entries. */
export function listTomlServerNames(existing: string, sectionKey: string): string[] {
  const sectionPath = sectionKey.split('.').filter(Boolean);
  const names = new Set<string>();
  let inRootSection = false;

  for (const line of existing.split('\n')) {
    const trimmed = withoutTomlComment(line);
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const segments = splitTomlHeaderPath(trimmed.slice(1, -1));
      const underSection = segments.length > sectionPath.length
        && sectionPath.every((part, index) => segments[index] === part);
      inRootSection = segments.length === sectionPath.length && sectionPath.every((part, index) => segments[index] === part);
      if (underSection && segments[sectionPath.length]) names.add(segments[sectionPath.length]!);
      continue;
    }
    if (!inRootSection) continue;
    const match = trimmed.match(/^("(?:[^"\\]|\\.)*"|[A-Za-z0-9_-]+)\s*=/);
    if (!match?.[1]) continue;
    try {
      names.add(match[1].startsWith('"') ? JSON.parse(match[1]) as string : match[1]);
    } catch {
      // Unterminated quoted key: not a server we can name.
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function tomlValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(', ')}]`;
  if (value && typeof value === 'object') return `{ ${Object.entries(value).map(([key, item]) => `${bareOrQuotedKey(key)} = ${tomlValue(item)}`).join(', ')} }`;
  throw new Error('MCP configuration contains a value TOML cannot represent.');
}

export function buildTomlEntry(sectionKey: string, serverName: string, entry: Record<string, unknown>): string {
  const lines = [`[${tomlTablePath(sectionKey, serverName)}]`];
  const nested: Array<[string, Record<string, unknown>]> = [];
  for (const [key, value] of Object.entries(entry)) {
    if (value == null) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) nested.push([key, value as Record<string, unknown>]);
    else lines.push(`${bareOrQuotedKey(key)} = ${tomlValue(value)}`);
  }
  for (const [key, value] of nested) {
    lines.push('', `[${tomlTablePath(sectionKey, serverName, key)}]`);
    for (const [name, item] of Object.entries(value)) lines.push(`${bareOrQuotedKey(name)} = ${tomlValue(item)}`);
  }
  return lines.join('\n');
}

/** Replace the server's tables (if any) and append the fresh ones at the end of the file. */
export function mergeTomlEntry(existing: string, sectionKey: string, serverName: string, entry: Record<string, unknown>): string {
  const result = stripTomlServerTables(existing, sectionKey, serverName);
  trimTrailingBlankLines(result);
  result.push('', buildTomlEntry(sectionKey, serverName, entry), '');
  return result.join('\n');
}

export function removeTomlEntry(existing: string, sectionKey: string, serverName: string): string {
  return collapseBlankLines(stripTomlServerTables(existing, sectionKey, serverName)).join('\n');
}

function parseTomlValue(rawValue: string): unknown {
  const raw = rawValue.trim().replace(/,$/, '');
  if (raw.startsWith('"')) {
    try { return JSON.parse(raw); } catch { throw new Error('Invalid TOML string'); }
  }
  if (raw.startsWith('{')) return parseTomlInlineObject(raw);
  if (raw.startsWith('[') && raw.endsWith(']')) return splitTopLevelTomlItems(raw.slice(1, -1)).map(parseTomlValue);
  return parseScalarLiteral(raw);
}

function splitTopLevelTomlItems(body: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let bracketDepth = 0;

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    const prev = body[i - 1];
    if ((ch === '"' || ch === "'") && prev !== '\\') {
      quote = quote === ch ? null : quote ?? ch;
    } else if (!quote && (ch === '[' || ch === '{')) {
      bracketDepth += 1;
    } else if (!quote && (ch === ']' || ch === '}')) {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (!quote && bracketDepth === 0 && ch === ',') {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseTomlInlineObject(rawValue: string): Record<string, unknown> | null {
  const raw = rawValue.trim();
  if (!raw.startsWith('{') || !raw.endsWith('}')) return null;
  const body = raw.slice(1, -1).trim();
  if (!body) return {};

  const result: Record<string, unknown> = {};
  for (const part of splitTopLevelTomlItems(body)) {
    const match = part.match(/^\s*("(?:[^"\\]|\\.)*"|[A-Za-z0-9_-]+)\s*=\s*(.+?)\s*$/);
    if (!match) continue;
    const key = match[1]?.startsWith('"') ? JSON.parse(match[1]) as string : match[1];
    const value = match[2];
    if (!key || value == null) continue;
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid TOML key');
    result[key] = parseTomlValue(value);
  }
  return result;
}

/**
 * Read one server from a TOML config. Understands `[section.name]` tables with
 * `.env` / `.headers` sub-tables (quoted or legacy unquoted headers) and an
 * inline table `name = { ... }` directly under `[section]`.
 */
export function parseTomlMcpServerEntry(existing: string, sectionKey: string, serverName: string): Record<string, unknown> | null {
  const target = [...sectionKey.split('.'), serverName];
  const entry: Record<string, unknown> = {};
  let current: Record<string, unknown> | null = null;
  let root = false;
  for (const line of existing.split('\n')) {
    const trimmed = withoutTomlComment(line);
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      let parts = splitTomlHeaderPath(trimmed.slice(1, -1));
      const legacy = `${sectionKey}.${serverName}`;
      const header = trimmed.slice(1, -1);
      if (header === legacy || header.startsWith(`${legacy}.`)) parts = [...target, ...header.slice(legacy.length).split('.').filter(Boolean)];
      root = trimmed === `[${sectionKey}]`;
      current = null;
      if (target.every((part, index) => parts[index] === part)) {
        current = entry;
        for (const part of parts.slice(target.length)) {
          if (['__proto__', 'constructor', 'prototype'].includes(part)) throw new Error('Invalid TOML key');
          current[part] ??= {};
          current = current[part] as Record<string, unknown>;
        }
      }
      continue;
    }
    const match = trimmed.match(/^("(?:[^"\\]|\\.)*"|[A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!match) continue;
    const key = match[1]!.startsWith('"') ? JSON.parse(match[1]!) as string : match[1]!;
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid TOML key');
    if (current) current[key] = parseTomlValue(match[2]!);
    else if (root && key === serverName) return parseTomlInlineObject(match[2]!);
  }
  return Object.keys(entry).length ? entry : null;
}

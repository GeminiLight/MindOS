/**
 * TOML walker for Codex `~/.codex/config.toml`.
 *
 * A server is a `[mcp_servers.<name>]` table plus optional
 * `[mcp_servers.<name>.env]` / `.headers` sub-tables. Names that are not bare
 * keys are quoted (`[mcp_servers."my.server"]`); the legacy unquoted spelling
 * is still recognised on read and removed on write. Reads also understand an
 * inline table `name = { ... }` directly under `[mcp_servers]`.
 *
 * The CLI keeps a build/merge mirror in `bin/lib/toml.js` (node builtins only).
 */

import {
  bareOrQuotedKey,
  collapseBlankLines,
  parseScalarLiteral,
  quotedConfigString,
  trimTrailingBlankLines,
} from './mcp-config-text.js';

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
    const trimmed = line.trim();
    if (headers.has(trimmed)) {
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
    const trimmed = line.trim();
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

export function buildTomlEntry(sectionKey: string, serverName: string, entry: Record<string, unknown>): string {
  const lines: string[] = [`[${tomlTablePath(sectionKey, serverName)}]`];
  if (entry.type) lines.push(`type = ${quotedConfigString(entry.type)}`);
  if (entry.command) lines.push(`command = ${quotedConfigString(entry.command)}`);
  if (entry.url) lines.push(`url = ${quotedConfigString(entry.url)}`);
  if (Array.isArray(entry.args)) lines.push(`args = [${entry.args.map(quotedConfigString).join(', ')}]`);
  if (entry.env && typeof entry.env === 'object') {
    lines.push('', `[${tomlTablePath(sectionKey, serverName, 'env')}]`);
    for (const [key, value] of Object.entries(entry.env)) lines.push(`${bareOrQuotedKey(key)} = ${quotedConfigString(value)}`);
  }
  if (entry.headers && typeof entry.headers === 'object') {
    lines.push('', `[${tomlTablePath(sectionKey, serverName, 'headers')}]`);
    for (const [key, value] of Object.entries(entry.headers)) lines.push(`${bareOrQuotedKey(key)} = ${quotedConfigString(value)}`);
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
  return parseScalarLiteral(rawValue.trim().replace(/,$/, ''));
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
    } else if (!quote && ch === '[') {
      bracketDepth += 1;
    } else if (!quote && ch === ']') {
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
    const match = part.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    if (!key || value == null) continue;
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
  const targetSection = tomlTablePath(sectionKey, serverName);
  const envSection = tomlTablePath(sectionKey, serverName, 'env');
  const headersSection = tomlTablePath(sectionKey, serverName, 'headers');
  const legacyTargetSection = `${sectionKey}.${serverName}`;
  const legacyEnvSection = `${sectionKey}.${serverName}.env`;
  const legacyHeadersSection = `${sectionKey}.${serverName}.headers`;
  const entry: Record<string, unknown> = {};
  let current: 'entry' | 'env' | 'headers' | 'root' | null = null;

  for (const line of existing.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const section = trimmed.slice(1, -1).trim();
      if (section === targetSection || section === legacyTargetSection) current = 'entry';
      else if (section === envSection || section === legacyEnvSection) current = 'env';
      else if (section === headersSection || section === legacyHeadersSection) current = 'headers';
      else if (section === sectionKey) current = 'root';
      else current = null;
      continue;
    }

    const match = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!match) continue;
    const key = match[1];
    const rawValue = match[2];
    if (!key || !rawValue) continue;

    if (current === 'entry') {
      entry[key] = parseTomlValue(rawValue);
    } else if (current === 'env' || current === 'headers') {
      const nestedKey = current;
      const nested = entry[nestedKey] && typeof entry[nestedKey] === 'object'
        ? entry[nestedKey] as Record<string, unknown>
        : {};
      nested[key] = parseTomlValue(rawValue);
      entry[nestedKey] = nested;
    } else if (current === 'root' && key === serverName) {
      const inline = parseTomlInlineObject(rawValue);
      if (inline) return inline;
    }
  }

  return Object.keys(entry).length > 0 ? entry : null;
}

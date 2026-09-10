/**
 * YAML walker for Hermes `~/.hermes/config.yaml`.
 *
 * Servers live under a top-level `mcp_servers:` mapping, one block per server
 * with optional `env:` / `headers:` sub-mappings. The walkers are
 * indentation-aware line scanners, not a YAML parser: they replace or remove
 * exactly one server block and leave every other line (comments included)
 * byte-for-byte intact.
 *
 * The CLI keeps a build/merge mirror in `bin/lib/yaml.js` (node builtins only).
 */

import {
  bareOrQuotedKey,
  bomPrefix,
  collapseBlankLines,
  parseScalarLiteral,
  quotedConfigString,
  stripBom,
  trimTrailingBlankLines,
} from './mcp-config-text.js';

function isYamlMappingLine(trimmed: string, key: string): boolean {
  return trimmed === `${key}:` || trimmed === `${bareOrQuotedKey(key)}:`;
}

/** `key: {}` (optionally spaced, optionally followed by a comment): an empty flow mapping. */
function isYamlEmptyFlowMappingLine(trimmed: string, key: string): boolean {
  const match = trimmed.match(/^(.+?):\s*\{\s*\}\s*(?:#.*)?$/);
  return !!match && (match[1] === key || match[1] === bareOrQuotedKey(key));
}

export function buildYamlEntry(serverName: string, entry: Record<string, unknown>): string {
  const lines: string[] = [`  ${bareOrQuotedKey(serverName)}:`];
  if (entry.type) lines.push(`    type: ${quotedConfigString(entry.type)}`);
  if (entry.command) lines.push(`    command: ${quotedConfigString(entry.command)}`);
  if (entry.url) lines.push(`    url: ${quotedConfigString(entry.url)}`);
  if (Array.isArray(entry.args)) lines.push(`    args: [${entry.args.map(quotedConfigString).join(', ')}]`);
  if (entry.env && typeof entry.env === 'object') {
    lines.push('    env:');
    for (const [key, value] of Object.entries(entry.env)) lines.push(`      ${bareOrQuotedKey(key)}: ${quotedConfigString(value)}`);
  }
  if (entry.headers && typeof entry.headers === 'object') {
    lines.push('    headers:');
    for (const [key, value] of Object.entries(entry.headers)) lines.push(`      ${bareOrQuotedKey(key)}: ${quotedConfigString(value)}`);
  }
  return lines.join('\n');
}

/**
 * Replace the server block inside the `sectionKey:` mapping (or append the
 * block at the end of that mapping); create the mapping when it is missing.
 */
export function mergeYamlEntry(existing: string, sectionKey: string, serverName: string, entry: Record<string, unknown>): string {
  const newBlock = buildYamlEntry(serverName, entry);
  const bom = bomPrefix(existing);
  existing = stripBom(existing);
  if (!existing.trim()) return `${bom}${sectionKey}:\n${newBlock}\n`;

  const result: string[] = [];
  let inSection = false;
  let sectionFound = false;
  let baseIndent = -1;
  let skipping = false;
  let serverIndent = -1;

  for (const line of existing.split('\n')) {
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;

    if (indent === 0 && isYamlMappingLine(trimmed, sectionKey)) {
      inSection = true;
      sectionFound = true;
      baseIndent = -1;
      result.push(line);
      continue;
    }
    if (indent === 0 && !inSection && isYamlEmptyFlowMappingLine(trimmed, sectionKey)) {
      // `mcp_servers: {}` is a complete, empty section: open it as a block
      // mapping holding only the new server instead of appending a second key.
      sectionFound = true;
      result.push(`${sectionKey}:`, newBlock);
      continue;
    }
    if (indent === 0 && trimmed && !trimmed.startsWith('#') && inSection) {
      trimTrailingBlankLines(result);
      result.push(newBlock, '', line);
      inSection = false;
      skipping = false;
      continue;
    }
    if (!inSection) {
      result.push(line);
      continue;
    }
    if (!trimmed || trimmed.startsWith('#')) {
      if (!skipping) result.push(line);
      continue;
    }
    if (baseIndent < 0) baseIndent = indent;
    if (indent === baseIndent) {
      if (isYamlMappingLine(trimmed, serverName)) {
        skipping = true;
        serverIndent = indent;
        continue;
      }
      skipping = false;
    }
    if (skipping) {
      if (indent > serverIndent) continue;
      skipping = false;
    }
    result.push(line);
  }

  if (inSection) {
    trimTrailingBlankLines(result);
    result.push(newBlock);
  }
  if (!sectionFound) {
    trimTrailingBlankLines(result);
    result.push('', `${sectionKey}:`, newBlock);
  }

  let output = result.join('\n');
  if (!output.endsWith('\n')) output += '\n';
  return bom + output;
}

export function removeYamlEntry(existing: string, sectionKey: string, serverName: string): string {
  const bom = bomPrefix(existing);
  existing = stripBom(existing);
  const result: string[] = [];
  let inSection = false;
  let baseIndent = -1;
  let skipping = false;
  let serverIndent = -1;

  for (const line of existing.split('\n')) {
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;

    if (indent === 0 && isYamlMappingLine(trimmed, sectionKey)) {
      inSection = true;
      baseIndent = -1;
      skipping = false;
      result.push(line);
      continue;
    }
    if (indent === 0 && trimmed && inSection) {
      inSection = false;
      skipping = false;
      result.push(line);
      continue;
    }
    if (!inSection) {
      result.push(line);
      continue;
    }
    if (!trimmed || trimmed.startsWith('#')) {
      if (!skipping) result.push(line);
      continue;
    }
    if (baseIndent < 0) baseIndent = indent;
    if (indent === baseIndent) {
      if (isYamlMappingLine(trimmed, serverName)) {
        skipping = true;
        serverIndent = indent;
        continue;
      }
      skipping = false;
    }
    if (skipping) {
      if (indent > serverIndent) continue;
      skipping = false;
    }
    result.push(line);
  }

  let output = collapseBlankLines(result).join('\n');
  if (output && !output.endsWith('\n')) output += '\n';
  return bom + output;
}

function parseYamlScalar(rawValue: string): unknown {
  return parseScalarLiteral(rawValue.trim());
}

/** `key: value` with a bare or double-quoted key; null for block openers and anything else. */
function matchYamlScalarLine(trimmed: string): { key: string; value: string } | null {
  const match = trimmed.match(/^([A-Za-z0-9_-]+|"[^"]+"):\s*(.+)$/);
  const key = match?.[1]?.replace(/^"|"$/g, '');
  const value = match?.[2];
  if (!key || value == null) return null;
  return { key, value };
}

/** Read one server block (with optional `env:` / `headers:` sub-mappings) from a YAML config. */
export function parseYamlMcpServerEntry(existing: string, sectionKey: string, serverName: string): Record<string, unknown> | null {
  existing = stripBom(existing);
  const entry: Record<string, unknown> = {};
  let inSection = false;
  let inServer = false;
  let baseIndent = -1;
  let serverIndent = -1;
  let nestedKey: 'env' | 'headers' | null = null;
  let nestedIndent = -1;

  for (const line of existing.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;

    if (indent === 0 && isYamlMappingLine(trimmed, sectionKey)) {
      inSection = true;
      inServer = false;
      baseIndent = -1;
      serverIndent = -1;
      nestedKey = null;
      nestedIndent = -1;
      continue;
    }
    if (indent === 0 && trimmed) {
      if (inServer) break;
      inSection = false;
      continue;
    }
    if (!inSection) continue;
    if (baseIndent < 0) baseIndent = indent;

    if (indent === baseIndent) {
      if (inServer) break;
      inServer = isYamlMappingLine(trimmed, serverName);
      serverIndent = -1;
      nestedKey = null;
      nestedIndent = -1;
      continue;
    }
    if (!inServer) continue;
    if (serverIndent < 0) serverIndent = indent;
    if (indent === serverIndent) {
      nestedKey = null;
      nestedIndent = -1;
      const blockMatch = trimmed.match(/^(env|headers):\s*$/);
      if (blockMatch?.[1] === 'env' || blockMatch?.[1] === 'headers') {
        nestedKey = blockMatch[1];
        nestedIndent = -1;
        if (!entry[nestedKey]) entry[nestedKey] = {};
        continue;
      }
      const scalar = matchYamlScalarLine(trimmed);
      if (scalar) entry[scalar.key] = parseYamlScalar(scalar.value);
      continue;
    }
    if (!nestedKey) continue;
    if (nestedIndent < 0) nestedIndent = indent;
    if (indent !== nestedIndent) continue;
    const scalar = matchYamlScalarLine(trimmed);
    if (!scalar) continue;
    const nested = entry[nestedKey] as Record<string, unknown>;
    nested[scalar.key] = parseYamlScalar(scalar.value);
  }

  return Object.keys(entry).length > 0 ? entry : null;
}

/** Server names directly under the `sectionKey:` mapping (bare or double-quoted keys); `key: {}` yields none. */
export function listYamlServerNames(existing: string, sectionKey: string): string[] {
  const names = new Set<string>();
  let inSection = false;
  let baseIndent = -1;

  for (const line of stripBom(existing).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;

    if (indent === 0 && isYamlMappingLine(trimmed, sectionKey)) {
      inSection = true;
      baseIndent = -1;
      continue;
    }
    if (indent === 0 && trimmed) {
      inSection = false;
      continue;
    }
    if (!inSection) continue;
    if (baseIndent < 0) baseIndent = indent;
    if (indent !== baseIndent) continue;
    const match = trimmed.match(/^([A-Za-z0-9_-]+|"[^"]+"):(?:\s|$)/);
    const name = match?.[1]?.replace(/^"|"$/g, '');
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

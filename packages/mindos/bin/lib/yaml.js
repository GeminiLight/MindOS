/**
 * YAML utilities for MCP agent configuration.
 *
 * Used by agents whose config format is 'yaml' (currently: Hermes).
 * No external YAML library — hand-rolled for the narrow MCP config use case.
 *
 * @module yaml
 */

function yamlString(value) {
  return JSON.stringify(String(value));
}

function yamlKey(key) {
  const value = String(key);
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : yamlString(value);
}

function isYamlMappingLine(trimmed, key) {
  return trimmed === `${key}:` || trimmed === `${yamlKey(key)}:`;
}

/** `key: {}` (optionally spaced, optionally followed by a comment): an empty flow mapping. */
function isYamlEmptyFlowMappingLine(trimmed, key) {
  const match = trimmed.match(/^(.+?):\s*\{\s*\}\s*(?:#.*)?$/);
  return !!match && (match[1] === key || match[1] === yamlKey(key));
}

/**
 * Split a leading UTF-8 BOM off the text. Indentation is measured with
 * `trimStart()`, which strips U+FEFF, so an un-stripped BOM counts as one
 * column and hides a first-line `mcp_servers:` header.
 */
function splitBom(text) {
  return text.charCodeAt(0) === 0xfeff ? { bom: '﻿', text: text.slice(1) } : { bom: '', text };
}

/**
 * Generate a YAML block for an MCP server entry under a section key.
 *
 * @param {string} serverName  Server name, e.g. 'mindos'
 * @param {Record<string, unknown>} entry  MCP entry object
 * @returns {string} YAML block (indented, without the parent section key)
 *
 * @example
 *   buildYamlEntry('mindos', {
 *     command: 'mindos', args: ['mcp'],
 *     env: { MCP_TRANSPORT: 'stdio' },
 *   })
 *   // →
 *   //   mindos:
 *   //     command: "mindos"
 *   //     args: ["mcp"]
 *   //     env:
 *   //       MCP_TRANSPORT: "stdio"
 */
export function buildYamlEntry(serverName, entry) {
  const lines = [];
  lines.push(`  ${yamlKey(serverName)}:`);

  // Scalar fields
  if (entry.type != null)    lines.push(`    type: ${yamlString(entry.type)}`);
  if (entry.command != null) lines.push(`    command: ${yamlString(entry.command)}`);
  if (entry.url != null)     lines.push(`    url: ${yamlString(entry.url)}`);

  // Array fields
  if (Array.isArray(entry.args)) {
    lines.push(`    args: [${entry.args.map(yamlString).join(', ')}]`);
  }

  // Nested env mapping
  if (entry.env && typeof entry.env === 'object') {
    lines.push('    env:');
    for (const [k, v] of Object.entries(entry.env)) {
      lines.push(`      ${yamlKey(k)}: ${yamlString(v)}`);
    }
  }

  // Nested headers mapping
  if (entry.headers && typeof entry.headers === 'object') {
    lines.push('    headers:');
    for (const [k, v] of Object.entries(entry.headers)) {
      lines.push(`      ${yamlKey(k)}: ${yamlString(v)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Replace or append a server block under the given section key in a YAML file.
 *
 * Algorithm:
 *   1. Find the `sectionKey:` top-level key
 *   2. Within it, find and remove the `serverName:` block (all its indented children)
 *   3. Append the new block
 *
 * If sectionKey doesn't exist, append it at the end.
 *
 * @param {string} existing     Current file content (may be empty)
 * @param {string} sectionKey   Top-level key, e.g. 'mcp_servers'
 * @param {string} serverName   Server name, e.g. 'mindos'
 * @param {Record<string, unknown>} entry  MCP entry object
 * @returns {string} Merged YAML content
 */
export function mergeYamlEntry(existing, sectionKey, serverName, entry) {
  const newBlock = buildYamlEntry(serverName, entry);
  const { bom, text } = splitBom(existing);
  existing = text;

  if (!existing.trim()) {
    return `${bom}${sectionKey}:\n${newBlock}\n`;
  }

  const lines = existing.split('\n');
  const result = [];
  let inSection = false;
  let sectionFound = false;
  let baseIndent = -1;
  let skipping = false;
  let serverIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;

    // Detect top-level section key
    if (indent === 0 && isYamlMappingLine(trimmed, sectionKey)) {
      inSection = true;
      sectionFound = true;
      baseIndent = -1;
      result.push(line);
      continue;
    }

    // `mcp_servers: {}` is a complete, empty section: open it as a block
    // mapping holding only the new server instead of appending a second key.
    if (indent === 0 && !inSection && isYamlEmptyFlowMappingLine(trimmed, sectionKey)) {
      sectionFound = true;
      result.push(`${sectionKey}:`);
      result.push(newBlock);
      continue;
    }

    // Another top-level key → end of section
    if (indent === 0 && trimmed && !trimmed.startsWith('#') && inSection) {
      // Before leaving section, append new block if we were skipping or never found it
      if (inSection) {
        // Remove trailing blank lines within section before appending
        while (result.length > 0 && result[result.length - 1].trim() === '') {
          result.pop();
        }
        result.push(newBlock);
        result.push('');
      }
      inSection = false;
      skipping = false;
      result.push(line);
      continue;
    }

    if (!inSection) {
      result.push(line);
      continue;
    }

    // Inside the section
    if (!trimmed || trimmed.startsWith('#')) {
      if (!skipping) result.push(line);
      continue;
    }

    if (baseIndent < 0) baseIndent = indent;

    // Server name at base indent level
    if (indent === baseIndent) {
      if (isYamlMappingLine(trimmed, serverName)) {
        // Start skipping this server's block
        skipping = true;
        serverIndent = indent;
        continue;
      } else {
        skipping = false;
      }
    }

    // If skipping, skip lines that are deeper than the server indent
    if (skipping) {
      if (indent > serverIndent) {
        continue; // skip child lines
      } else {
        skipping = false;
        // This line is at same or higher level, process normally
      }
    }

    result.push(line);
  }

  // If we're still in the section at EOF, append the new block
  if (inSection) {
    while (result.length > 0 && result[result.length - 1].trim() === '') {
      result.pop();
    }
    result.push(newBlock);
  }

  // If section was never found, append it
  if (!sectionFound) {
    while (result.length > 0 && result[result.length - 1].trim() === '') {
      result.pop();
    }
    result.push('');
    result.push(`${sectionKey}:`);
    result.push(newBlock);
  }

  // Ensure trailing newline; put the original BOM back so the file keeps its prefix
  let output = result.join('\n');
  if (!output.endsWith('\n')) output += '\n';
  return bom + output;
}

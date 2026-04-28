/**
 * YAML utilities for MCP agent configuration.
 *
 * Used by agents whose config format is 'yaml' (currently: Hermes).
 * No external YAML library — hand-rolled for the narrow MCP config use case.
 *
 * @module yaml
 */

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
  lines.push(`  ${serverName}:`);

  // Scalar fields
  if (entry.type != null)    lines.push(`    type: "${entry.type}"`);
  if (entry.command != null) lines.push(`    command: "${entry.command}"`);
  if (entry.url != null)     lines.push(`    url: "${entry.url}"`);

  // Array fields
  if (Array.isArray(entry.args)) {
    lines.push(`    args: [${entry.args.map(a => `"${a}"`).join(', ')}]`);
  }

  // Nested env mapping
  if (entry.env && typeof entry.env === 'object') {
    lines.push('    env:');
    for (const [k, v] of Object.entries(entry.env)) {
      lines.push(`      ${k}: "${v}"`);
    }
  }

  // Nested headers mapping
  if (entry.headers && typeof entry.headers === 'object') {
    lines.push('    headers:');
    for (const [k, v] of Object.entries(entry.headers)) {
      lines.push(`      ${k}: "${v}"`);
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

  if (!existing.trim()) {
    return `${sectionKey}:\n${newBlock}\n`;
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
    if (indent === 0 && trimmed === sectionKey + ':') {
      inSection = true;
      sectionFound = true;
      baseIndent = -1;
      result.push(line);
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
      const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:/);
      if (match && match[1] === serverName) {
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

  // Ensure trailing newline
  let output = result.join('\n');
  if (!output.endsWith('\n')) output += '\n';
  return output;
}

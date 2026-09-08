/**
 * Rewrite MindOS MCP endpoint URLs in client config text.
 *
 * Matches both historical host forms (localhost and 127.0.0.1) and writes
 * back 127.0.0.1: the MCP server binds an IPv4 socket, and on Windows some
 * HTTP stacks resolve localhost to ::1 first and fail to connect. Rewriting
 * also migrates old localhost-form configs in place.
 */
import { existsSync, readFileSync, renameSync as fsRenameSync, unlinkSync, writeFileSync as fsWriteFileSync } from 'fs';

const MCP_HOST_FORMS = ['localhost', '127.0.0.1'];

export function rewriteMcpClientConfig(raw: string, oldPort: number, newPort: number): string | null {
  let result = raw;
  let touched = false;
  for (const host of MCP_HOST_FORMS) {
    const pattern = `${host}:${oldPort}/mcp`;
    if (!result.includes(pattern)) continue;
    result = result.split(pattern).join(`127.0.0.1:${newPort}/mcp`);
    touched = true;
  }
  return touched ? result : null;
}

export type McpConfigRewriteResult = 'updated' | 'unchanged' | 'missing' | 'invalid';

export interface McpConfigFileDeps {
  writeFileSync?: (filePath: string, data: string) => void;
  renameSync?: (from: string, to: string) => void;
}

/**
 * Rewrite one MCP client config file on disk.
 *
 * These are third-party files (~/.claude.json, ~/.cursor/mcp.json, ...), so a
 * half-written file would break the user's other tools. The rewritten text
 * must parse as JSON, and it is written to a pid-suffixed temp file that is
 * renamed over the original so readers only ever see the old or the new text.
 */
export function rewriteMcpClientConfigFile(
  abs: string,
  oldPort: number,
  newPort: number,
  deps: McpConfigFileDeps = {},
): McpConfigRewriteResult {
  if (!existsSync(abs)) return 'missing';
  const raw = readFileSync(abs, 'utf-8');
  const replaced = rewriteMcpClientConfig(raw, oldPort, newPort);
  if (replaced === null) return 'unchanged';
  try {
    JSON.parse(replaced);
  } catch {
    return 'invalid';
  }
  const write = deps.writeFileSync ?? ((filePath: string, data: string) => fsWriteFileSync(filePath, data, 'utf-8'));
  const rename = deps.renameSync ?? fsRenameSync;
  const tmp = `${abs}.tmp-${process.pid}`;
  write(tmp, replaced);
  try {
    rename(tmp, abs);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* best effort */ }
    throw err;
  }
  return 'updated';
}

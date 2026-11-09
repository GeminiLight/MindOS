/**
 * Scan known MCP client config files and replace old port URLs with new ones.
 *
 * Extracted from main.ts.
 */
import path from 'path';
import { rewriteMcpClientConfigFile } from './mcp-config-rewrite';
import { DESKTOP_HOME } from './desktop-config';

/** Global MCP client config paths (project configs are repo-specific and left alone). */
export const MCP_CLIENT_CONFIG_PATHS = [
  '~/.claude.json',
  '~/.cursor/mcp.json',
  '~/.codeium/windsurf/mcp_config.json',
  '~/.trae/mcp.json',
  '~/.gemini/settings.json',
  '~/.openclaw/mcp.json',
  '~/.codebuddy/mcp.json',
  '~/.mindos/mcp.json',
] as const;

/**
 * Matches both `localhost:` and `127.0.0.1:` host forms and writes back the
 * 127.0.0.1 form (the MCP server binds IPv4-only — see mcp-config-rewrite.ts).
 * Safe for stdio configs (no url field → no change).
 */
export function updateMcpClientConfigs(oldPort: number, newPort: number): number {
  const resolve = (p: string) => (p.startsWith('~/') ? path.join(DESKTOP_HOME, p.slice(2)) : p);
  let updated = 0;
  for (const rel of MCP_CLIENT_CONFIG_PATHS) {
    const abs = resolve(rel);
    try {
      // Third-party files: validated as JSON and written via temp file + rename
      // so a crash mid-write can never leave the user's other tools with a
      // truncated config.
      const result = rewriteMcpClientConfigFile(abs, oldPort, newPort);
      if (result === 'invalid') {
        console.warn(`[MindOS] Skipped ${rel}: rewritten MCP config is not valid JSON, leaving file untouched`);
        continue;
      }
      if (result !== 'updated') continue;
      updated++;
      console.info(`[MindOS] Updated MCP port in ${rel}: ${oldPort} → ${newPort}`);
    } catch (err) {
      console.warn(`[MindOS] Failed to update ${rel}:`, err instanceof Error ? err.message : err);
    }
  }
  if (updated > 0) {
    console.info(`[MindOS] Updated ${updated} MCP client config(s)`);
  }
  return updated;
}

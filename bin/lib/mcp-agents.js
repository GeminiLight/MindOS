/**
 * Shared MCP agent definitions for CLI tools.
 * Mirrors app/lib/mcp-agents.ts — keep in sync manually.
 */

export const MCP_AGENTS = {
  'claude-code':    { name: 'Claude Code',    project: '.mcp.json',                       global: '~/.claude.json',                                                                         key: 'mcpServers' },
  'claude-desktop': { name: 'Claude Desktop', project: null,                               global: process.platform === 'darwin' ? '~/Library/Application Support/Claude/claude_desktop_config.json' : '~/.config/Claude/claude_desktop_config.json', key: 'mcpServers' },
  'cursor':         { name: 'Cursor',          project: '.cursor/mcp.json',                global: '~/.cursor/mcp.json',                                                                     key: 'mcpServers' },
  'windsurf':       { name: 'Windsurf',        project: null,                               global: '~/.codeium/windsurf/mcp_config.json',                                                   key: 'mcpServers' },
  'cline':          { name: 'Cline',           project: null,                               global: process.platform === 'darwin' ? '~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json' : '~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json', key: 'mcpServers' },
  'trae':           { name: 'Trae',            project: '.trae/mcp.json',                  global: '~/.trae/mcp.json',                                                                       key: 'mcpServers' },
  'gemini-cli':     { name: 'Gemini CLI',      project: '.gemini/settings.json',           global: '~/.gemini/settings.json',                                                                key: 'mcpServers' },
  'openclaw':       { name: 'OpenClaw',        project: null,                               global: '~/.openclaw/mcp.json',                                                                   key: 'mcpServers' },
  'codebuddy':      { name: 'CodeBuddy',       project: null,                               global: '~/.claude-internal/.claude.json',                                                        key: 'mcpServers' },
};

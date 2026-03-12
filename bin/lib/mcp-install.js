import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONFIG_PATH } from './constants.js';
import { bold, dim, cyan, green, red, yellow } from './colors.js';
import { expandHome } from './utils.js';

export const MCP_AGENTS = {
  'claude-code':     { name: 'Claude Code',     project: '.mcp.json',                       global: '~/.claude.json',                                                                         key: 'mcpServers' },
  'claude-desktop':  { name: 'Claude Desktop',  project: null,                               global: process.platform === 'darwin' ? '~/Library/Application Support/Claude/claude_desktop_config.json' : '~/.config/Claude/claude_desktop_config.json', key: 'mcpServers' },
  'cursor':          { name: 'Cursor',           project: '.cursor/mcp.json',                global: '~/.cursor/mcp.json',                                                                     key: 'mcpServers' },
  'windsurf':        { name: 'Windsurf',         project: null,                               global: '~/.codeium/windsurf/mcp_config.json',                                                   key: 'mcpServers' },
  'cline':           { name: 'Cline',            project: null,                               global: process.platform === 'darwin' ? '~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json' : '~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json', key: 'mcpServers' },
  'trae':            { name: 'Trae',             project: '.trae/mcp.json',                  global: '~/.trae/mcp.json',                                                                       key: 'mcpServers' },
  'gemini-cli':      { name: 'Gemini CLI',       project: '.gemini/settings.json',           global: '~/.gemini/settings.json',                                                                key: 'mcpServers' },
  'openclaw':        { name: 'OpenClaw',         project: null,                               global: '~/.openclaw/mcp.json',                                                                   key: 'mcpServers' },
  'codebuddy':       { name: 'CodeBuddy',        project: null,                               global: '~/.claude-internal/.claude.json',                                                        key: 'mcpServers' },
};

export async function mcpInstall() {
  // Support both `mindos mcp install [agent] [flags]` and `mindos mcp [flags]`
  const sub = process.argv[3];
  const startIdx = sub === 'install' ? 4 : 3;
  const args = process.argv.slice(startIdx);

  // parse flags
  const hasGlobalFlag    = args.includes('-g') || args.includes('--global');
  const hasYesFlag       = args.includes('-y') || args.includes('--yes');
  const transportIdx     = args.findIndex(a => a === '--transport');
  const urlIdx           = args.findIndex(a => a === '--url');
  const tokenIdx         = args.findIndex(a => a === '--token');
  const transportArg     = transportIdx >= 0 ? args[transportIdx + 1] : null;
  const urlArg           = urlIdx     >= 0 ? args[urlIdx + 1]     : null;
  const tokenArg         = tokenIdx   >= 0 ? args[tokenIdx + 1]   : null;

  // agent positional arg: first non-flag arg (not preceded by a flag expecting a value)
  const flagsWithValue = new Set(['--transport', '--url', '--token']);
  const agentArg = args.find((a, i) => !a.startsWith('-') && (i === 0 || !flagsWithValue.has(args[i - 1]))) ?? null;

  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(r => rl.question(q, r));
  const choose = async (prompt, options, { defaultIdx = 0, forcePrompt = false } = {}) => {
    if (hasYesFlag && !forcePrompt) return options[defaultIdx];
    console.log(`\n${bold(prompt)}\n`);
    options.forEach((o, i) => console.log(`  ${dim(`${i + 1}.`)} ${o.label} ${o.hint ? dim(`(${o.hint})`) : ''}`));
    const ans = await ask(`\n${bold(`Enter number`)} ${dim(`[${defaultIdx + 1}]:`)} `);
    const idx = ans.trim() === '' ? defaultIdx : parseInt(ans.trim(), 10) - 1;
    return options[idx >= 0 && idx < options.length ? idx : defaultIdx];
  };

  console.log(`\n${bold('🔌 MindOS MCP Install')}\n`);

  // ── 1. agent ────────────────────────────────────────────────────────────────
  let agentKey = agentArg;
  if (!agentKey) {
    const keys = Object.keys(MCP_AGENTS);
    const picked = await choose('Which Agent would you like to configure?',
      keys.map(k => ({ label: MCP_AGENTS[k].name, hint: k, value: k })), { forcePrompt: true });
    agentKey = picked.value;
  }

  const agent = MCP_AGENTS[agentKey];
  if (!agent) {
    rl.close();
    console.error(red(`\nUnknown agent: ${agentKey}`));
    console.error(dim(`Supported: ${Object.keys(MCP_AGENTS).join(', ')}`));
    process.exit(1);
  }

  // ── 2. scope (only ask if agent supports both) ───────────────────────────────
  let isGlobal = hasGlobalFlag;
  if (!hasGlobalFlag) {
    if (agent.project && agent.global) {
      const picked = await choose('Install scope?', [
        { label: 'Project',  hint: agent.project, value: 'project' },
        { label: 'Global',   hint: agent.global,  value: 'global'  },
      ]);
      isGlobal = picked.value === 'global';
    } else {
      isGlobal = !agent.project;
    }
  }

  const configPath = isGlobal ? agent.global : agent.project;
  if (!configPath) {
    rl.close();
    console.error(red(`${agent.name} does not support ${isGlobal ? 'global' : 'project'} scope.`));
    process.exit(1);
  }

  // ── 3. transport ─────────────────────────────────────────────────────────────
  let transport = transportArg;
  if (!transport) {
    const picked = await choose('Transport type?', [
      { label: 'stdio', hint: 'local, no server process needed (recommended)' },
      { label: 'http',  hint: 'URL-based, use when server is running separately or remotely' },
    ]);
    transport = picked.label;
  }

  // ── 4. url + token (only for http) ───────────────────────────────────────────
  let url = urlArg;
  let token = tokenArg;

  if (transport === 'http') {
    if (!url) {
      url = hasYesFlag ? 'http://localhost:8787/mcp' : (await ask(`${bold('MCP URL')} ${dim('[http://localhost:8787/mcp]:')} `)).trim() || 'http://localhost:8787/mcp';
    }

    if (!token) {
      try { token = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')).authToken || ''; } catch {}
      if (token) {
        console.log(dim(`  Using auth token from ~/.mindos/config.json`));
      } else if (!hasYesFlag) {
        token = (await ask(`${bold('Auth token')} ${dim('(leave blank to skip):')} `)).trim();
      } else {
        console.log(yellow(`  Warning: no auth token found in ~/.mindos/config.json — config will have no auth.`));
        console.log(dim(`  Run \`mindos onboard\` to set one, or pass --token <token>.`));
      }
    }
  }

  rl.close();

  // ── build entry ──────────────────────────────────────────────────────────────
  const entry = transport === 'stdio'
    ? { type: 'stdio', command: 'mindos', args: ['mcp'], env: { MCP_TRANSPORT: 'stdio' } }
    : token
      ? { url, headers: { Authorization: `Bearer ${token}` } }
      : { url };

  // ── read + merge existing config ─────────────────────────────────────────────
  const absPath = expandHome(configPath);
  let config = {};
  if (existsSync(absPath)) {
    try { config = JSON.parse(readFileSync(absPath, 'utf-8')); } catch {
      console.error(red(`\nFailed to parse existing config: ${absPath}`));
      process.exit(1);
    }
  }

  if (!config[agent.key]) config[agent.key] = {};
  const existed = !!config[agent.key].mindos;
  config[agent.key].mindos = entry;

  // ── preview + write ──────────────────────────────────────────────────────────
  console.log(`\n${bold('Preview:')} ${dim(absPath)}\n`);
  console.log(dim(JSON.stringify({ [agent.key]: { mindos: entry } }, null, 2)));

  const dir = resolve(absPath, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(absPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

  console.log(`\n${green('\u2714')} ${existed ? 'Updated' : 'Installed'} MindOS MCP for ${bold(agent.name)}`);
  console.log(dim(`  Config: ${absPath}\n`));
}

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

// ─── Interactive select (arrow keys) ──────────────────────────────────────────

/**
 * Single select with arrow keys.
 * ↑/↓ to move, Enter to confirm.
 */
async function interactiveSelect(title, options) {
  return new Promise((resolve) => {
    let cursor = 0;
    const { stdin, stdout } = process;

    function render() {
      // Move up to clear previous render (except first time)
      stdout.write(`\x1b[${options.length + 1}A\x1b[J`);
      draw();
    }

    function draw() {
      stdout.write(`${bold(title)}\n`);
      for (let i = 0; i < options.length; i++) {
        const o = options[i];
        const prefix = i === cursor ? cyan('❯') : ' ';
        const label = i === cursor ? cyan(o.label) : o.label;
        const hint = o.hint ? ` ${dim(`(${o.hint})`)}` : '';
        stdout.write(`  ${prefix} ${label}${hint}\n`);
      }
    }

    // Initial draw
    stdout.write('\n');
    draw();

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');

    function onKey(key) {
      if (key === '\x1b[A') { // up
        cursor = (cursor - 1 + options.length) % options.length;
        render();
      } else if (key === '\x1b[B') { // down
        cursor = (cursor + 1) % options.length;
        render();
      } else if (key === '\r' || key === '\n') { // enter
        cleanup();
        resolve(options[cursor]);
      } else if (key === '\x03') { // ctrl+c
        cleanup();
        process.exit(0);
      }
    }

    function cleanup() {
      stdin.removeListener('data', onKey);
      stdin.setRawMode(false);
      stdin.pause();
    }

    stdin.on('data', onKey);
  });
}

/**
 * Multi select with arrow keys.
 * ↑/↓ to move, Space to toggle, A to toggle all, Enter to confirm.
 */
async function interactiveMultiSelect(title, options) {
  return new Promise((resolve) => {
    let cursor = 0;
    const selected = new Set();
    const { stdin, stdout } = process;

    function render() {
      stdout.write(`\x1b[${options.length + 2}A\x1b[J`);
      draw();
    }

    function draw() {
      stdout.write(`${bold(title)}  ${dim('(↑↓ move, Space select, A all, Enter confirm)')}\n`);
      for (let i = 0; i < options.length; i++) {
        const o = options[i];
        const check = selected.has(i) ? green('✔') : dim('○');
        const pointer = i === cursor ? cyan('❯') : ' ';
        const label = i === cursor ? (selected.has(i) ? green(o.label) : cyan(o.label)) : (selected.has(i) ? green(o.label) : o.label);
        const hint = o.hint ? ` ${dim(`(${o.hint})`)}` : '';
        stdout.write(`  ${pointer} ${check} ${label}${hint}\n`);
      }
      const count = selected.size;
      stdout.write(dim(`  ${count} selected\n`));
    }

    stdout.write('\n');
    draw();

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');

    function onKey(key) {
      if (key === '\x1b[A') { // up
        cursor = (cursor - 1 + options.length) % options.length;
        render();
      } else if (key === '\x1b[B') { // down
        cursor = (cursor + 1) % options.length;
        render();
      } else if (key === ' ') { // space
        if (selected.has(cursor)) selected.delete(cursor);
        else selected.add(cursor);
        render();
      } else if (key === 'a' || key === 'A') { // toggle all
        if (selected.size === options.length) selected.clear();
        else options.forEach((_, i) => selected.add(i));
        render();
      } else if (key === '\r' || key === '\n') { // enter
        cleanup();
        const result = [...selected].sort().map(i => options[i]);
        resolve(result);
      } else if (key === '\x03') { // ctrl+c
        cleanup();
        process.exit(0);
      }
    }

    function cleanup() {
      stdin.removeListener('data', onKey);
      stdin.setRawMode(false);
      stdin.pause();
    }

    stdin.on('data', onKey);
  });
}

// ─── Main install flow ────────────────────────────────────────────────────────

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

  console.log(`\n${bold('🔌 MindOS MCP Install')}\n`);

  // ── 1. agent(s) ──────────────────────────────────────────────────────────────
  let agentKeys = agentArg ? [agentArg] : [];

  if (agentKeys.length === 0) {
    const keys = Object.keys(MCP_AGENTS);
    if (hasYesFlag) {
      // -y mode: install all
      agentKeys = keys;
    } else {
      rl.close(); // close readline so raw mode works
      const picked = await interactiveMultiSelect(
        'Which Agents to configure?',
        keys.map(k => ({ label: MCP_AGENTS[k].name, hint: k, value: k })),
      );
      if (picked.length === 0) {
        console.log(dim('\nNo agents selected. Exiting.\n'));
        process.exit(0);
      }
      agentKeys = picked.map(p => p.value);
    }
  }

  // Validate all keys first
  for (const key of agentKeys) {
    if (!MCP_AGENTS[key]) {
      console.error(red(`\nUnknown agent: ${key}`));
      console.error(dim(`Supported: ${Object.keys(MCP_AGENTS).join(', ')}`));
      process.exit(1);
    }
  }

  // ── 2. shared transport (ask once, apply to all) ───────────────────────────
  let transport = transportArg;
  if (!transport) {
    if (hasYesFlag) {
      transport = 'stdio';
    } else {
      const picked = await interactiveSelect('Transport type?', [
        { label: 'stdio', hint: 'local, no server process needed (recommended)' },
        { label: 'http',  hint: 'URL-based, use when server is running separately or remotely' },
      ]);
      transport = picked.label;
    }
  }

  // ── 3. url + token (only for http) ─────────────────────────────────────────
  let url = urlArg;
  let token = tokenArg;

  if (transport === 'http') {
    // Re-open readline for text input
    const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask2 = (q) => new Promise(r => rl2.question(q, r));

    if (!url) {
      let mcpPort = 8787;
      try { mcpPort = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')).mcpPort || 8787; } catch {}
      const defaultUrl = `http://localhost:${mcpPort}/mcp`;
      url = hasYesFlag ? defaultUrl : (await ask2(`${bold('MCP URL')} ${dim(`[${defaultUrl}]:`)} `)).trim() || defaultUrl;
    }

    if (!token) {
      try { token = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')).authToken || ''; } catch {}
      if (token) {
        console.log(dim(`  Using auth token from ~/.mindos/config.json`));
      } else if (!hasYesFlag) {
        token = (await ask2(`${bold('Auth token')} ${dim('(leave blank to skip):')} `)).trim();
      } else {
        console.log(yellow(`  Warning: no auth token found in ~/.mindos/config.json — config will have no auth.`));
        console.log(dim(`  Run \`mindos onboard\` to set one, or pass --token <token>.`));
      }
    }

    rl2.close();
  }

  // ── 4. build entry ─────────────────────────────────────────────────────────
  const entry = transport === 'stdio'
    ? { type: 'stdio', command: 'mindos', args: ['mcp'], env: { MCP_TRANSPORT: 'stdio' } }
    : token
      ? { url, headers: { Authorization: `Bearer ${token}` } }
      : { url };

  // ── 5. install for each selected agent ─────────────────────────────────────
  for (const agentKey of agentKeys) {
    const agent = MCP_AGENTS[agentKey];

    // scope
    let isGlobal = hasGlobalFlag;
    if (!hasGlobalFlag) {
      if (agent.project && agent.global) {
        if (hasYesFlag) {
          isGlobal = false; // default to project
        } else {
          const picked = await interactiveSelect(`[${agent.name}] Install scope?`, [
            { label: 'Project',  hint: agent.project, value: 'project' },
            { label: 'Global',   hint: agent.global,  value: 'global'  },
          ]);
          isGlobal = picked.value === 'global';
        }
      } else {
        isGlobal = !agent.project;
      }
    }

    const configPath = isGlobal ? agent.global : agent.project;
    if (!configPath) {
      console.error(red(`  ${agent.name} does not support ${isGlobal ? 'global' : 'project'} scope — skipping.`));
      continue;
    }

    // read + merge
    const absPath = expandHome(configPath);
    let config = {};
    if (existsSync(absPath)) {
      try { config = JSON.parse(readFileSync(absPath, 'utf-8')); } catch {
        console.error(red(`  Failed to parse existing config: ${absPath} — skipping.`));
        continue;
      }
    }

    if (!config[agent.key]) config[agent.key] = {};
    const existed = !!config[agent.key].mindos;
    config[agent.key].mindos = entry;

    // write
    const dir = resolve(absPath, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(absPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

    console.log(`${green('✔')} ${existed ? 'Updated' : 'Installed'} MindOS MCP for ${bold(agent.name)} ${dim(`→ ${absPath}`)}`);
  }

  console.log(`\n${green('Done!')} ${agentKeys.length} agent(s) configured.\n`);
}

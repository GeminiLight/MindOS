import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONFIG_PATH } from './constants.js';
import { bold, dim, cyan, green, red, yellow } from './colors.js';
import { expandHome } from './path-expand.js';
import { parseJsonc } from './jsonc.js';
import { MCP_AGENTS, detectAgentPresence } from './mcp-agents.js';
import { mergeTomlEntry } from './toml.js';
import { mergeYamlEntry } from './yaml.js';
import { EXIT } from './command.js';
import { getActiveSkillName } from './agent-readiness.js';
import { installMindosSkillsForAgents } from './skill-install.js';

/**
 * Walk a dot-separated path inside an object, creating intermediate {} as needed.
 * Returns the leaf object so the caller can set keys on it.
 * e.g. ensureNestedPath({}, 'mcp.clients') → creates obj.mcp.clients = {} and returns it.
 */
function ensureNestedPath(obj, dotPath) {
  const parts = dotPath.split('.').filter(Boolean);
  let current = obj;
  for (const part of parts) {
    if (!current[part] || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part];
  }
  return current;
}

/**
 * Read-only walk of a dot-separated path. Returns null if any segment is missing.
 */
function readNestedPath(obj, dotPath) {
  const parts = dotPath.split('.').filter(Boolean);
  let current = obj;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return null;
    current = current[part];
  }
  if (!current || typeof current !== 'object') return null;
  return current;
}

function configPathCandidates(agent, scope) {
  const primary = scope === 'global' ? agent.global : agent.project;
  const readAlso = scope === 'global' ? agent.globalReadAlso : agent.projectReadAlso;
  return [primary, ...(readAlso ?? [])].filter(Boolean);
}

export { MCP_AGENTS };

function buildMcpEntry(agent, transport, url, token) {
  if (agent.entryStyle === 'kilo') {
    if (transport === 'stdio') {
      return {
        type: 'local',
        command: ['mindos', 'mcp'],
        environment: { MCP_TRANSPORT: 'stdio' },
        enabled: true,
      };
    }
    return token
      ? { type: 'remote', url, headers: { Authorization: `Bearer ${token}` }, enabled: true }
      : { type: 'remote', url, enabled: true };
  }

  return transport === 'stdio'
    ? { type: 'stdio', command: 'mindos', args: ['mcp'], env: { MCP_TRANSPORT: 'stdio' } }
    : token
      ? { url, headers: { Authorization: `Bearer ${token}` } }
      : { url };
}

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
    const selected = new Set(options.map((o, i) => o.preselect ? i : -1).filter(i => i >= 0));
    const { stdin, stdout } = process;

    function render() {
      stdout.write(`\x1b[${options.length + 2}A\x1b[J`);
      draw();
    }

    function draw() {
      stdout.write(`${bold(title)}  ${dim('(↑↓ move, Space select, D detected, A all, Enter confirm)')}\n`);
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
      } else if (key === 'd' || key === 'D') { // select detected only
        selected.clear();
        options.forEach((o, i) => { if (o.preselect) selected.add(i); });
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

      // Build options with detected status and preselect
      const agentOptions = keys.map(k => {
        const agent = MCP_AGENTS[k];
        const present = detectAgentPresence(k);
        // Check if already configured
        let installed = false;
        for (const cfgPath of [
          ...configPathCandidates(agent, 'global'),
          ...configPathCandidates(agent, 'project'),
        ]) {
          const abs = expandHome(cfgPath);
          if (!existsSync(abs)) continue;
          try {
            const content = readFileSync(abs, 'utf-8');
            if (agent.format === 'toml') {
              // TOML: look for [section.mindos] header
              installed = content.includes(`[${agent.key}.mindos]`);
            } else if (agent.format === 'yaml') {
              // YAML: look for "  mindos:" under the section key
              const yamlPattern = new RegExp(`^\\s{2}mindos\\s*:`, 'm');
              installed = yamlPattern.test(content);
            } else {
              const config = parseJsonc(content);
              // For agents with globalNestedKey (e.g. CoPaw: mcp.clients),
              // check the nested path for mindos entry
              if (agent.globalNestedKey) {
                const nested = readNestedPath(config, agent.globalNestedKey);
                if (nested?.mindos) installed = true;
              } else {
                if (config[agent.key]?.mindos) installed = true;
              }
            }
            if (installed) break;
          } catch {}
        }
        const hint = installed ? 'configured' : present ? 'detected' : 'not found';
        return { label: agent.name, hint, value: k, preselect: installed || present };
      });

      // Sort: configured > detected > not found
      agentOptions.sort((a, b) => {
        const rank = (o) => o.hint === 'configured' ? 0 : o.preselect ? 1 : 2;
        return rank(a) - rank(b);
      });

      const picked = await interactiveMultiSelect(
        'Which Agents to configure?',
        agentOptions,
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
      let mcpPort = 8781;
      try { mcpPort = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')).mcpPort || 8781; } catch {}
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

  // ── 4. install for each selected agent ─────────────────────────────────────
  const configuredAgentKeys = [];
  const mcpFailures = [];

  for (const agentKey of agentKeys) {
    const agent = MCP_AGENTS[agentKey];
    const entry = buildMcpEntry(agent, transport, url, token);

    // scope — default to global
    let isGlobal = hasGlobalFlag;
    if (!hasGlobalFlag) {
      if (agent.project && agent.global) {
        if (hasYesFlag) {
          isGlobal = true; // default to global
        } else {
          const picked = await interactiveSelect(`[${agent.name}] Install scope?`, [
            { label: 'Global',   hint: agent.global,  value: 'global'  },
            { label: 'Project',  hint: agent.project, value: 'project' },
          ]);
          isGlobal = picked.value === 'global';
        }
      } else {
        isGlobal = !agent.project;
      }
    }

    const configPath = isGlobal ? agent.global : agent.project;
    if (!configPath) {
      const error = `${agent.name} does not support ${isGlobal ? 'global' : 'project'} scope`;
      console.error(red(`  ${error} — skipping.`));
      mcpFailures.push({ agentKey, name: agent.name, error });
      continue;
    }

    // read + merge — resolve to absolute path for cross-platform safety
    const absPath = resolve(expandHome(configPath));
    const dir = resolve(absPath, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    let existed = false;

    if (agent.format === 'toml') {
      // TOML format (e.g. Codex): line-based merge preserving existing content
      const existing = existsSync(absPath) ? readFileSync(absPath, 'utf-8') : '';
      existed = existing.includes(`[${agent.key}.mindos]`);
      const merged = mergeTomlEntry(existing, agent.key, 'mindos', entry);
      writeFileSync(absPath, merged, 'utf-8');
    } else if (agent.format === 'yaml') {
      // YAML format (e.g. Hermes): line-based merge preserving existing content
      const existing = existsSync(absPath) ? readFileSync(absPath, 'utf-8') : '';
      const yamlPattern = new RegExp(`^\\s{2}mindos\\s*:`, 'm');
      existed = yamlPattern.test(existing);
      const merged = mergeYamlEntry(existing, agent.key, 'mindos', entry);
      writeFileSync(absPath, merged, 'utf-8');
    } else {
      // JSON format (default)
      let config = {};
      if (existsSync(absPath)) {
        try { config = parseJsonc(readFileSync(absPath, 'utf-8')); } catch {
          const error = `Failed to parse existing config: ${absPath}`;
          console.error(red(`  ${error} — skipping.`));
          mcpFailures.push({ agentKey, name: agent.name, error });
          continue;
        }
      }

      // For global scope with nested key (e.g. CoPaw: mcp.clients),
      // write to the nested path instead of the flat key
      const useNestedKey = isGlobal && agent.globalNestedKey;
      const container = useNestedKey
        ? ensureNestedPath(config, agent.globalNestedKey)
        : (() => { if (!config[agent.key]) config[agent.key] = {}; return config[agent.key]; })();
      existed = !!container.mindos;
      container.mindos = entry;
      writeFileSync(absPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    }

    console.log(`${green('✔')} ${existed ? 'Updated' : 'Installed'} MindOS MCP for ${bold(agent.name)} ${dim(`→ ${absPath}`)}`);
    configuredAgentKeys.push(agentKey);
  }

  const activeSkill = getActiveSkillName();
  const skillSummary = installMindosSkillsForAgents(configuredAgentKeys, { skillName: activeSkill });
  const copiedCount = skillSummary.results.filter((result) => result.status === 'copied').length;
  const repairedCount = skillSummary.results.filter((result) => result.status === 'repaired').length;
  const existingCount = skillSummary.results.filter((result) => result.status === 'exists').length;

  if (configuredAgentKeys.length > 0) {
    if (skillSummary.ok) {
      const detail = [
        copiedCount ? `${copiedCount} copied` : null,
        repairedCount ? `${repairedCount} repaired` : null,
        existingCount ? `${existingCount} already installed` : null,
      ].filter(Boolean).join(', ');
      console.log(`${green('✔')} MindOS Skill (${activeSkill}) ready for ${bold(String(skillSummary.results.length))} agent(s)${detail ? dim(` — ${detail}`) : ''}`);
    } else {
      console.log(`${yellow('!')} MindOS Skill (${activeSkill}) could not be installed for every selected agent:`);
      for (const result of skillSummary.results.filter((item) => !['exists', 'copied', 'repaired'].includes(item.status))) {
        console.log(`  ${yellow('!')} ${result.name || result.agentKey}: ${result.error || result.status}`);
      }
      console.log(dim(`  Re-run after fixing permissions, then verify with: mindos doctor agents --json`));
    }
  }

  if (mcpFailures.length > 0) {
    console.log(`${yellow('!')} MindOS MCP could not be installed for every selected agent:`);
    for (const failure of mcpFailures) {
      console.log(`  ${yellow('!')} ${failure.name}: ${failure.error}`);
    }
  }

  console.log(`\n${green('Done!')} ${configuredAgentKeys.length}/${agentKeys.length} agent(s) configured.`);

  // Agents that require manual restart to pick up config changes
  const needsRestart = new Set(['cursor', 'windsurf', 'trae', 'cline', 'roo']);
  const restartAgents = agentKeys.filter(k => needsRestart.has(k)).map(k => MCP_AGENTS[k].name);
  if (restartAgents.length > 0) {
    console.log(`\n${yellow('Tip:')} ${restartAgents.join(', ')} must be restarted to load the new MCP config.`);
  }
  console.log();
  if (mcpFailures.length > 0 || !skillSummary.ok) process.exit(EXIT.ERROR);
}

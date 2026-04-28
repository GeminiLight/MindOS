import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { CONFIG_PATH, ROOT, WEB_APP_DIR } from './constants.js';
import { bold, dim, cyan, green, red, yellow } from './colors.js';
import { expandHome } from './path-expand.js';
import { parseJsonc } from './jsonc.js';
import { MCP_AGENTS, SKILL_AGENT_REGISTRY, detectAgentPresence } from './mcp-agents.js';
import { mergeTomlEntry } from './toml.js';
import { mergeYamlEntry } from './yaml.js';

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

/**
 * Recursively copy a directory using pure Node.js (cross-platform).
 * Uses cpSync on Node >=16.7, falls back to manual walk otherwise.
 */
function copyDirSync(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}

/**
 * Determine active skill variant based on user's locale setting.
 * Respects disabledSkills to detect if user prefers Chinese (mindos-zh).
 */
function getActiveSkillName() {
  try {
    const content = readFileSync(CONFIG_PATH, 'utf-8');
    const config = parseJsonc(content);
    // If 'mindos' is disabled, user prefers Chinese (mindos-zh)
    if (config.disabledSkills?.includes('mindos')) {
      return 'mindos-zh';
    }
  } catch {
    // Fall back to English if settings can't be read
  }
  return 'mindos';
}

/**
 * Auto-copy skill folder for agents with mode 'unsupported'.
 * Called after MCP config is written. Best-effort, never throws.
 * Respects user's locale setting (English mindos / Chinese mindos-zh).
 */
function autoInstallSkillForAgent(agentKey, skillName) {
  const reg = SKILL_AGENT_REGISTRY[agentKey];
  if (!reg || reg.mode !== 'unsupported') return null;

  const agent = MCP_AGENTS[agentKey];
  if (!agent) return null;

  // Resolve skill source: project skills/ or packages/web/data/skills/
  const candidates = [
    join(ROOT, 'skills', skillName),
    join(WEB_APP_DIR, 'data', 'skills', skillName),
  ];
  const skillSrc = candidates.find(p => existsSync(p));
  if (!skillSrc) return null;

  // Resolve target: agent's presenceDirs[0]/skills/<skillName>
  const agentRoot = (agent.presenceDirs ?? []).map(d => expandHome(d)).find(d => existsSync(d))
    || resolve(expandHome(agent.global), '..');
  const targetDir = join(agentRoot, 'skills', skillName);

  if (existsSync(targetDir)) return 'exists';

  try {
    copyDirSync(skillSrc, targetDir);
    return 'copied';
  } catch {
    return null;
  }
}

export { MCP_AGENTS };

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
        for (const cfgPath of [agent.global, agent.project]) {
          if (!cfgPath) continue;
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

  // ── 4. build entry ─────────────────────────────────────────────────────────
  const entry = transport === 'stdio'
    ? { type: 'stdio', command: 'mindos', args: ['mcp'], env: { MCP_TRANSPORT: 'stdio' } }
    : token
      ? { url, headers: { Authorization: `Bearer ${token}` } }
      : { url };

  // ── 5. install for each selected agent ─────────────────────────────────────
  for (const agentKey of agentKeys) {
    const agent = MCP_AGENTS[agentKey];

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
      console.error(red(`  ${agent.name} does not support ${isGlobal ? 'global' : 'project'} scope — skipping.`));
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
          console.error(red(`  Failed to parse existing config: ${absPath} — skipping.`));
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

    // Auto-copy skill for unsupported agents, respecting user's locale setting
    const activeSkill = getActiveSkillName();
    const skillResult = autoInstallSkillForAgent(agentKey, activeSkill);
    if (skillResult === 'copied') {
      console.log(`${green('✔')} Copied MindOS Skill (${activeSkill}) for ${bold(agent.name)}`);
    }
  }

  console.log(`\n${green('Done!')} ${agentKeys.length} agent(s) configured.`);

  // Agents that require manual restart to pick up config changes
  const needsRestart = new Set(['cursor', 'windsurf', 'trae', 'cline', 'roo-code']);
  const restartAgents = agentKeys.filter(k => needsRestart.has(k)).map(k => MCP_AGENTS[k].name);
  if (restartAgents.length > 0) {
    console.log(`\n${yellow('Tip:')} ${restartAgents.join(', ')} must be restarted to load the new MCP config.`);
  }
  console.log();
}

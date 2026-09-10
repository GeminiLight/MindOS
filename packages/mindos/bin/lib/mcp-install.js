/**
 * `mindos mcp install` — interactive connect flow.
 *
 * Orchestration only: entry building, config writes and the per-agent skill
 * copy run through `installAgentConnection` from the generated agent-config
 * bundle — the same install transaction `POST /api/mcp/install` uses, so one
 * agent is either fully connected (MCP entry + MindOS skill) or rolled back.
 * Previously this file wrote every MCP config first and batch-copied skills
 * afterwards (two-phase, no rollback).
 */
import { readFileSync } from 'node:fs';

import { loadAgentConfigBundle } from './agent-config.js';
import { bold, dim, cyan, green, red, yellow } from './colors.js';
import { CONFIG_PATH } from './constants.js';
import { EXIT } from './command.js';
import { MCP_AGENTS, SKILL_AGENT_REGISTRY, detectAgentPresence } from './mcp-agents.js';
import { getActiveSkillName } from './agent-readiness.js';
import { findSkillSourceRoot, installMindosSkillsForAgents } from './skill-install.js';

const {
  buildMindosMcpServerEntry,
  createAgentConfigAdapter,
  defaultMindosMcpUrl,
  installAgentConnection,
  setJsoncValue,
  writeFileAtomically,
} = await loadAgentConfigBundle();

export { writeFileAtomically, MCP_AGENTS };

/**
 * Insert `entry` under `path` (array of keys) editing the existing JSON/JSONC
 * text in place so user comments and formatting survive, then write
 * atomically. Kept as an export: `tests/unit/cli-mcp-install-atomic.test.ts`
 * pins this contract.
 */
export function writeJsonServerEntry(absPath, existingText, path, entry) {
  writeFileAtomically(absPath, setJsoncValue(existingText, path, entry));
}

/** Adapters resolve relative project configs against the CLI's cwd (historical `mindos mcp install` behaviour). */
function adapterFor(agentKey) {
  return createAgentConfigAdapter(agentKey, MCP_AGENTS[agentKey], SKILL_AGENT_REGISTRY[agentKey], { projectRoot: process.cwd() });
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

  console.log(`\n${bold('🔌 MindOS MCP Install')}\n`);

  // ── 1. agent(s) ──────────────────────────────────────────────────────────────
  let agentKeys = agentArg ? [agentArg] : [];

  if (agentKeys.length === 0) {
    const keys = Object.keys(MCP_AGENTS);
    if (hasYesFlag) {
      // -y mode: install all
      agentKeys = keys;
    } else {
      // Build options with detected status and preselect
      const agentOptions = keys.map(k => {
        const agent = MCP_AGENTS[k];
        const present = detectAgentPresence(k);
        // Already configured? The adapter reads every readable config
        // (global + project candidates, all formats) like the server does.
        let installed = false;
        try {
          installed = !!adapterFor(k).readServer('mindos');
        } catch { /* unreadable config = not configured */ }
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
  let mcpPort = 8781;

  if (transport === 'http') {
    // Re-open readline for text input
    const readline = await import('node:readline');
    const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask2 = (q) => new Promise(r => rl2.question(q, r));

    if (!url) {
      try { mcpPort = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')).mcpPort || 8781; } catch {}
      // 127.0.0.1 (not localhost): the MCP server binds IPv4 and some Windows
      // stacks resolve localhost to ::1 first — defaultMindosMcpUrl is the
      // single source shared with the product server.
      const defaultUrl = defaultMindosMcpUrl(mcpPort);
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

  // ── 4. install for each selected agent (MCP entry + skill, one transaction) ─
  const activeSkill = getActiveSkillName();
  const sourceRoot = findSkillSourceRoot(activeSkill);
  const configuredAgentKeys = [];
  const skillResults = [];
  const mcpFailures = [];

  for (const agentKey of agentKeys) {
    const agent = MCP_AGENTS[agentKey];
    const adapter = adapterFor(agentKey);

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

    const scope = isGlobal ? 'global' : 'project';
    if (!adapter.hasScope(scope)) {
      const error = `${agent.name} does not support ${scope} scope`;
      console.error(red(`  ${error} — skipping.`));
      mcpFailures.push({ agentKey, name: agent.name, error });
      continue;
    }

    const entry = buildMindosMcpServerEntry(agent, transport, { url, token, fallbackPort: mcpPort });
    const outcome = installAgentConnection({
      adapter,
      scope,
      entry,
      ...(sourceRoot
        ? {
          skill: {
            name: activeSkill,
            sourceRoots: [{ path: sourceRoot, source: 'builtin', origin: 'project-builtin', editable: false }],
            deps: { strategy: 'copy' },
          },
        }
        : {}),
    });

    if (!outcome.ok || !outcome.config) {
      const error = outcome.message ?? 'Install failed';
      console.error(red(`  ${agent.name}: ${error}${outcome.rolledBack ? ' (rolled back)' : ''} — skipping.`));
      mcpFailures.push({ agentKey, name: agent.name, error });
      continue;
    }

    for (const warning of outcome.warnings) console.log(yellow(`  ! ${warning}`));
    console.log(`${green('✔')} ${outcome.config.existed ? 'Updated' : 'Installed'} MindOS MCP for ${bold(agent.name)} ${dim(`→ ${outcome.config.absPath}`)}`);
    configuredAgentKeys.push(agentKey);
    if (outcome.skill.status !== 'skipped') {
      skillResults.push({
        agentKey,
        name: agent.name,
        status: outcome.skill.status,
        workspacePath: outcome.skill.workspacePath,
        skillPath: outcome.skill.skillPath,
        ...(outcome.skill.status === 'failed' ? { error: outcome.skill.message } : {}),
      });
    }
  }

  let skillSummary;
  if (configuredAgentKeys.length === 0) {
    skillSummary = { ok: true, skillName: activeSkill, sourceRoot, results: [] };
  } else if (sourceRoot) {
    // Skills were installed inside each agent's transaction above.
    skillSummary = {
      ok: skillResults.every((result) => ['exists', 'copied', 'repaired'].includes(result.status)),
      skillName: activeSkill,
      sourceRoot,
      results: skillResults,
    };
  } else {
    // No packaged skill found: report the miss exactly like the standalone path.
    skillSummary = installMindosSkillsForAgents(configuredAgentKeys, { skillName: activeSkill });
  }

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

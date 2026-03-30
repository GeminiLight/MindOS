/**
 * Lightweight command registry — zero dependencies.
 *
 * Each command exports: { meta, run }
 *   meta.name        — primary name
 *   meta.aliases     — optional alias names
 *   meta.group       — help group (Core, Knowledge, MCP, Sync, Gateway, Config)
 *   meta.summary     — one-line description
 *   meta.usage       — usage string (optional)
 *   meta.flags       — { flag: description } (optional)
 *   run(args, flags) — async handler
 */

import { bold, dim, cyan, green, red } from './colors.js';
import { ROOT } from './constants.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** @type {Map<string, { meta: object, run: function }>} */
const registry = new Map();

/** @type {Map<string, string>} alias → primary name */
const aliases = new Map();

export function register(command) {
  const { meta, run } = command;
  registry.set(meta.name, { meta, run });
  if (meta.aliases) {
    for (const alias of meta.aliases) {
      aliases.set(alias, meta.name);
    }
  }
}

export function resolve_command(name) {
  if (registry.has(name)) return registry.get(name);
  const primary = aliases.get(name);
  if (primary) return registry.get(primary);
  return null;
}

export function getAllCommands() {
  return [...registry.values()];
}

/** Parse process.argv into { command, args, flags } */
export function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  const args = [];
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      // Check if next arg is a value (not a flag)
      if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        flags[key] = argv[i + 1];
        i += 2;
      } else {
        flags[key] = true;
        i++;
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      flags[arg.slice(1)] = true;
      i++;
    } else {
      args.push(arg);
      i++;
    }
  }

  return { command: args[0] || null, args: args.slice(1), flags };
}

/** Check if --json flag is set */
export function isJsonMode(flags) {
  return flags.json === true;
}

/** Output helper: human-readable or JSON */
export function output(data, flags) {
  if (isJsonMode(flags)) {
    console.log(JSON.stringify(data, null, 2));
  } else if (typeof data === 'string') {
    console.log(data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

/** Print global help */
export function printHelp() {
  const pkgVersion = (() => {
    try {
      return JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')).version;
    } catch { return '?'; }
  })();

  const row = (c, d) => `  ${cyan(c.padEnd(38))}${dim(d)}`;

  const groups = {};
  for (const { meta } of registry.values()) {
    const group = meta.group || 'Other';
    if (!groups[group]) groups[group] = [];
    const usage = meta.usage || `mindos ${meta.name}`;
    groups[group].push(row(usage, meta.summary));
  }

  const sections = [];
  const groupOrder = ['Core', 'Knowledge', 'MCP', 'Sync', 'Gateway', 'Config'];
  for (const g of groupOrder) {
    if (groups[g]) {
      sections.push(`${bold(`${g}:`)}\n${groups[g].join('\n')}`);
    }
  }
  // Any remaining groups
  for (const [g, items] of Object.entries(groups)) {
    if (!groupOrder.includes(g)) {
      sections.push(`${bold(`${g}:`)}\n${items.join('\n')}`);
    }
  }

  console.log(`
${bold('MindOS CLI')} ${dim(`v${pkgVersion}`)}

${sections.join('\n\n')}

${bold('Global Flags:')}
  ${cyan('--json'.padEnd(38))}${dim('Output in JSON format (for agents)')}
  ${cyan('--help, -h'.padEnd(38))}${dim('Show help')}
  ${cyan('--version, -v'.padEnd(38))}${dim('Show version')}
`);
}

/** Print command-specific help */
export function printCommandHelp(cmd) {
  const { meta } = cmd;
  const usage = meta.usage || `mindos ${meta.name}`;
  console.log(`\n${bold(usage)}\n`);
  console.log(`  ${meta.summary}\n`);
  if (meta.flags) {
    console.log(`${bold('Flags:')}`);
    for (const [flag, desc] of Object.entries(meta.flags)) {
      console.log(`  ${cyan(flag.padEnd(30))}${dim(desc)}`);
    }
    console.log();
  }
  if (meta.examples) {
    console.log(`${bold('Examples:')}`);
    for (const ex of meta.examples) {
      console.log(`  ${dim(ex)}`);
    }
    console.log();
  }
}

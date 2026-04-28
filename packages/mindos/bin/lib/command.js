/**
 * Lightweight CLI utilities — zero dependencies beyond lib/.
 *
 * Exports used by cli.js and bin/commands/*.js:
 *   parseArgs(argv)          — parse process.argv into { command, args, flags }
 *   printCommandHelp(cmd)    — auto-generate --help output from cmd.meta
 *   output(data, flags)      — print human-readable or JSON
 *   isJsonMode(flags)        — check --json flag
 *   EXIT                     — standardized exit codes
 */

import { bold, dim, cyan } from './colors.js';

// ── Exit codes ────────────────────────────────────────────────────────────────
export const EXIT = {
  OK:        0,
  ERROR:     1,
  ARGS:      2,
  CONNECT:   3,
  NOT_FOUND: 4,
};

// ── Arg parsing ───────────────────────────────────────────────────────────────

/** Parse process.argv into { command, args, flags } */
function looksLikeFlag(s) {
  if (!s || s.length < 2) return false;
  if (s.startsWith('--')) return true;
  return s.length === 2 && s[0] === '-' && /[a-zA-Z]/.test(s[1]);
}

export function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  const args = [];
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (i + 1 < argv.length && !looksLikeFlag(argv[i + 1])) {
        flags[key] = argv[i + 1];
        i += 2;
      } else {
        flags[key] = true;
        i++;
      }
    } else if (arg.startsWith('-') && arg.length === 2 && /[a-zA-Z]/.test(arg[1])) {
      const key = arg.slice(1);
      if (i + 1 < argv.length && !looksLikeFlag(argv[i + 1])) {
        flags[key] = argv[i + 1];
        i += 2;
      } else {
        flags[key] = true;
        i++;
      }
    } else {
      args.push(arg);
      i++;
    }
  }

  return { command: args[0] || null, args: args.slice(1), flags };
}

// ── Output helpers ────────────────────────────────────────────────────────────

export function isJsonMode(flags) {
  return flags.json === true;
}

export function output(data, flags) {
  if (isJsonMode(flags)) {
    console.log(JSON.stringify(data, null, 2));
  } else if (typeof data === 'string') {
    console.log(data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

// ── Command-specific help (auto-generated from meta) ──────────────────────────

export function printCommandHelp(cmd) {
  const { meta } = cmd;
  const usage = meta.usage || `mindos ${meta.name}`;
  console.log(`\n${bold('USAGE')}`);
  console.log(`  ${cyan(usage)}\n`);
  console.log(`  ${meta.summary}\n`);
  if (meta.aliases && meta.aliases.length > 0) {
    console.log(`${bold('Aliases:')} ${meta.aliases.join(', ')}\n`);
  }
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

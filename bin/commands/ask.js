/**
 * mindos ask — AI Chat: interactive REPL (default) or one-shot (-p)
 *
 * Uses 'chat' mode: read-only tools, lower step cap, smaller prompt.
 * For full agent mode with tool execution, use `mindos agent`.
 */

import { bold, dim, cyan, red } from '../lib/colors.js';
import { loadConfig } from '../lib/config.js';
import { isJsonMode, EXIT } from '../lib/command.js';
import { startRepl } from '../lib/repl.js';
import { executeOneShot } from '../lib/one-shot.js';

export const meta = {
  name: 'ask',
  group: 'AI',
  summary: 'Chat with your knowledge base (read-only)',
  usage: 'mindos ask [-p "<question>"]',
  flags: {
    '-p, --print': 'Non-interactive: answer and exit',
    '--file <path>': 'Attach a file as context',
    '--json': 'Output as JSON (implies -p)',
    '--port <port>': 'MindOS web port (default: 3456)',
  },
  examples: [
    'mindos ask                       # interactive chat',
    'mindos ask -p "What is RAG?"',
    'mindos ask "Summarize my notes"   # also one-shot',
  ],
};

export async function run(args, flags) {
  const isPrintMode = flags.p || flags.print || isJsonMode(flags) || (args.length > 0);

  if (isPrintMode) {
    const question = args.join(' ');
    if (!question) {
      console.error(red('No question provided. Usage: mindos ask -p "<question>"'));
      process.exit(EXIT.ARGS);
    }
    return askExecute(question, flags);
  }

  // Interactive REPL (default)
  return askInteractive(flags);
}

// ---------------------------------------------------------------------------
// Interactive REPL
// ---------------------------------------------------------------------------

async function askInteractive(flags) {
  loadConfig();
  const port = flags.port || process.env.MINDOS_WEB_PORT || '3456';
  const token = process.env.MINDOS_AUTH_TOKEN || '';
  const baseUrl = `http://localhost:${port}`;

  await startRepl({
    baseUrl,
    token,
    mode: 'chat',
    prompt: 'chat> ',
    welcome: bold('MindOS Chat') + dim(' (interactive) — read-only knowledge access'),
    showTools: false,
    attachedFiles: flags.file ? [flags.file] : undefined,
  });
}

// ---------------------------------------------------------------------------
// Print Mode — One-shot Q&A
// ---------------------------------------------------------------------------

async function askExecute(question, flags) {
  loadConfig();
  const port = flags.port || process.env.MINDOS_WEB_PORT || '3456';
  const token = process.env.MINDOS_AUTH_TOKEN || '';

  await executeOneShot({
    baseUrl: `http://localhost:${port}`,
    token,
    message: question,
    mode: 'chat',
    attachedFiles: flags.file ? [flags.file] : undefined,
    json: isJsonMode(flags),
  });
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

export function printHelp() {
  console.log(`
${bold('mindos ask')} — Chat with your knowledge base (read-only)

${bold('Interactive (default):')}
  ${cyan('mindos ask')}                          Enter multi-turn chat
  ${dim('Commands inside REPL: /clear, /exit')}

${bold('Non-interactive (-p):')}
  ${cyan('mindos ask -p "<question>"')}           Answer and exit
  ${cyan('mindos ask "<question>"')}              Same (shorthand)

${bold('Options:')}
  ${dim('-p, --print')}          Non-interactive mode
  ${dim('--file <path>')}        Attach file as context
  ${dim('--json')}               JSON output (implies -p)

${bold('Note:')} Chat mode uses read-only tools for knowledge access.
  For full agent mode with write tools, use ${cyan('mindos agent')}.
`);
}

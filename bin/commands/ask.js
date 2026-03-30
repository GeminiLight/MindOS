/**
 * mindos ask — AI question answering via local MindOS API
 */

import { bold, dim, cyan, green, red } from '../lib/colors.js';
import { loadConfig } from '../lib/config.js';
import { output, isJsonMode } from '../lib/command.js';

export const meta = {
  name: 'ask',
  group: 'Knowledge',
  summary: 'Ask AI a question using your knowledge base',
  usage: 'mindos ask "<question>"',
  flags: {
    '--json': 'Output as JSON',
    '--port <port>': 'MindOS web port (default: 3456)',
  },
  examples: [
    'mindos ask "Summarize my meeting notes from today"',
    'mindos ask "What are the key points in my RAG research?"',
    'mindos ask "List all TODOs across my notes" --json',
  ],
};

export async function run(args, flags) {
  const question = args.join(' ');

  if (!question || flags.help || flags.h) {
    console.log(`
${bold('mindos ask')} — Ask AI using your knowledge base

${bold('Usage:')}
  ${cyan('mindos ask "<question>"')}

${bold('Examples:')}
  ${dim('mindos ask "Summarize my meeting notes"')}
  ${dim('mindos ask "What are the key insights from my research?" --json')}

${bold('Note:')} MindOS must be running (mindos start).
`);
    return;
  }

  loadConfig();
  const port = flags.port || process.env.MINDOS_WEB_PORT || '3456';
  const token = process.env.MINDOS_AUTH_TOKEN || '';
  const baseUrl = `http://localhost:${port}`;

  // Check if MindOS is running
  try {
    const healthRes = await fetch(`${baseUrl}/api/health`);
    if (!healthRes.ok) throw new Error();
  } catch {
    console.error(red('MindOS is not running. Start it with: mindos start'));
    process.exit(1);
  }

  if (!isJsonMode(flags)) {
    process.stdout.write(dim('Thinking...'));
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${baseUrl}/api/ask`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ question }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`API error (${res.status}): ${errText}`);
    }

    const data = await res.json();

    if (isJsonMode(flags)) {
      output(data, flags);
      return;
    }

    // Clear "Thinking..." line
    process.stdout.write('\r' + ' '.repeat(40) + '\r');

    if (data.answer) {
      console.log(data.answer);
    } else if (data.text) {
      console.log(data.text);
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } catch (err) {
    if (!isJsonMode(flags)) {
      process.stdout.write('\r' + ' '.repeat(40) + '\r');
    }
    console.error(red(err.message));
    process.exit(1);
  }
}

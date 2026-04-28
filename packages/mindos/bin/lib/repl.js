/**
 * Interactive REPL for CLI agent/chat sessions.
 *
 * Provides a multi-turn conversation loop with SSE streaming.
 * Shared between `mindos agent` and `mindos ask` commands.
 */

import * as readline from 'node:readline';
import { bold, dim, cyan, red } from './colors.js';
import { streamSSE, postAsk, checkHealth } from './sse-stream.js';
import { EXIT } from './command.js';

/**
 * @param {object} opts
 * @param {string} opts.baseUrl - e.g. http://localhost:3456
 * @param {string} opts.token - auth token
 * @param {'agent'|'chat'} opts.mode
 * @param {string} opts.prompt - readline prompt string (e.g. "agent> ")
 * @param {string} opts.welcome - welcome message shown on start
 * @param {boolean} opts.showTools - show tool calls in output
 * @param {string[]} [opts.attachedFiles] - initial file attachments
 * @param {number} [opts.maxSteps] - max agent steps per turn
 */
export async function startRepl(opts) {
  const {
    baseUrl, token, mode, prompt, welcome,
    showTools = true,
    attachedFiles,
    maxSteps,
  } = opts;

  const healthy = await checkHealth(baseUrl);
  if (!healthy) {
    console.error(red('\n  MindOS is not running. Start it with: mindos start\n'));
    process.exit(EXIT.CONNECT);
  }

  console.log(`\n  ${welcome}`);
  console.log(`  ${dim('Type "exit" or press Ctrl+C to quit.')}\n`);

  const messages = [];
  let busy = false;
  let exiting = false;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: cyan(prompt),
    terminal: true,
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    if (input === 'exit' || input === 'quit' || input === '/exit' || input === '/quit') {
      exitGracefully();
      return;
    }

    if (input === '/clear') {
      messages.length = 0;
      console.log(dim('  Conversation cleared.\n'));
      rl.prompt();
      return;
    }

    // Prevent concurrent requests — queue is dropped, user gets feedback
    if (busy) {
      console.log(dim('  Still processing previous message. Please wait.\n'));
      return;
    }

    busy = true;
    messages.push({ role: 'user', content: input, timestamp: Date.now() });

    // Keep last 40 messages to prevent unbounded payload growth
    const MAX_CONTEXT = 40;
    const contextMessages = messages.length > MAX_CONTEXT
      ? messages.slice(-MAX_CONTEXT)
      : [...messages];

    const body = { messages: contextMessages, mode };
    if (attachedFiles) body.attachedFiles = attachedFiles;
    if (maxSteps) body.maxSteps = maxSteps;

    process.stdout.write('\n');

    try {
      const res = await postAsk(baseUrl, body, token);

      if (!res.ok) {
        const errText = await res.text();
        console.error(red(`  API error (${res.status}): ${errText}\n`));
        messages.pop();
        busy = false;
        rl.prompt();
        return;
      }

      const contentType = res.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream')) {
        const result = await streamSSE(res, { showTools, json: false });

        if (result.error) {
          console.error(red('  Error in this turn. You can retry.\n'));
          messages.pop();
          busy = false;
          rl.prompt();
          return;
        }

        if (result.text) {
          messages.push({
            role: 'assistant',
            content: result.text,
            timestamp: Date.now(),
          });
        }
      } else {
        const data = await res.json();
        const answer = data.answer || data.text || JSON.stringify(data, null, 2);
        console.log(answer);

        messages.push({
          role: 'assistant',
          content: answer,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      console.error(red(`  ${err.message}\n`));
      messages.pop();
    }

    busy = false;
    console.log();
    rl.prompt();
  });

  rl.on('close', () => {
    exitGracefully();
  });

  rl.on('SIGINT', () => {
    console.log(dim('\n  (Press Ctrl+C again or type "exit" to quit)'));
    rl.once('SIGINT', () => {
      exitGracefully();
    });
    rl.prompt();
  });

  function exitGracefully() {
    if (exiting) return;
    exiting = true;
    console.log(dim('\n  Goodbye.\n'));
    rl.close();
    process.exit(0);
  }
}

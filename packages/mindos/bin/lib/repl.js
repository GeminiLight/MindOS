/**
 * Interactive REPL for CLI agent sessions.
 *
 * Provides a multi-turn conversation loop with SSE streaming.
 * Shared by `mindos agent` and the deprecated `mindos ask` alias.
 */

import * as readline from 'node:readline';
import { bold, dim, cyan, red } from './colors.js';
import { streamSSE, postAgentTurn, checkHealth } from './sse-stream.js';
import { EXIT } from './command.js';

/**
 * @param {object} opts
 * @param {string} opts.baseUrl - e.g. http://localhost:3456
 * @param {string} opts.token - auth token
 * @param {'default'|'plan'|'goal'} [opts.agentMode]
 * @param {'read'|'ask'|'auto'|'full'} [opts.permissionMode]
 * @param {string} opts.prompt - readline prompt string (e.g. "agent> ")
 * @param {string} opts.welcome - welcome message shown on start
 * @param {boolean} opts.showTools - show tool calls in output
 * @param {string[]} [opts.attachedFiles] - initial file attachments
 * @param {number} [opts.maxSteps] - max agent steps per turn
 * @param {string} [opts.providerOverride] - AI provider override
 * @param {string} [opts.modelOverride] - model override
 * @param {object} [opts.runtimeOptions] - runtime-specific request options
 * @param {object} [opts.agentOptions] - MindOS agent request options
 * @param {object} [opts.workDir] - request-scoped working directory
 */
export async function startRepl(opts) {
  const {
    baseUrl, token, prompt, welcome,
    agentMode = 'default',
    permissionMode,
    showTools = true,
    attachedFiles,
    maxSteps,
    providerOverride,
    modelOverride,
    runtimeOptions,
    agentOptions,
    workDir,
  } = opts;

  const healthy = await checkHealth(baseUrl);
  if (!healthy) {
    console.error(red('\n  MindOS is not running. Start it with: mindos start\n'));
    process.exit(EXIT.CONNECT);
  }

  console.log(`\n  ${welcome}`);
  console.log(`  ${dim('Type "exit" or press Ctrl+C to quit.')}\n`);

  const messages = [];
  const sessionId = `cli-repl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

    const body = { messages: contextMessages, agentMode };
    if (permissionMode) body.permissionMode = permissionMode;
    if (attachedFiles) body.attachedFiles = attachedFiles;
    if (maxSteps) body.maxSteps = maxSteps;
    if (providerOverride) body.providerOverride = providerOverride;
    if (modelOverride) body.modelOverride = modelOverride;
    if (runtimeOptions) body.runtimeOptions = runtimeOptions;
    if (agentOptions) body.agentOptions = agentOptions;
    if (workDir) body.workDir = workDir;

    process.stdout.write('\n');

    try {
      const res = await postAgentTurn(baseUrl, sessionId, body, token);

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

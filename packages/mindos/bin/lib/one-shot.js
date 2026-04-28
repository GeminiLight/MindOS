/**
 * One-shot (non-interactive) execution for CLI agent/chat commands.
 *
 * Counterpart to lib/repl.js (interactive mode).
 * Shared between `mindos agent -p` and `mindos ask -p`.
 */

import { dim, red } from './colors.js';
import { streamSSE, postAsk, checkHealth } from './sse-stream.js';
import { EXIT } from './command.js';

/**
 * Execute a single AI request, stream the response, and exit.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl - e.g. http://localhost:3456
 * @param {string} opts.token - auth token
 * @param {string} opts.message - user message / task
 * @param {'agent'|'chat'} opts.mode
 * @param {boolean} [opts.showTools=false] - show tool calls in output
 * @param {number} [opts.maxSteps] - max agent steps
 * @param {string[]} [opts.attachedFiles] - file attachments
 * @param {boolean} [opts.json=false] - output as JSON
 */
export async function executeOneShot(opts) {
  const {
    baseUrl, token, message, mode,
    showTools = false,
    maxSteps,
    attachedFiles,
    json = false,
  } = opts;

  const healthy = await checkHealth(baseUrl);
  if (!healthy) {
    console.error(red('MindOS is not running. Start it with: mindos start'));
    process.exit(EXIT.CONNECT);
  }

  if (!json) {
    process.stdout.write(dim('Thinking...'));
  }

  const body = {
    messages: [{ role: 'user', content: message, timestamp: Date.now() }],
    mode,
  };
  if (attachedFiles) body.attachedFiles = attachedFiles;
  if (maxSteps) body.maxSteps = maxSteps;

  try {
    const res = await postAsk(baseUrl, body, token);

    if (!res.ok) {
      const errText = await res.text();
      if (!json) process.stdout.write('\r\x1b[K');
      console.error(red(`API error (${res.status}): ${errText}`));
      process.exit(EXIT.ERROR);
    }

    const contentType = res.headers.get('content-type') || '';

    if (contentType.includes('text/event-stream')) {
      const result = await streamSSE(res, { showTools, json });

      if (json) {
        const out = { answer: result.text, error: result.error || undefined };
        if (showTools) out.toolCalls = result.toolCalls;
        console.log(JSON.stringify(out, null, 2));
      }

      if (result.error) process.exit(EXIT.ERROR);
    } else {
      const data = await res.json();
      if (!json) process.stdout.write('\r\x1b[K');

      if (json) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log(data.answer || data.text || JSON.stringify(data, null, 2));
      }
    }
  } catch (err) {
    if (!json) process.stdout.write('\r\x1b[K');
    console.error(red(err.message));
    process.exit(EXIT.ERROR);
  }
}

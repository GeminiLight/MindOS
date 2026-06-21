/**
 * One-shot (non-interactive) execution for CLI agent commands.
 *
 * Counterpart to lib/repl.js (interactive mode).
 * Shared by `mindos agent -p` and the deprecated `mindos ask` alias.
 */

import { dim, red } from './colors.js';
import { streamSSE, postAgentTurn, checkHealth } from './sse-stream.js';
import { EXIT } from './command.js';

/**
 * Execute a single AI request, stream the response, and exit.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl - e.g. http://localhost:3456
 * @param {string} opts.token - auth token
 * @param {string} opts.message - user message / task
 * @param {'default'|'plan'|'goal'} [opts.agentMode]
 * @param {'read'|'ask'|'auto'|'full'} [opts.permissionMode]
 * @param {boolean} [opts.showTools=false] - show tool calls in output
 * @param {number} [opts.maxSteps] - max agent steps
 * @param {string[]} [opts.attachedFiles] - file attachments
 * @param {string} [opts.providerOverride] - AI provider override
 * @param {string} [opts.modelOverride] - model override
 * @param {object} [opts.runtimeOptions] - runtime-specific request options
 * @param {object} [opts.agentOptions] - MindOS agent request options
 * @param {object} [opts.workDir] - request-scoped working directory
 * @param {boolean} [opts.json=false] - output as JSON
 */
export async function executeOneShot(opts) {
  const {
    baseUrl, token, message,
    agentMode = 'default',
    permissionMode,
    showTools = false,
    maxSteps,
    attachedFiles,
    providerOverride,
    modelOverride,
    runtimeOptions,
    agentOptions,
    workDir,
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
    agentMode,
  };
  if (permissionMode) body.permissionMode = permissionMode;
  if (attachedFiles) body.attachedFiles = attachedFiles;
  if (maxSteps) body.maxSteps = maxSteps;
  if (providerOverride) body.providerOverride = providerOverride;
  if (modelOverride) body.modelOverride = modelOverride;
  if (runtimeOptions) body.runtimeOptions = runtimeOptions;
  if (agentOptions) body.agentOptions = agentOptions;
  if (workDir) body.workDir = workDir;

  try {
    const sessionId = `cli-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const res = await postAgentTurn(baseUrl, sessionId, body, token);

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

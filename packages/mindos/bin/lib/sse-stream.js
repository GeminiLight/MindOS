/**
 * SSE streaming client for CLI → /api/agent/sessions/:sessionId/turns
 *
 * Handles the text/event-stream protocol emitted by the MindOS Agent API.
 * Supports text_delta, thinking_delta, tool_start, tool_end, done, error, status events.
 */

import { dim, cyan, red } from './colors.js';

function stringField(event, primary, fallback) {
  if (typeof event[primary] === 'string') return event[primary];
  if (typeof event[fallback] === 'string') return event[fallback];
  return '';
}

function valueField(event, primary, fallback) {
  if (event[primary] !== undefined) return event[primary];
  return event[fallback];
}

/**
 * Stream an SSE response from the agent session turn endpoint and print to stdout.
 *
 * @param {Response} res - fetch Response with Content-Type: text/event-stream
 * @param {object} opts
 * @param {boolean} [opts.showTools=true] - Show tool call / result lines
 * @param {boolean} [opts.json=false] - Collect full output and return as object instead of printing
 * @returns {Promise<{ text: string, toolCalls: string[], error?: string }>}
 */
export async function streamSSE(res, opts = {}) {
  const { showTools = true, json = false } = opts;
  const decoder = new TextDecoder();
  if (!res.body) {
    return { text: '', toolCalls: [], error: 'Empty response body' };
  }
  const reader = res.body.getReader();

  let textBuffer = '';
  const toolCalls = [];
  let error = null;
  let buffer = '';
  let firstTextPrinted = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      // Keep the last incomplete line in buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5);
        if (!payload) continue;

        let event;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }

        if (event.type === 'text_delta') {
          const delta = stringField(event, 'delta', 'text');
          if (!firstTextPrinted && !json) {
            // Clear "Thinking..." spinner
            process.stdout.write('\r\x1b[K');
            firstTextPrinted = true;
          }
          textBuffer += delta;
          if (!json) process.stdout.write(delta);
        }

        if (event.type === 'thinking_delta') {
          // Suppress thinking in CLI output (it's internal reasoning)
        }

        if (event.type === 'tool_start' && showTools && !json) {
          if (!firstTextPrinted) {
            process.stdout.write('\r\x1b[K');
            firstTextPrinted = true;
          }
          const name = stringField(event, 'toolName', 'name') || 'unknown';
          const input = valueField(event, 'args', 'input');
          const inputSnippet = input
            ? JSON.stringify(input).slice(0, 80)
            : '';
          const toolLine = `\n  ${dim('[')}${cyan('tool')}${dim(']')} ${name}${inputSnippet ? dim(': ' + inputSnippet) : ''}`;
          process.stdout.write(toolLine);
          toolCalls.push(name);
        }

        if (event.type === 'tool_end' && showTools && !json) {
          const output = valueField(event, 'output', 'result') || '';
          const preview = typeof output === 'string'
            ? output.slice(0, 120)
            : JSON.stringify(output).slice(0, 120);
          if (preview) {
            process.stdout.write(dim('  → ' + preview));
          }
          process.stdout.write('\n');
        }

        if (event.type === 'status' && !json) {
          if (!firstTextPrinted) {
            process.stdout.write('\r\x1b[K');
            firstTextPrinted = true;
          }
          process.stdout.write(dim(`  [${event.message || 'processing'}]\n`));
        }

        if (event.type === 'error') {
          error = event.message || event.error || 'Unknown error';
          if (!json) {
            if (!firstTextPrinted) {
              process.stdout.write('\r\x1b[K');
            }
            process.stderr.write('\n' + red('Error: ' + error) + '\n');
          }
        }

        if (event.type === 'done') {
          // Stream complete
        }
      }
    }
  } catch (err) {
    if (!json && !firstTextPrinted) {
      process.stdout.write('\r\x1b[K');
    }
    error = err.message || 'Stream interrupted';
    if (!json) {
      if (textBuffer) process.stdout.write('\n');
      process.stderr.write(red('Error: ' + error) + '\n');
    }
  }

  if (!json && textBuffer && !textBuffer.endsWith('\n')) {
    process.stdout.write('\n');
  }

  return { text: textBuffer, toolCalls, error };
}

/**
 * POST to /api/agent/sessions/:sessionId/turns with proper headers and message format.
 *
 * @param {string} baseUrl - e.g. http://localhost:3456
 * @param {string} sessionId - MindOS chat/session id for this CLI conversation
 * @param {object} body - { messages, agentMode, permissionMode, attachedFiles, maxSteps, ... }
 * @param {string} [token] - Auth token
 * @returns {Promise<Response>}
 */
export async function postAgentTurn(baseUrl, sessionId, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  return fetch(`${baseUrl}/api/agent/sessions/${encodeURIComponent(sessionId)}/turns`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

/**
 * Check if MindOS is running by hitting /api/health.
 * @param {string} baseUrl
 * @returns {Promise<boolean>}
 */
export async function checkHealth(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * SSE streaming client for CLI → /api/ask
 *
 * Handles the text/event-stream protocol emitted by the MindOS Ask API.
 * Supports text_delta, thinking_delta, tool_start, tool_end, done, error, status events.
 */

import { dim, cyan, red } from './colors.js';

/**
 * Stream an SSE response from /api/ask and print to stdout.
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
          if (!firstTextPrinted && !json) {
            // Clear "Thinking..." spinner
            process.stdout.write('\r\x1b[K');
            firstTextPrinted = true;
          }
          textBuffer += event.text;
          if (!json) process.stdout.write(event.text);
        }

        if (event.type === 'thinking_delta') {
          // Suppress thinking in CLI output (it's internal reasoning)
        }

        if (event.type === 'tool_start' && showTools && !json) {
          if (!firstTextPrinted) {
            process.stdout.write('\r\x1b[K');
            firstTextPrinted = true;
          }
          const name = event.name || 'unknown';
          const inputSnippet = event.input
            ? JSON.stringify(event.input).slice(0, 80)
            : '';
          const toolLine = `\n  ${dim('[')}${cyan('tool')}${dim(']')} ${name}${inputSnippet ? dim(': ' + inputSnippet) : ''}`;
          process.stdout.write(toolLine);
          toolCalls.push(name);
        }

        if (event.type === 'tool_end' && showTools && !json) {
          const result = event.result || '';
          const preview = typeof result === 'string'
            ? result.slice(0, 120)
            : JSON.stringify(result).slice(0, 120);
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
 * POST to /api/ask with proper headers and message format.
 *
 * @param {string} baseUrl - e.g. http://localhost:3456
 * @param {object} body - { messages, mode, attachedFiles, maxSteps, ... }
 * @param {string} [token] - Auth token
 * @returns {Promise<Response>}
 */
export async function postAsk(baseUrl, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  return fetch(`${baseUrl}/api/ask`, {
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

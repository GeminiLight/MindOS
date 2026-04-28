/**
 * Tests for agent/ask CLI routing logic:
 * - `-p` flag → non-interactive (print mode)
 * - No `-p` + no args → interactive REPL
 * - Management subcommands → direct execution
 */

import { describe, it, expect } from 'vitest';

const MANAGEMENT_SUBCOMMANDS = new Set(['list', 'ls', 'info', 'stats', 'help']);

type AgentRoute = 'interactive' | 'print' | 'management';

function classifyAgentArgs(
  args: string[],
  flags: Record<string, unknown> = {},
): AgentRoute {
  const sub = args[0];

  // Management subcommands always take priority
  if (sub && MANAGEMENT_SUBCOMMANDS.has(sub)) return 'management';

  // -p / --print → non-interactive print mode
  if (flags.p || flags.print) return 'print';

  // Has task text without -p → also print mode (backward compat: inline task)
  if (sub) return 'print';

  // No args, no -p → interactive REPL
  return 'interactive';
}

function classifyAskArgs(
  args: string[],
  flags: Record<string, unknown> = {},
): 'interactive' | 'print' {
  if (flags.p || flags.print) return 'print';
  if (args.length > 0) return 'print';
  return 'interactive';
}

function buildAskBody(
  content: string | string[],
  mode: 'agent' | 'chat',
  opts: { file?: string; maxSteps?: number } = {},
) {
  const messages = Array.isArray(content)
    ? content.map((c, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: c,
        timestamp: Date.now(),
      }))
    : [{ role: 'user', content, timestamp: Date.now() }];

  const body: Record<string, unknown> = { messages, mode };
  if (opts.file) body.attachedFiles = [opts.file];
  if (opts.maxSteps) body.maxSteps = opts.maxSteps;
  return body;
}

// ── Agent routing ─────────────────────────────────────────────────────────────

describe('Agent CLI routing', () => {
  it('routes empty args (no -p) to interactive', () => {
    expect(classifyAgentArgs([])).toBe('interactive');
  });

  it('routes -p flag with task to print mode', () => {
    expect(classifyAgentArgs(['整理笔记'], { p: true })).toBe('print');
  });

  it('routes --print flag with task to print mode', () => {
    expect(classifyAgentArgs(['do stuff'], { print: true })).toBe('print');
  });

  it('routes bare task (no -p) to print mode for backward compat', () => {
    expect(classifyAgentArgs(['Summarize my notes'])).toBe('print');
  });

  it('routes "list" to management regardless of -p', () => {
    expect(classifyAgentArgs(['list'])).toBe('management');
    expect(classifyAgentArgs(['list'], { p: true })).toBe('management');
  });

  it('routes "ls" alias to management', () => {
    expect(classifyAgentArgs(['ls'])).toBe('management');
  });

  it('routes "info" to management', () => {
    expect(classifyAgentArgs(['info', 'cursor'])).toBe('management');
  });

  it('routes "stats" to management', () => {
    expect(classifyAgentArgs(['stats'])).toBe('management');
  });

  it('routes "help" to management', () => {
    expect(classifyAgentArgs(['help'])).toBe('management');
  });

  it('routes Chinese task text to print mode', () => {
    expect(classifyAgentArgs(['整理我的笔记'])).toBe('print');
  });

  it('does not misroute words starting with subcommand prefix', () => {
    expect(classifyAgentArgs(['listing', 'all', 'files'])).toBe('print');
    expect(classifyAgentArgs(['information', 'about', 'RAG'])).toBe('print');
  });

  it('routes -p with no task text to print mode', () => {
    expect(classifyAgentArgs([], { p: true })).toBe('print');
  });
});

// ── Ask routing ───────────────────────────────────────────────────────────────

describe('Ask CLI routing', () => {
  it('routes empty args to interactive', () => {
    expect(classifyAskArgs([])).toBe('interactive');
  });

  it('routes -p with question to print', () => {
    expect(classifyAskArgs(['what is RAG'], { p: true })).toBe('print');
  });

  it('routes bare question (no -p) to print for backward compat', () => {
    expect(classifyAskArgs(['what is RAG'])).toBe('print');
  });

  it('routes --print flag to print', () => {
    expect(classifyAskArgs(['hello'], { print: true })).toBe('print');
  });
});

// ── API body construction ─────────────────────────────────────────────────────

describe('Ask API body construction', () => {
  it('builds agent mode body with correct message format', () => {
    const body = buildAskBody('do something', 'agent');
    expect(body.mode).toBe('agent');
    expect(body.messages).toHaveLength(1);
    const msg = (body.messages as any[])[0];
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('do something');
    expect(msg.timestamp).toBeTypeOf('number');
  });

  it('builds chat mode body', () => {
    const body = buildAskBody('what is RAG', 'chat');
    expect(body.mode).toBe('chat');
  });

  it('builds multi-turn conversation body', () => {
    const body = buildAskBody(['hello', 'hi there', 'how are you'], 'chat');
    expect(body.messages).toHaveLength(3);
    const msgs = body.messages as any[];
    expect(msgs[0].role).toBe('user');
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[2].role).toBe('user');
  });

  it('attaches file when provided', () => {
    const body = buildAskBody('summarize', 'agent', { file: 'notes.md' });
    expect(body.attachedFiles).toEqual(['notes.md']);
  });

  it('sets maxSteps when provided', () => {
    const body = buildAskBody('do task', 'agent', { maxSteps: 10 });
    expect(body.maxSteps).toBe(10);
  });

  it('omits attachedFiles and maxSteps when not provided', () => {
    const body = buildAskBody('simple task', 'agent');
    expect(body.attachedFiles).toBeUndefined();
    expect(body.maxSteps).toBeUndefined();
  });
});

describe('SSE event parsing', () => {
  function parseSSELine(line: string): { type: string; [key: string]: unknown } | null {
    if (!line.startsWith('data:')) return null;
    const payload = line.slice(5);
    if (!payload) return null;
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }

  it('parses text_delta event', () => {
    const event = parseSSELine('data:{"type":"text_delta","text":"Hello"}');
    expect(event).toEqual({ type: 'text_delta', text: 'Hello' });
  });

  it('parses tool_start event', () => {
    const event = parseSSELine('data:{"type":"tool_start","name":"search_notes","input":{"query":"today"}}');
    expect(event?.type).toBe('tool_start');
    expect(event?.name).toBe('search_notes');
  });

  it('parses tool_end event', () => {
    const event = parseSSELine('data:{"type":"tool_end","result":"found 3 notes"}');
    expect(event?.type).toBe('tool_end');
    expect(event?.result).toBe('found 3 notes');
  });

  it('parses error event', () => {
    const event = parseSSELine('data:{"type":"error","message":"API key not configured"}');
    expect(event?.type).toBe('error');
    expect(event?.message).toBe('API key not configured');
  });

  it('parses done event', () => {
    const event = parseSSELine('data:{"type":"done"}');
    expect(event?.type).toBe('done');
  });

  it('returns null for non-data lines', () => {
    expect(parseSSELine('event: message')).toBeNull();
    expect(parseSSELine('')).toBeNull();
    expect(parseSSELine('retry: 3000')).toBeNull();
  });

  it('returns null for empty data', () => {
    expect(parseSSELine('data:')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseSSELine('data:{broken')).toBeNull();
  });
});

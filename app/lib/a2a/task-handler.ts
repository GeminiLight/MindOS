/**
 * A2A Task handler for MindOS.
 * Routes A2A SendMessage requests to internal MCP tools.
 */

import { randomUUID } from 'crypto';
import type {
  A2ATask,
  A2AMessage,
  SendMessageParams,
  GetTaskParams,
  CancelTaskParams,
  TaskState,
} from './types';

/* ── In-memory Task Store (Phase 1) ───────────────────────────────────── */
// NOTE: In-memory Map is lost on serverless cold starts / process restarts.
// Acceptable for Phase 1. Phase 2 should use persistent storage if needed.

const tasks = new Map<string, A2ATask>();
const MAX_TASKS = 1000;

function pruneOldTasks() {
  if (tasks.size <= MAX_TASKS) return;
  // Remove oldest completed tasks first
  const entries = [...tasks.entries()].sort((a, b) =>
    new Date(a[1].status.timestamp).getTime() - new Date(b[1].status.timestamp).getTime()
  );
  const toRemove = entries.slice(0, tasks.size - MAX_TASKS);
  for (const [id] of toRemove) tasks.delete(id);
}

/* ── Skill Router ─────────────────────────────────────────────────────── */

interface SkillRoute {
  pattern: RegExp;
  tool: string;
  extractParams: (text: string) => Record<string, string>;
}

const SKILL_ROUTES: SkillRoute[] = [
  {
    pattern: /^(?:search|find|look\s*up|query)\b/i,
    tool: 'search_notes',
    extractParams: (text) => ({ q: text.replace(/^(?:search|find|look\s*up|query)\s+(?:for\s+)?/i, '').trim() }),
  },
  {
    pattern: /^(?:read|get|show|open|view)\s+(?:the\s+)?(?:file\s+)?(?:at\s+)?(.+\.(?:md|csv))/i,
    tool: 'read_file',
    extractParams: (text) => {
      const match = text.match(/(?:at\s+)?([^\s]+\.(?:md|csv))/i);
      return { path: match?.[1] ?? '' };
    },
  },
  {
    pattern: /^(?:list|show|tree)\s+(?:files|spaces|structure)/i,
    tool: 'list_files',
    extractParams: () => ({}),
  },
  {
    pattern: /^(?:list|show)\s+spaces/i,
    tool: 'list_spaces',
    extractParams: () => ({}),
  },
];

function routeToTool(text: string): { tool: string; params: Record<string, string> } | null {
  for (const route of SKILL_ROUTES) {
    if (route.pattern.test(text)) {
      return { tool: route.tool, params: route.extractParams(text) };
    }
  }
  return null;
}

/* ── Execute via internal API ─────────────────────────────────────────── */

const TOOL_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

/** Sanitize file path: reject traversal attempts */
function sanitizePath(p: string): string {
  if (!p || p.includes('..') || p.includes('\0')) throw new Error('Invalid path');
  // Normalize double slashes and strip leading slashes
  return p.replace(/\/\//g, '/').replace(/^\/+/, '');
}

async function executeTool(tool: string, params: Record<string, string>): Promise<string> {
  const baseUrl = `http://localhost:${process.env.PORT || 3456}`;

  switch (tool) {
    case 'search_notes': {
      const q = (params.q || '').slice(0, 500); // limit query length
      const res = await fetchWithTimeout(`${baseUrl}/api/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      const data = await res.json();
      return JSON.stringify(data, null, 2);
    }
    case 'read_file': {
      const safePath = sanitizePath(params.path || '');
      const res = await fetchWithTimeout(`${baseUrl}/api/file?path=${encodeURIComponent(safePath)}`);
      if (!res.ok) throw new Error(`Read failed: ${res.status}`);
      const data = await res.json();
      return typeof data.content === 'string' ? data.content : JSON.stringify(data);
    }
    case 'list_files': {
      const res = await fetchWithTimeout(`${baseUrl}/api/files`);
      if (!res.ok) throw new Error(`List failed: ${res.status}`);
      const data = await res.json();
      return JSON.stringify(data, null, 2);
    }
    case 'list_spaces': {
      const res = await fetchWithTimeout(`${baseUrl}/api/files`);
      if (!res.ok) throw new Error(`List failed: ${res.status}`);
      const data = await res.json();
      const spaces = (data.tree ?? data.files ?? []).filter((n: { isSpace?: boolean }) => n.isSpace);
      return JSON.stringify(spaces, null, 2);
    }
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

/* ── Public API ────────────────────────────────────────────────────────── */

export async function handleSendMessage(params: SendMessageParams): Promise<A2ATask> {
  const taskId = randomUUID();
  const now = new Date().toISOString();

  // Extract text from message parts
  const text = params.message.parts
    .map(p => p.text ?? (p.data ? JSON.stringify(p.data) : ''))
    .join(' ')
    .trim();

  if (!text) {
    const failedTask = createTask(taskId, 'TASK_STATE_FAILED', 'Empty message — no text content found.', now);
    tasks.set(taskId, failedTask);
    return failedTask;
  }

  // Create task in WORKING state
  const task = createTask(taskId, 'TASK_STATE_WORKING', undefined, now);
  task.history = [params.message];
  tasks.set(taskId, task);
  pruneOldTasks();

  // Route to tool
  const route = routeToTool(text);

  try {
    let result: string;
    if (route) {
      result = await executeTool(route.tool, route.params);
    } else {
      // Fallback: treat as search query
      result = await executeTool('search_notes', { q: text });
    }

    // Update task to completed
    task.status = {
      state: 'TASK_STATE_COMPLETED',
      timestamp: new Date().toISOString(),
    };
    task.artifacts = [{
      artifactId: randomUUID(),
      name: 'result',
      parts: [{ text: result, mediaType: 'text/plain' }],
    }];
    task.history.push({
      role: 'ROLE_AGENT',
      parts: [{ text: result }],
    });

    return task;
  } catch (err) {
    task.status = {
      state: 'TASK_STATE_FAILED',
      message: {
        role: 'ROLE_AGENT',
        parts: [{ text: `Error: ${(err as Error).message}` }],
      },
      timestamp: new Date().toISOString(),
    };
    return task;
  }
}

export function handleGetTask(params: GetTaskParams): A2ATask | null {
  return tasks.get(params.id) ?? null;
}

export function handleCancelTask(params: CancelTaskParams): A2ATask | null {
  const task = tasks.get(params.id);
  if (!task) return null;

  const terminalStates: TaskState[] = ['TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED'];
  if (terminalStates.includes(task.status.state)) return null; // not cancelable

  task.status = {
    state: 'TASK_STATE_CANCELED',
    timestamp: new Date().toISOString(),
  };
  return task;
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function createTask(id: string, state: TaskState, errorMessage: string | undefined, timestamp: string): A2ATask {
  return {
    id,
    status: {
      state,
      timestamp,
      ...(errorMessage ? { message: { role: 'ROLE_AGENT', parts: [{ text: errorMessage }] } } : {}),
    },
  };
}

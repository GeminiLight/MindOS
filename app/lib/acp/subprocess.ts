/**
 * ACP Subprocess Manager — Spawn and communicate with ACP agent processes.
 * ACP agents communicate via JSON-RPC 2.0 over stdio (stdin/stdout).
 */

import { spawn, type ChildProcess } from 'child_process';
import type {
  AcpJsonRpcRequest,
  AcpJsonRpcResponse,
  AcpRegistryEntry,
} from './types';
import { resolveAgentCommand } from './agent-descriptors';
import { readSettings } from '../settings';

/** Incoming JSON-RPC request from agent (bidirectional — agent asks US for permission). */
export interface AcpIncomingRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 notification from agent (no id → no response expected). */
export interface AcpNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface AcpProcess {
  id: string;
  agentId: string;
  proc: ChildProcess;
  alive: boolean;
  /** Set when the process fails to spawn or exits with an error. */
  spawnError?: string;
  /** Exit code when the process has terminated. */
  exitCode?: number | null;
}

type MessageCallback = (msg: AcpJsonRpcResponse) => void;
type RequestCallback = (req: AcpIncomingRequest) => void;
type NotificationCallback = (notif: AcpNotification) => void;

/* ── State ─────────────────────────────────────────────────────────────── */

const processes = new Map<string, AcpProcess>();
const messageListeners = new Map<string, Set<MessageCallback>>();
const requestListeners = new Map<string, Set<RequestCallback>>();
const notificationListeners = new Map<string, Set<NotificationCallback>>();
let rpcIdCounter = 1;

/* ── Public API ────────────────────────────────────────────────────────── */

/**
 * Spawn an ACP agent subprocess.
 */
export function spawnAcpAgent(
  entry: AcpRegistryEntry,
  options?: { env?: Record<string, string>; cwd?: string },
): AcpProcess {
  const settings = readSettings();
  const userOverride = settings.acpAgents?.[entry.id];
  const resolved = resolveAgentCommand(entry.id, entry, userOverride);
  const { cmd, args } = { cmd: resolved.cmd, args: resolved.args };

  const mergedEnv = {
    ...process.env,
    ...(entry.env ?? {}),
    ...(resolved.env ?? {}),
    ...(options?.env ?? {}),
  };

  const proc = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: mergedEnv,
    shell: false,
    detached: true,
    ...(options?.cwd ? { cwd: options.cwd } : {}),
  });

  const id = `acp-${entry.id}-${Date.now()}`;
  const acpProc: AcpProcess = { id, agentId: entry.id, proc, alive: true };

  processes.set(id, acpProc);
  messageListeners.set(id, new Set());
  requestListeners.set(id, new Set());
  notificationListeners.set(id, new Set());

  // Parse newline-delimited JSON-RPC 2.0 from stdout.
  // Three message types per spec:
  //   1. Request  (has method + id)    → agent asking client for something
  //   2. Notification (has method, NO id) → agent streaming updates
  //   3. Response (has id, NO method)  → reply to our request
  let buffer = '';
  proc.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);

        if (msg.method !== undefined) {
          if (msg.id !== undefined) {
            const reqCbs = requestListeners.get(id);
            if (reqCbs) for (const cb of reqCbs) cb(msg as AcpIncomingRequest);
          } else {
            const notifCbs = notificationListeners.get(id);
            if (notifCbs) for (const cb of notifCbs) cb(msg as AcpNotification);
          }
        } else {
          const msgCbs = messageListeners.get(id);
          if (msgCbs) for (const cb of msgCbs) cb(msg as AcpJsonRpcResponse);
        }
      } catch {
        // Not valid JSON — skip (could be agent debug output)
      }
    }
  });

  // Capture stderr for debugging (agents may log startup errors there)
  let stderrBuf = '';
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString();
    // Keep only last 4KB to avoid unbounded memory
    if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096);
  });

  proc.on('close', (code) => {
    acpProc.alive = false;
    acpProc.exitCode = code;
    if (code && code !== 0) {
      acpProc.spawnError = stderrBuf.trim().slice(0, 500) || `Process exited with code ${code}`;
      console.error(`[ACP] ${entry.id} exited with code ${code}: ${acpProc.spawnError}`);
    }
    // Do NOT delete listeners here — sendAndWait still needs them to reject.
    // Listeners are cleaned up in killAgent() and by individual unsub calls.
  });

  proc.on('error', (err) => {
    acpProc.alive = false;
    acpProc.spawnError = err.message;
    console.error(`[ACP] ${entry.id} spawn error:`, err.message);
  });

  return acpProc;
}

/**
 * Send a JSON-RPC message to an ACP agent's stdin.
 */
export function sendMessage(acpProc: AcpProcess, method: string, params?: Record<string, unknown>): string {
  if (!acpProc.alive || !acpProc.proc.stdin?.writable) {
    throw new Error(`ACP process ${acpProc.id} is not alive`);
  }

  const id = `rpc-${rpcIdCounter++}`;
  const request: AcpJsonRpcRequest = {
    jsonrpc: '2.0',
    id,
    method,
    ...(params ? { params } : {}),
  };

  acpProc.proc.stdin.write(JSON.stringify(request) + '\n');
  return id;
}

/**
 * Register a callback for messages from an ACP agent.
 * Returns an unsubscribe function.
 */
export function onMessage(acpProc: AcpProcess, callback: MessageCallback): () => void {
  const listeners = messageListeners.get(acpProc.id);
  if (!listeners) throw new Error(`ACP process ${acpProc.id} not found`);

  listeners.add(callback);
  return () => { listeners.delete(callback); };
}

/**
 * Send a JSON-RPC request and wait for a response with the matching ID.
 */
export function sendAndWait(
  acpProc: AcpProcess,
  method: string,
  params?: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<AcpJsonRpcResponse> {
  return new Promise((resolve, reject) => {
    // Fail fast if process is already dead (e.g. binary not found).
    if (!acpProc.alive) {
      const reason = acpProc.spawnError || 'Process is not alive';
      reject(new Error(
        `Agent "${acpProc.agentId}" is not running: ${reason}. ` +
        `Please check that the agent is installed and available on your PATH.`,
      ));
      return;
    }

    let rpcId: string;
    try {
      rpcId = sendMessage(acpProc, method, params);
    } catch (err) {
      reject(err);
      return;
    }

    const cleanup = () => {
      clearTimeout(timer);
      unsub();
      acpProc.proc.removeListener('close', onClose);
      acpProc.proc.removeListener('error', onError);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`ACP RPC timeout after ${timeoutMs}ms for method: ${method}`));
    }, timeoutMs);

    const unsub = onMessage(acpProc, (msg) => {
      if (String(msg.id) === rpcId) {
        cleanup();
        resolve(msg);
      }
    });

    // Reject immediately if the process dies while we're waiting.
    const onClose = (code: number | null) => {
      cleanup();
      const reason = acpProc.spawnError || `Process exited with code ${code}`;
      reject(new Error(
        `Agent "${acpProc.agentId}" exited unexpectedly: ${reason}. ` +
        `Please check that the agent is installed and available on your PATH.`,
      ));
    };
    const onError = (err: Error) => {
      cleanup();
      reject(new Error(
        `Agent "${acpProc.agentId}" failed to start: ${err.message}. ` +
        `Please check that the agent is installed and available on your PATH.`,
      ));
    };
    acpProc.proc.once('close', onClose);
    acpProc.proc.once('error', onError);
  });
}

/**
 * Kill an ACP agent process and its entire process tree.
 * Uses negative PID to send signal to the process group (requires detached spawn).
 */
export function killAgent(acpProc: AcpProcess): void {
  const pid = acpProc.proc.pid;
  if (pid) {
    // Kill the entire process group via negative PID
    try { process.kill(-pid, 'SIGTERM'); } catch { /* already dead */ }

    // Force SIGKILL after 3s — use signal 0 probe instead of `alive` flag
    // because `alive` is set to false below before the timeout fires.
    setTimeout(() => {
      try {
        process.kill(-pid, 0); // probe: throws if group is gone
        process.kill(-pid, 'SIGKILL');
      } catch { /* already dead — good */ }
    }, 3000);
  }
  acpProc.alive = false;
  processes.delete(acpProc.id);
  messageListeners.delete(acpProc.id);
  requestListeners.delete(acpProc.id);
  notificationListeners.delete(acpProc.id);
  // Clean up any terminals spawned by this process
  const terms = terminalMaps.get(acpProc.id);
  if (terms) {
    for (const entry of terms.values()) {
      if (entry.child.exitCode === null) entry.child.kill('SIGTERM');
    }
    terminalMaps.delete(acpProc.id);
  }
}

/**
 * Get a process by its ID.
 */
export function getProcess(id: string): AcpProcess | undefined {
  return processes.get(id);
}

/**
 * Get all active processes.
 */
export function getActiveProcesses(): AcpProcess[] {
  return [...processes.values()].filter(p => p.alive);
}

/**
 * Kill all active ACP processes. Used for cleanup.
 */
export function killAllAgents(): void {
  for (const proc of processes.values()) {
    killAgent(proc);
  }
}

/**
 * Register a callback for JSON-RPC notifications from the agent
 * (e.g. session/update streaming updates during prompt processing).
 * Returns an unsubscribe function.
 */
export function onNotification(acpProc: AcpProcess, callback: NotificationCallback): () => void {
  const listeners = notificationListeners.get(acpProc.id);
  if (!listeners) throw new Error(`ACP process ${acpProc.id} not found`);

  listeners.add(callback);
  return () => { listeners.delete(callback); };
}

/**
 * Register a callback for incoming JSON-RPC REQUESTS from the agent
 * (bidirectional: agent asks client for permission / capability).
 * Returns an unsubscribe function.
 */
export function onRequest(acpProc: AcpProcess, callback: RequestCallback): () => void {
  const listeners = requestListeners.get(acpProc.id);
  if (!listeners) throw new Error(`ACP process ${acpProc.id} not found`);

  listeners.add(callback);
  return () => { listeners.delete(callback); };
}

/**
 * Send a raw JSON-RPC response back to the agent's stdin.
 * Used for replying to incoming requests (e.g. permission approvals).
 */
export function sendResponse(
  acpProc: AcpProcess,
  id: string | number,
  result: unknown,
): void {
  if (!acpProc.alive || !acpProc.proc.stdin?.writable) {
    throw new Error(`ACP process ${acpProc.id} is not alive`);
  }

  const response: AcpJsonRpcResponse = {
    jsonrpc: '2.0',
    id,
    result,
  };
  acpProc.proc.stdin.write(JSON.stringify(response) + '\n');
}

/**
 * Install auto-approval for all incoming permission/capability requests.
 * Agents in ACP mode send requests like fs/read, fs/write, terminal/execute etc.
 * Without approval, the agent hangs waiting for TTY input that never comes.
 * Returns an unsubscribe function.
 */
export function installAutoApproval(acpProc: AcpProcess): () => void {
  return onRequest(acpProc, (req) => {
    const method = req.method;
    const params = (req.params ?? {}) as Record<string, unknown>;

    switch (method) {
      // ── File system: read ──
      case 'fs/read_text_file': {
        const filePath = String(params.path ?? '');
        if (!filePath) {
          sendResponse(acpProc, req.id, { error: { code: -32602, message: 'path is required' } });
          return;
        }
        try {
          const fs = require('fs');
          const line = typeof params.line === 'number' ? params.line : undefined;
          const limit = typeof params.limit === 'number' ? params.limit : undefined;
          let content = fs.readFileSync(filePath, 'utf-8') as string;
          if (line !== undefined || limit !== undefined) {
            const lines = content.split('\n');
            const start = (line ?? 1) - 1; // 1-based to 0-based
            const end = limit !== undefined ? start + limit : lines.length;
            content = lines.slice(Math.max(0, start), end).join('\n');
          }
          sendResponse(acpProc, req.id, { content });
        } catch (err) {
          sendResponse(acpProc, req.id, { error: { code: -32002, message: (err as Error).message } });
        }
        return;
      }

      // ── File system: write ──
      case 'fs/write_text_file': {
        const filePath = String(params.path ?? '');
        const content = String(params.content ?? '');
        if (!filePath) {
          sendResponse(acpProc, req.id, { error: { code: -32602, message: 'path is required' } });
          return;
        }
        try {
          const fs = require('fs');
          const path = require('path');
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(filePath, content, 'utf-8');
          sendResponse(acpProc, req.id, {});
        } catch (err) {
          sendResponse(acpProc, req.id, { error: { code: -32603, message: (err as Error).message } });
        }
        return;
      }

      // ── Terminal: create ──
      case 'terminal/create': {
        const command = String(params.command ?? '');
        const args = Array.isArray(params.args) ? params.args.map(String) : [];
        const cwd = typeof params.cwd === 'string' ? params.cwd : undefined;
        const env = (params.env && typeof params.env === 'object') ? params.env as Record<string, string> : undefined;
        const outputByteLimit = typeof params.outputByteLimit === 'number' ? params.outputByteLimit : 1_000_000;

        if (!command) {
          sendResponse(acpProc, req.id, { error: { code: -32602, message: 'command is required' } });
          return;
        }

        const terminalId = `term-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        try {
          const { spawn: spawnChild } = require('child_process');
          const child = spawnChild(command, args, {
            cwd,
            env: { ...process.env, ...(env ?? {}) },
            shell: true,
            stdio: ['pipe', 'pipe', 'pipe'],
          });

          let output = '';
          let truncated = false;

          child.stdout?.on('data', (chunk: Buffer) => {
            if (output.length < outputByteLimit) {
              output += chunk.toString();
              if (output.length > outputByteLimit) {
                output = output.slice(0, outputByteLimit);
                truncated = true;
              }
            }
          });
          child.stderr?.on('data', (chunk: Buffer) => {
            if (output.length < outputByteLimit) {
              output += chunk.toString();
              if (output.length > outputByteLimit) {
                output = output.slice(0, outputByteLimit);
                truncated = true;
              }
            }
          });

          // Store terminal in process-scoped map
          const terminalMap = getOrCreateTerminalMap(acpProc.id);
          terminalMap.set(terminalId, { child, output: () => output, truncated: () => truncated });

          sendResponse(acpProc, req.id, { terminalId });
        } catch (err) {
          sendResponse(acpProc, req.id, { error: { code: -32603, message: (err as Error).message } });
        }
        return;
      }

      // ── Terminal: output ──
      case 'terminal/output': {
        const terminalId = String(params.terminalId ?? '');
        const terminal = getTerminal(acpProc.id, terminalId);
        if (!terminal) {
          sendResponse(acpProc, req.id, { error: { code: -32002, message: `Terminal not found: ${terminalId}` } });
          return;
        }
        const exitStatus = terminal.child.exitCode !== null ? { exitCode: terminal.child.exitCode } : undefined;
        sendResponse(acpProc, req.id, { output: terminal.output(), truncated: terminal.truncated(), exitStatus });
        return;
      }

      // ── Terminal: kill ──
      case 'terminal/kill': {
        const terminalId = String(params.terminalId ?? '');
        const terminal = getTerminal(acpProc.id, terminalId);
        if (!terminal) {
          sendResponse(acpProc, req.id, { error: { code: -32002, message: `Terminal not found: ${terminalId}` } });
          return;
        }
        terminal.child.kill('SIGTERM');
        sendResponse(acpProc, req.id, {});
        return;
      }

      // ── Terminal: wait_for_exit ──
      case 'terminal/wait_for_exit': {
        const terminalId = String(params.terminalId ?? '');
        const terminal = getTerminal(acpProc.id, terminalId);
        if (!terminal) {
          sendResponse(acpProc, req.id, { error: { code: -32002, message: `Terminal not found: ${terminalId}` } });
          return;
        }
        if (terminal.child.exitCode !== null) {
          sendResponse(acpProc, req.id, { exitCode: terminal.child.exitCode, signal: terminal.child.signalCode });
          return;
        }
        terminal.child.on('exit', (code: number | null, signal: string | null) => {
          sendResponse(acpProc, req.id, { exitCode: code, signal });
        });
        return;
      }

      // ── Terminal: release ──
      case 'terminal/release': {
        const terminalId = String(params.terminalId ?? '');
        const terminal = getTerminal(acpProc.id, terminalId);
        if (!terminal) {
          sendResponse(acpProc, req.id, { error: { code: -32002, message: `Terminal not found: ${terminalId}` } });
          return;
        }
        if (terminal.child.exitCode === null) terminal.child.kill('SIGTERM');
        removeTerminal(acpProc.id, terminalId);
        sendResponse(acpProc, req.id, {});
        return;
      }

      // ── Permission requests (auto-approve all) ──
      case 'session/request_permission': {
        // Auto-approve in production; log in dev for debugging
        if (process.env.NODE_ENV === 'development') console.log(`[ACP] Auto-approving permission: ${JSON.stringify(params.toolCall ?? {}).slice(0, 200)}`);
        sendResponse(acpProc, req.id, { outcome: { selected: { optionId: 'allow_once' } } });
        return;
      }

      // ── Unknown methods: auto-approve for backwards compat ──
      default: {
        if (process.env.NODE_ENV === 'development') console.log(`[ACP] Auto-approving unknown agent request: ${method} (id=${req.id})`);
        sendResponse(acpProc, req.id, {});
      }
    }
  });
}

/* ── Terminal management (per ACP process) ─────────────────────────────── */

interface TerminalEntry {
  child: import('child_process').ChildProcess;
  output: () => string;
  truncated: () => boolean;
}

const terminalMaps = new Map<string, Map<string, TerminalEntry>>();

function getOrCreateTerminalMap(procId: string): Map<string, TerminalEntry> {
  let map = terminalMaps.get(procId);
  if (!map) {
    map = new Map();
    terminalMaps.set(procId, map);
  }
  return map;
}

function getTerminal(procId: string, terminalId: string): TerminalEntry | undefined {
  return terminalMaps.get(procId)?.get(terminalId);
}

function removeTerminal(procId: string, terminalId: string): void {
  terminalMaps.get(procId)?.delete(terminalId);
}

/* ── Internal — agent command resolution moved to agent-descriptors.ts ─ */

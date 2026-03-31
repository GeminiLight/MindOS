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

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface AcpProcess {
  id: string;
  agentId: string;
  proc: ChildProcess;
  alive: boolean;
}

type MessageCallback = (msg: AcpJsonRpcResponse) => void;
type RequestCallback = (req: AcpIncomingRequest) => void;

/* ── State ─────────────────────────────────────────────────────────────── */

const processes = new Map<string, AcpProcess>();
const messageListeners = new Map<string, Set<MessageCallback>>();
const requestListeners = new Map<string, Set<RequestCallback>>();
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
    ...(options?.cwd ? { cwd: options.cwd } : {}),
  });

  const id = `acp-${entry.id}-${Date.now()}`;
  const acpProc: AcpProcess = { id, agentId: entry.id, proc, alive: true };

  processes.set(id, acpProc);
  messageListeners.set(id, new Set());
  requestListeners.set(id, new Set());

  // Parse newline-delimited JSON from stdout
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

        // Distinguish incoming requests (agent → client) from responses (to our requests).
        // Requests have `method` and `id` but no `result`/`error`.
        const isRequest = msg.method && msg.id !== undefined
          && !('result' in msg) && !('error' in msg);

        if (isRequest) {
          const reqListeners = requestListeners.get(id);
          if (reqListeners) {
            for (const cb of reqListeners) cb(msg as AcpIncomingRequest);
          }
        } else {
          const listeners = messageListeners.get(id);
          if (listeners) {
            for (const cb of listeners) cb(msg as AcpJsonRpcResponse);
          }
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
    if (code && code !== 0 && stderrBuf.trim()) {
      console.error(`[ACP] ${entry.id} exited with code ${code}: ${stderrBuf.trim().slice(0, 500)}`);
    }
    messageListeners.delete(id);
    requestListeners.delete(id);
  });

  proc.on('error', (err) => {
    acpProc.alive = false;
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
    const rpcId = sendMessage(acpProc, method, params);

    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`ACP RPC timeout after ${timeoutMs}ms for method: ${method}`));
    }, timeoutMs);

    const unsub = onMessage(acpProc, (msg) => {
      if (String(msg.id) === rpcId) {
        clearTimeout(timer);
        unsub();
        resolve(msg);
      }
    });
  });
}

/**
 * Kill an ACP agent process.
 */
export function killAgent(acpProc: AcpProcess): void {
  if (acpProc.alive && acpProc.proc.pid) {
    acpProc.proc.kill('SIGTERM');
    // Force kill after 5s if still alive
    setTimeout(() => {
      if (acpProc.alive) {
        acpProc.proc.kill('SIGKILL');
      }
    }, 5000);
  }
  acpProc.alive = false;
  processes.delete(acpProc.id);
  messageListeners.delete(acpProc.id);
  requestListeners.delete(acpProc.id);
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
        console.log(`[ACP] Auto-approving permission: ${JSON.stringify(params.toolCall ?? {}).slice(0, 200)}`);
        sendResponse(acpProc, req.id, { outcome: { selected: { optionId: 'allow_once' } } });
        return;
      }

      // ── Unknown methods: auto-approve for backwards compat ──
      default: {
        console.log(`[ACP] Auto-approving unknown agent request: ${method} (id=${req.id})`);
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

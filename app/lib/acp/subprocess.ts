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
    // Auto-approve everything — we trust agents spawned by MindOS.
    // Log for debugging.
    console.log(`[ACP] Auto-approving agent request: ${req.method} (id=${req.id})`);
    sendResponse(acpProc, req.id, {});
  });
}

/* ── Internal — agent command resolution moved to agent-descriptors.ts ─ */

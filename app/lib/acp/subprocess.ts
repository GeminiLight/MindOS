/**
 * ACP Subprocess Manager — Spawn and communicate with ACP agent processes.
 * ACP agents communicate via JSON-RPC 2.0 over stdio (stdin/stdout).
 */

import { spawn, type ChildProcess } from 'child_process';
import type {
  AcpJsonRpcRequest,
  AcpJsonRpcResponse,
  AcpRegistryEntry,
  AcpTransportType,
} from './types';

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface AcpProcess {
  id: string;
  agentId: string;
  proc: ChildProcess;
  alive: boolean;
}

type MessageCallback = (msg: AcpJsonRpcResponse) => void;

/* ── State ─────────────────────────────────────────────────────────────── */

const processes = new Map<string, AcpProcess>();
const messageListeners = new Map<string, Set<MessageCallback>>();
let rpcIdCounter = 1;

/* ── Public API ────────────────────────────────────────────────────────── */

/**
 * Spawn an ACP agent subprocess.
 */
export function spawnAcpAgent(
  entry: AcpRegistryEntry,
  options?: { env?: Record<string, string> },
): AcpProcess {
  const { cmd, args } = buildCommand(entry);

  const mergedEnv = {
    ...process.env,
    ...(entry.env ?? {}),
    ...(options?.env ?? {}),
  };

  const proc = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: mergedEnv,
    shell: false,
  });

  const id = `acp-${entry.id}-${Date.now()}`;
  const acpProc: AcpProcess = { id, agentId: entry.id, proc, alive: true };

  processes.set(id, acpProc);
  messageListeners.set(id, new Set());

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
        const msg = JSON.parse(trimmed) as AcpJsonRpcResponse;
        const listeners = messageListeners.get(id);
        if (listeners) {
          for (const cb of listeners) cb(msg);
        }
      } catch {
        // Not valid JSON — skip (could be agent debug output)
      }
    }
  });

  proc.on('close', () => {
    acpProc.alive = false;
    messageListeners.delete(id);
  });

  proc.on('error', () => {
    acpProc.alive = false;
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

/* ── Internal ──────────────────────────────────────────────────────────── */

function buildCommand(entry: AcpRegistryEntry): { cmd: string; args: string[] } {
  const transport: AcpTransportType = entry.transport;

  switch (transport) {
    case 'npx':
      return { cmd: 'npx', args: [entry.command, ...(entry.args ?? [])] };
    case 'uvx':
      return { cmd: 'uvx', args: [entry.command, ...(entry.args ?? [])] };
    case 'binary':
    case 'stdio':
    default:
      return { cmd: entry.command, args: entry.args ?? [] };
  }
}

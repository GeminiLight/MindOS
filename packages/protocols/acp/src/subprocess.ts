/**
 * ACP Subprocess Manager — Spawn ACP agent processes and create SDK connections.
 * Process lifecycle (spawn, kill, cleanup) remains here.
 * All JSON-RPC protocol handling is delegated to @agentclientprotocol/sdk.
 */

import { execSync, spawn, type ChildProcess } from 'child_process';
import { Readable, Writable } from 'node:stream';
import path from 'path';
import os from 'os';
import fs from 'fs';
import {
  ClientSideConnection,
  ndJsonStream,
  RequestError,
  type Client,
  type SessionNotification,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
  type CreateTerminalRequest,
  type CreateTerminalResponse,
  type TerminalOutputRequest,
  type TerminalOutputResponse,
  type KillTerminalRequest,
  type KillTerminalResponse,
  type WaitForTerminalExitRequest,
  type WaitForTerminalExitResponse,
  type ReleaseTerminalRequest,
  type ReleaseTerminalResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
} from '@agentclientprotocol/sdk';
import type { AcpRegistryEntry } from './types.js';
import { resolveAgentCommand, findUserOverride, type AcpAgentOverride } from './agent-descriptors.js';
import { resolveCommandPathSync } from './detect-local.js';

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface AcpProcess {
  id: string;
  agentId: string;
  proc: ChildProcess;
  alive: boolean;
  spawnError?: string;
  exitCode?: number | null;
}

/**
 * Mutable callbacks container — session layer swaps handlers
 * for each prompt/promptStream call.
 */
export interface AcpClientCallbacks {
  onSessionUpdate?: (params: SessionNotification) => void;
}

export interface AcpConnection {
  connection: ClientSideConnection;
  callbacks: AcpClientCallbacks;
  process: AcpProcess;
}

export interface AcpLaunchOptions {
  env?: Record<string, string>;
  cwd?: string;
  overrides?: Record<string, AcpAgentOverride>;
}

/* ── State ─────────────────────────────────────────────────────────────── */

const processes = new Map<string, AcpProcess>();
// Track cleanup timers to prevent leaks when killAgent is called multiple times
const cleanupTimers = new Map<string, NodeJS.Timeout[]>();

/* ── Public API — Process Lifecycle ───────────────────────────────────── */

/**
 * Spawn an ACP agent subprocess and create an SDK connection.
 * Returns both the process handle and the SDK ClientSideConnection.
 */
export function spawnAndConnect(
  entry: AcpRegistryEntry,
  options?: AcpLaunchOptions,
): AcpConnection {
  const proc = spawnAcpAgent(entry, options);
  const cwd = options?.cwd ?? process.cwd();
  const callbacks: AcpClientCallbacks = {};

  const client = createMindosClient(proc, cwd, callbacks);

  const output = Writable.toWeb(proc.proc.stdin!) as WritableStream<Uint8Array>;
  const input = Readable.toWeb(proc.proc.stdout!) as ReadableStream<Uint8Array>;
  const stream = ndJsonStream(output, input);

  const connection = new ClientSideConnection(() => client, stream);

  connection.signal.addEventListener('abort', () => {
    if (proc.alive) {
      proc.alive = false;
    }
  });

  return { connection, callbacks, process: proc };
}

/**
 * Spawn an ACP agent subprocess (low-level — prefer spawnAndConnect).
 */
export function spawnAcpAgent(
  entry: AcpRegistryEntry,
  options?: AcpLaunchOptions,
): AcpProcess {
  const userOverride = findUserOverride(entry.id, options?.overrides);
  const resolved = resolveAgentCommand(entry.id, entry, userOverride);
  const { cmd, args } = { cmd: resolveCommandPathSync(resolved.cmd) ?? resolved.cmd, args: resolved.args };

  const mergedEnv = {
    ...process.env,
    ...(entry.env ?? {}),
    ...(resolved.env ?? {}),
    ...(options?.env ?? {}),
  };

  const isWin = process.platform === 'win32';

  const proc = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: mergedEnv,
    // Windows: detached requires shell:true to create new process group
    // Unix: detached with shell:false creates new process group
    shell: isWin,
    detached: true,
    ...(options?.cwd ? { cwd: options.cwd } : {}),
  });

  const id = `acp-${entry.id}-${Date.now()}`;
  const acpProc: AcpProcess = { id, agentId: entry.id, proc, alive: true };

  processes.set(id, acpProc);

  let stderrBuf = '';
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString();
    if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096);
  });

  proc.on('close', (code) => {
    acpProc.alive = false;
    acpProc.exitCode = code;
    if (code && code !== 0) {
      acpProc.spawnError = stderrBuf.trim().slice(0, 500) || `Process exited with code ${code}`;
      console.error(`[ACP] ${entry.id} exited with code ${code}: ${acpProc.spawnError}`);
    }
  });

  proc.on('error', (err) => {
    acpProc.alive = false;
    acpProc.spawnError = err.message;
    console.error(`[ACP] ${entry.id} spawn error:`, err.message);
  });

  return acpProc;
}

/**
 * Kill an ACP agent process and its entire process tree.
 * On Windows, uses taskkill /T for tree kill; on Unix, uses negative PID.
 * CRITICAL: Terminals must be killed BEFORE the parent process to prevent leaks.
 */
export function killAgent(acpProc: AcpProcess): void {
  const pid = acpProc.proc.pid;
  if (!pid) {
    acpProc.alive = false;
    processes.delete(acpProc.id);
    clearCleanupTimers(acpProc.id);
    return;
  }

  // Clear any existing cleanup timers from previous killAgent calls
  clearCleanupTimers(acpProc.id);
  const timers: NodeJS.Timeout[] = [];

  // Step 1: Kill all terminals first to prevent orphaned processes
  const terms = terminalMaps.get(acpProc.id);
  if (terms) {
    for (const entry of terms.values()) {
      if (entry.child.exitCode === null) {
        try {
          entry.child.kill('SIGTERM');
          // Force kill after 1 second if still alive
          const timer = setTimeout(() => {
            if (entry.child.exitCode === null) {
              try { entry.child.kill('SIGKILL'); } catch { /* already dead */ }
            }
          }, 1000);
          timers.push(timer);
        } catch { /* already dead */ }
      }
    }
    terminalMaps.delete(acpProc.id);
  }

  // Step 2: Kill the parent ACP agent process
  const isWin = process.platform === 'win32';

  if (isWin) {
    // Windows: Use taskkill /T to kill process tree
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    } catch {
      // Process already dead or taskkill unavailable
    }
  } else {
    // Unix: Use negative PID to kill process group
    try { process.kill(-pid, 'SIGTERM'); } catch { /* already dead */ }
    const timer = setTimeout(() => {
      try {
        process.kill(-pid, 0);
        process.kill(-pid, 'SIGKILL');
      } catch { /* already dead */ }
    }, 3000);
    timers.push(timer);
  }

  // Track timers for cleanup
  if (timers.length > 0) {
    cleanupTimers.set(acpProc.id, timers);
  }

  // Step 3: Clean up process tracking
  acpProc.alive = false;
  processes.delete(acpProc.id);
}

/**
 * Clear all cleanup timers for a given process ID.
 */
function clearCleanupTimers(processId: string): void {
  const timers = cleanupTimers.get(processId);
  if (timers) {
    timers.forEach(timer => clearTimeout(timer));
    cleanupTimers.delete(processId);
  }
}

export function getProcess(id: string): AcpProcess | undefined {
  return processes.get(id);
}

export function getActiveProcesses(): AcpProcess[] {
  return [...processes.values()].filter(p => p.alive);
}

export function killAllAgents(): void {
  const snapshot = [...processes.values()];
  for (const proc of snapshot) {
    killAgent(proc);
  }
}

/* ── Client Implementation ─────────────────────────────────────────────── */

function createMindosClient(
  proc: AcpProcess,
  cwd: string,
  callbacks: AcpClientCallbacks,
): Client {
  return {
    async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
      console.log(`[ACP] Auto-approve permission: agent=${proc.agentId} ${JSON.stringify(params.toolCall ?? params).slice(0, 200)}`);
      const options = params.options ?? [];
      const selected =
        options.find(o => o.kind === 'allow_once') ??
        options.find(o => o.kind === 'allow_always') ??
        options[0];
      return { outcome: { outcome: 'selected', optionId: selected?.optionId ?? 'allow_once' } };
    },

    async sessionUpdate(params: SessionNotification): Promise<void> {
      callbacks.onSessionUpdate?.(params);
    },

    async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
      if (!params.path) throw RequestError.invalidParams(undefined, 'path is required');
      if (isSensitivePath(params.path)) {
        throw new RequestError(-32001, `Access denied: ${params.path} is a sensitive file`);
      }
      try {
        let content = fs.readFileSync(params.path, 'utf-8');
        if (params.line != null || params.limit != null) {
          const lines = content.split('\n');
          const start = ((params.line ?? 1) - 1);
          const end = params.limit != null ? start + params.limit : lines.length;
          content = lines.slice(Math.max(0, start), end).join('\n');
        }
        return { content };
      } catch (err) {
        // Type-safe error handling with proper guards
        const isNodeError = (e: unknown): e is NodeJS.ErrnoException => {
          return typeof e === 'object' && e !== null && 'code' in e;
        };
        if (isNodeError(err) && err.code === 'ENOENT') {
          throw RequestError.resourceNotFound(params.path);
        }
        if (isNodeError(err) && (err.code === 'EACCES' || err.code === 'EPERM')) {
          throw new RequestError(-32001, `Permission denied: ${params.path}`);
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new RequestError(-32603, `Failed to read ${params.path}: ${message}`);
      }
    },

    async writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
      if (!params.path) throw RequestError.invalidParams(undefined, 'path is required');
      if (!isWithinAllowedWritePaths(params.path, cwd)) {
        throw new RequestError(-32001, `Write denied: ${params.path} is outside the working directory`);
      }
      try {
        const dir = path.dirname(params.path);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(params.path, params.content, 'utf-8');
        return {};
      } catch (err) {
        // Type-safe error handling with proper guards
        const isNodeError = (e: unknown): e is NodeJS.ErrnoException => {
          return typeof e === 'object' && e !== null && 'code' in e;
        };
        if (isNodeError(err) && (err.code === 'EACCES' || err.code === 'EPERM')) {
          throw new RequestError(-32001, `Write permission denied: ${params.path}`);
        }
        if (isNodeError(err) && err.code === 'ENOSPC') {
          throw new RequestError(-32603, `Disk full: cannot write ${params.path}`);
        }
        const message = err instanceof Error ? err.message : String(err);
        throw RequestError.internalError(undefined, message);
      }
    },

    async createTerminal(params: CreateTerminalRequest): Promise<CreateTerminalResponse> {
      if (!params.command) throw RequestError.invalidParams(undefined, 'command is required');

      const requestedCwd = params.cwd ?? undefined;
      const terminalCwd = requestedCwd && isWithinAllowedWritePaths(requestedCwd, cwd)
        ? requestedCwd
        : cwd;

      const envObj: Record<string, string> = {};
      if (params.env) {
        for (const v of params.env) envObj[v.name] = v.value;
      }

      console.log(`[ACP] terminal/create: agent=${proc.agentId} cmd="${params.command} ${(params.args ?? []).join(' ')}" cwd=${terminalCwd}`);

      const terminalId = `term-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const outputByteLimit = params.outputByteLimit ?? 1_000_000;

      try {
        const child = spawn(params.command, params.args ?? [], {
          cwd: terminalCwd,
          env: { ...process.env, ...envObj },
          shell: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

      let output = '';
      let truncated = false;
      const collect = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.length > outputByteLimit) {
          // ACP spec: truncate from the beginning, keeping most recent output
          output = output.slice(-outputByteLimit);
          truncated = true;
        }
      };
        child.stdout?.on('data', collect);
        child.stderr?.on('data', collect);

        const terminalMap = getOrCreateTerminalMap(proc.id);
        terminalMap.set(terminalId, { child, output: () => output, truncated: () => truncated });

        return { terminalId };
      } catch (err) {
        throw RequestError.internalError(undefined, (err as Error).message);
      }
    },

    async terminalOutput(params: TerminalOutputRequest): Promise<TerminalOutputResponse> {
      const terminal = getTerminal(proc.id, params.terminalId);
      if (!terminal) throw new RequestError(-32002, `Terminal not found: ${params.terminalId}`);
      const exitStatus = terminal.child.exitCode !== null
        ? { exitCode: terminal.child.exitCode, signal: terminal.child.signalCode }
        : undefined;
      return { output: terminal.output(), truncated: terminal.truncated(), exitStatus };
    },

    async killTerminal(params: KillTerminalRequest): Promise<KillTerminalResponse> {
      const terminal = getTerminal(proc.id, params.terminalId);
      if (!terminal) throw new RequestError(-32002, `Terminal not found: ${params.terminalId}`);
      terminal.child.kill('SIGTERM');
      return {};
    },

    async waitForTerminalExit(params: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse> {
      const terminal = getTerminal(proc.id, params.terminalId);
      if (!terminal) throw new RequestError(-32002, `Terminal not found: ${params.terminalId}`);
      if (terminal.child.exitCode !== null) {
        return { exitCode: terminal.child.exitCode, signal: terminal.child.signalCode };
      }
      return new Promise((resolve) => {
        terminal.child.on('exit', (code: number | null, signal: string | null) => {
          resolve({ exitCode: code, signal });
        });
        // Re-check after attaching listener to avoid race condition:
        // if child exited between the check above and .on('exit'), the event already fired.
        if (terminal.child.exitCode !== null) {
          resolve({ exitCode: terminal.child.exitCode, signal: terminal.child.signalCode });
        }
      });
    },

    async releaseTerminal(params: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse> {
      const terminal = getTerminal(proc.id, params.terminalId);
      if (!terminal) throw new RequestError(-32002, `Terminal not found: ${params.terminalId}`);
      if (terminal.child.exitCode === null) terminal.child.kill('SIGTERM');
      removeTerminal(proc.id, params.terminalId);
      return {};
    },

    async extMethod(_method: string, _params: Record<string, unknown>): Promise<Record<string, unknown>> {
      console.log(`[ACP] Auto-approve ext method: agent=${proc.agentId} method=${_method}`);
      return {};
    },

    async extNotification(_method: string, _params: Record<string, unknown>): Promise<void> {
      // Silently accept extension notifications
    },
  };
}

/* ── Path safety ───────────────────────────────────────────────────────── */

const SENSITIVE_PATH_PATTERNS = [
  /[/\\]\.ssh[/\\](id_|config$|authorized_keys|known_hosts)/i,
  /[/\\]\.env(\.[^/\\]*)?$/i,
  /[/\\]credentials\.json$/i,
  /[/\\]\.aws[/\\]credentials$/i,
  /[/\\]\.gnupg[/\\]/i,
];

function isSensitivePath(filePath: string): boolean {
  const normalized = path.resolve(filePath);
  return SENSITIVE_PATH_PATTERNS.some(p => p.test(normalized));
}

function isWithinAllowedWritePaths(filePath: string, cwd: string): boolean {
  const normalized = path.resolve(filePath);
  const allowedRoots = [cwd, os.tmpdir()];
  return allowedRoots.some(root => {
    const normalizedRoot = path.resolve(root);
    return normalized === normalizedRoot || normalized.startsWith(normalizedRoot + path.sep);
  });
}

/* ── Terminal management (per ACP process) ─────────────────────────────── */

interface TerminalEntry {
  child: ChildProcess;
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

/**
 * ACP Subprocess Manager — Spawn ACP agent processes and create SDK connections.
 * Process lifecycle (spawn, kill, cleanup) remains here.
 * All JSON-RPC protocol handling is delegated to @agentclientprotocol/sdk.
 */

import { execFileSync, spawn, type ChildProcess } from 'child_process';
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
import type { AcpPermissionEvent, AcpPermissionOption, AcpRegistryEntry } from './types.js';
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
  onPermissionRequest?: (event: AcpPermissionEvent) => void;
  onPermissionResolved?: (event: AcpPermissionEvent) => void;
  resolvePermissionRequest?: (input: {
    event: AcpPermissionEvent;
    params: RequestPermissionRequest;
    mode: AcpConcretePermissionMode;
  }) => Promise<RequestPermissionResponse | undefined> | RequestPermissionResponse | undefined;
}

export interface AcpConnection {
  connection: ClientSideConnection;
  callbacks: AcpClientCallbacks;
  process: AcpProcess;
}

export type AcpConcretePermissionMode = 'readonly' | 'ask' | 'auto' | 'full';
export type AcpPermissionMode = AcpConcretePermissionMode | 'agent';

export interface AcpLaunchOptions {
  env?: Record<string, string>;
  cwd?: string;
  overrides?: Record<string, AcpAgentOverride>;
  permissionMode?: AcpPermissionMode;
  resolvePermissionRequest?: AcpClientCallbacks['resolvePermissionRequest'];
}

export interface TerminalSpawnSpec {
  command: string;
  shell: boolean;
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
  const callbacks: AcpClientCallbacks = {
    resolvePermissionRequest: options?.resolvePermissionRequest,
  };

  const client = createMindosClient(proc, cwd, callbacks, options?.permissionMode ?? 'auto', options?.env);

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
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
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

function createPermissionRequestId(
  proc: AcpProcess,
  params: RequestPermissionRequest,
  requestedAt: string,
): string {
  const toolCallId = params.toolCall?.toolCallId ?? 'tool';
  return `${proc.id}:${params.sessionId}:${toolCallId}:${Date.parse(requestedAt) || Date.now()}`;
}

function buildPermissionEvent(input: {
  requestId: string;
  params: RequestPermissionRequest;
  status: AcpPermissionEvent['status'];
  requestedAt: string;
}): AcpPermissionEvent {
  const toolCall = input.params.toolCall;
  return {
    requestId: input.requestId,
    sessionId: input.params.sessionId,
    toolCallId: toolCall?.toolCallId ?? '',
    toolName: permissionToolName(toolCall),
    status: input.status,
    options: normalizePermissionOptions(input.params.options),
    requestedAt: input.requestedAt,
  };
}

function normalizePermissionOptions(options: RequestPermissionRequest['options']): AcpPermissionOption[] {
  return (options ?? [])
    .map((option) => ({
      id: option.optionId,
      label: option.name,
      kind: option.kind,
    }))
    .filter((option) => option.id && option.label);
}

function permissionToolName(toolCall: RequestPermissionRequest['toolCall'] | undefined): string {
  if (!toolCall) return 'tool';
  if (typeof toolCall.title === 'string' && toolCall.title.trim()) return toolCall.title.trim();
  if (typeof toolCall.kind === 'string' && toolCall.kind.trim()) return toolCall.kind.trim();
  return 'tool';
}

function resolvePermissionEvent(
  pending: AcpPermissionEvent,
  response: RequestPermissionResponse,
): AcpPermissionEvent {
  const selectedOptionId = response.outcome.outcome === 'selected'
    ? response.outcome.optionId
    : undefined;
  const selectedOption = selectedOptionId
    ? pending.options.find((option) => option.id === selectedOptionId)
    : undefined;
  return {
    ...pending,
    status: 'resolved',
    ...(selectedOptionId ? { selectedOptionId } : {}),
    outcome: response.outcome.outcome === 'cancelled'
      ? 'cancelled'
      : selectedOption?.kind ?? 'allow_once',
    resolvedAt: new Date().toISOString(),
  };
}

function normalizeAcpPermissionMode(mode: AcpPermissionMode | undefined): AcpConcretePermissionMode {
  if (mode === 'agent') return 'auto';
  return mode ?? 'auto';
}

function permissionOptionByKind(
  options: RequestPermissionRequest['options'] | undefined,
  kinds: string[],
) {
  for (const kind of kinds) {
    const option = options?.find(o => o.kind === kind);
    if (option) return option;
  }
  return options?.[0];
}

function rejectPermissionResponse(params: RequestPermissionRequest): RequestPermissionResponse {
  const selected = permissionOptionByKind(params.options, ['reject_once', 'reject_always']);
  return selected
    ? { outcome: { outcome: 'selected', optionId: selected.optionId } }
    : { outcome: { outcome: 'cancelled' } };
}

function allowPermissionResponse(
  params: RequestPermissionRequest,
  preferredKinds: Array<'allow_once' | 'allow_always'>,
): RequestPermissionResponse {
  const selected = permissionOptionByKind(params.options, preferredKinds);
  return selected
    ? { outcome: { outcome: 'selected', optionId: selected.optionId } }
    : { outcome: { outcome: 'cancelled' } };
}

function permissionResponseAllows(
  params: RequestPermissionRequest,
  response: RequestPermissionResponse,
): boolean {
  const outcome = response.outcome;
  if (outcome.outcome === 'cancelled') return false;
  const selected = params.options?.find(option => option.optionId === outcome.optionId);
  return selected?.kind.startsWith('allow') === true;
}

async function resolveAcpPermissionRequest(input: {
  proc: AcpProcess;
  params: RequestPermissionRequest;
  callbacks: AcpClientCallbacks;
  permissionMode: AcpPermissionMode;
  reason: string;
}): Promise<RequestPermissionResponse> {
  const requestedAt = new Date().toISOString();
  const requestId = createPermissionRequestId(input.proc, input.params, requestedAt);
  const pendingEvent = buildPermissionEvent({
    requestId,
    params: input.params,
    status: 'pending',
    requestedAt,
  });
  input.callbacks.onPermissionRequest?.(pendingEvent);

  const mode = normalizeAcpPermissionMode(input.permissionMode);
  let response: RequestPermissionResponse;
  if (mode === 'readonly') {
    console.log(`[ACP] Reject permission in readonly mode: agent=${input.proc.agentId} ${input.reason}`);
    response = rejectPermissionResponse(input.params);
  } else if (mode === 'full') {
    console.log(`[ACP] Full permission auto-approve: agent=${input.proc.agentId} ${input.reason}`);
    response = allowPermissionResponse(input.params, ['allow_always', 'allow_once']);
  } else if (mode === 'auto') {
    console.log(`[ACP] Auto permission approve once: agent=${input.proc.agentId} ${input.reason}`);
    response = allowPermissionResponse(input.params, ['allow_once', 'allow_always']);
  } else {
    console.log(`[ACP] Ask permission via MindOS bridge: agent=${input.proc.agentId} ${input.reason}`);
    try {
      response = await input.callbacks.resolvePermissionRequest?.({
        event: pendingEvent,
        params: input.params,
        mode,
      }) ?? rejectPermissionResponse(input.params);
    } catch (error) {
      console.warn(`[ACP] Permission resolver failed for ${input.proc.agentId}:`, error);
      response = rejectPermissionResponse(input.params);
    }
  }

  input.callbacks.onPermissionResolved?.(resolvePermissionEvent(pendingEvent, response));
  return response;
}

function createHostPermissionRequest(input: {
  proc: AcpProcess;
  sessionId: string;
  toolCallId: string;
  title: string;
  kind: string;
  params: Record<string, unknown>;
}): RequestPermissionRequest {
  return {
    sessionId: input.sessionId,
    toolCall: {
      toolCallId: input.toolCallId,
      title: input.title,
      kind: input.kind,
      status: 'pending',
      rawInput: JSON.stringify(input.params),
    } as RequestPermissionRequest['toolCall'],
    options: [
      { optionId: 'allow_once', kind: 'allow_once', name: 'Allow once' },
      { optionId: 'reject_once', kind: 'reject_once', name: 'Reject' },
    ],
  };
}

export function resolveTerminalSpawn(command: string): TerminalSpawnSpec {
  const resolvedCommand = resolveCommandPathSync(command) ?? command;
  const needsWindowsShell =
    process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(resolvedCommand);

  return {
    command: resolvedCommand,
    shell: needsWindowsShell,
  };
}

/* ── Client Implementation ─────────────────────────────────────────────── */

export function createMindosClient(
  proc: AcpProcess,
  cwd: string,
  callbacks: AcpClientCallbacks,
  permissionMode: AcpPermissionMode = 'auto',
  runtimeEnv: Record<string, string> = {},
): Client {
  const concretePermissionMode = normalizeAcpPermissionMode(permissionMode);

  const ensureAskPermissionForHostAction = async (input: {
    toolCallId: string;
    title: string;
    kind: string;
    params: Record<string, unknown>;
    deniedMessage: string;
  }) => {
    if (concretePermissionMode !== 'ask') return;
    const params = createHostPermissionRequest({
      proc,
      sessionId: `mindos-host:${proc.id}`,
      toolCallId: input.toolCallId,
      title: input.title,
      kind: input.kind,
      params: input.params,
    });
    const response = await resolveAcpPermissionRequest({
      proc,
      params,
      callbacks,
      permissionMode: concretePermissionMode,
      reason: JSON.stringify(input.params).slice(0, 200),
    });
    if (!permissionResponseAllows(params, response)) {
      throw new RequestError(-32001, input.deniedMessage);
    }
  };

  return {
    async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
      return resolveAcpPermissionRequest({
        proc,
        params,
        callbacks,
        permissionMode: concretePermissionMode,
        reason: JSON.stringify(params.toolCall ?? params).slice(0, 200),
      });
    },

    async sessionUpdate(params: SessionNotification): Promise<void> {
      callbacks.onSessionUpdate?.(params);
    },

    async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
      if (!params.path) throw RequestError.invalidParams(undefined, 'path is required');
      const resolvedPath = resolveAcpPath(params.path, cwd);
      if (isSensitivePath(resolvedPath)) {
        throw new RequestError(-32001, `Access denied: ${params.path} is a sensitive file`);
      }
      if (!isWithinAllowedReadPaths(resolvedPath, cwd)) {
        throw new RequestError(-32001, `Read denied: ${params.path} is outside the working directory`);
      }
      try {
        let content = fs.readFileSync(resolvedPath, 'utf-8');
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
      if (concretePermissionMode === 'readonly') {
        throw new RequestError(-32001, `Write denied: ACP readonly mode does not allow writing ${params.path}`);
      }
      const resolvedPath = resolveAcpPath(params.path, cwd);
      if (!isWithinAllowedWritePaths(resolvedPath, cwd)) {
        throw new RequestError(-32001, `Write denied: ${params.path} is outside the working directory`);
      }
      await ensureAskPermissionForHostAction({
        toolCallId: `writeTextFile:${params.path}`,
        title: 'Write file',
        kind: 'edit',
        params: { path: params.path, bytes: params.content.length },
        deniedMessage: `Write denied by permission policy: ${params.path}`,
      });
      try {
        const dir = path.dirname(resolvedPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(resolvedPath, params.content, 'utf-8');
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
      if (concretePermissionMode === 'readonly') {
        throw new RequestError(-32001, 'Terminal denied: ACP readonly mode does not allow terminal execution');
      }

      const requestedCwd = params.cwd ?? undefined;
      const terminalCwd = requestedCwd && isWithinAllowedWritePaths(resolveAcpPath(requestedCwd, cwd), cwd)
        ? resolveAcpPath(requestedCwd, cwd)
        : cwd;

      const envObj: Record<string, string> = {};
      if (params.env) {
        for (const v of params.env) envObj[v.name] = v.value;
      }

      console.log(`[ACP] terminal/create: agent=${proc.agentId} cmd="${params.command} ${(params.args ?? []).join(' ')}" cwd=${terminalCwd}`);

      await ensureAskPermissionForHostAction({
        toolCallId: `createTerminal:${Date.now()}`,
        title: 'Create terminal',
        kind: 'execute',
        params: {
          command: params.command,
          args: params.args ?? [],
          cwd: terminalCwd,
        },
        deniedMessage: `Terminal denied by permission policy: ${params.command}`,
      });

      const terminalId = `term-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const outputByteLimit = params.outputByteLimit ?? 1_000_000;

      try {
        const terminalSpawn = resolveTerminalSpawn(params.command);
        const child = spawn(terminalSpawn.command, params.args ?? [], {
          cwd: terminalCwd,
          env: { ...process.env, ...runtimeEnv, ...envObj },
          shell: terminalSpawn.shell,
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
      await ensureAskPermissionForHostAction({
        toolCallId: `extMethod:${_method}:${Date.now()}`,
        title: `Extension method: ${_method}`,
        kind: 'other',
        params: _params,
        deniedMessage: `Extension method denied by permission policy: ${_method}`,
      });
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

function resolveAcpPath(filePath: string, cwd: string): string {
  return path.resolve(path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath));
}

function isSensitivePath(filePath: string): boolean {
  const normalized = path.resolve(filePath);
  return SENSITIVE_PATH_PATTERNS.some(p => p.test(normalized));
}

function isWithinAllowedReadPaths(filePath: string, cwd: string): boolean {
  const normalized = path.resolve(filePath);
  const normalizedRoot = path.resolve(cwd);
  return normalized === normalizedRoot || normalized.startsWith(normalizedRoot + path.sep);
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

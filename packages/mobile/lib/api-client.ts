/**
 * MindOS API client for mobile.
 * Communicates with the MindOS web server over HTTP.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  FileNode,
  SearchResult,
  HealthResponse,
  ConnectResponse,
  FileSaveResponse,
  FileDeleteResponse,
  FileRenameResponse,
  AgentRuntimesResponse,
  AgentRunsResponse,
  AskUserQuestionAnswer,
  PendingAgentActionsResponse,
  AgentRunCapsuleRecoveryAction,
} from './types';
import { normalizeFilesResponseToTree } from './file-tree';
import type { ConnectionIssueReason } from './connection-diagnostics';
import {
  normalizeMobileContextFeedback,
  normalizeMobileRetrievalReceipts,
  type MobileContextFeedback,
  type MobileContextFeedbackSignal,
  type MobileRetrievalReceipt,
} from './context-feedback';
import {
  clearConnectionAuthToken,
  persistConnectionAuthToken,
  readConnectionAuthToken,
} from './connection-secret-store';

const STORAGE_KEY = 'mindos_server_url';
const TREE_CACHE_KEY = 'mindos_file_tree_cache';
const DEFAULT_TIMEOUT = 15_000;

export type ApiAccessProbe =
  | { ok: true }
  | {
      ok: false;
      reason: 'auth_required' | 'unreachable';
      status?: number;
      message: string;
    };

export interface FileTreeLoadResult {
  tree: FileNode[];
  stale: boolean;
  error?: string;
}

export type ApiConnectionEvent =
  | { type: 'success'; path: string; checkedAt: number }
  | {
      type: 'failure';
      path: string;
      checkedAt: number;
      reason: ConnectionIssueReason;
      message: string;
      status?: number;
    };

type ApiConnectionObserver = (event: ApiConnectionEvent) => void;

class MindOSClient {
  private _baseUrl = '';
  private _authToken = '';
  private connectionObserver: ApiConnectionObserver | null = null;

  get baseUrl() {
    return this._baseUrl;
  }

  get authToken() {
    return this._authToken;
  }

  get hasAuthToken() {
    return this._authToken.length > 0;
  }

  get isConnected() {
    return this._baseUrl.length > 0;
  }

  /** Load saved server URL and optional API token from storage. Call once on app start. */
  async init(): Promise<boolean> {
    const savedUrl = await AsyncStorage.getItem(STORAGE_KEY);
    if (savedUrl) {
      const savedToken = await readConnectionAuthToken();
      this._baseUrl = savedUrl;
      this._authToken = savedToken;
      return true;
    }
    this._authToken = '';
    return false;
  }

  /** Set base URL in memory (does NOT persist). */
  setBaseUrl(url: string): void {
    this._baseUrl = url.replace(/\/+$/, '');
  }

  /** Set API token in memory (does NOT persist). */
  setAuthToken(token?: string): void {
    this._authToken = token?.trim() ?? '';
  }

  /** Persist current base URL and optional token to storage. Call only after verifying connection. */
  async persistServer(): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, this._baseUrl);
      await persistConnectionAuthToken(this._authToken);
    } catch (error) {
      await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
      await clearConnectionAuthToken().catch(() => {});
      throw error;
    }
  }

  /** Clear the saved server URL and token. */
  async disconnect(): Promise<void> {
    this._baseUrl = '';
    this._authToken = '';
    await AsyncStorage.removeItem(STORAGE_KEY);
    await clearConnectionAuthToken();
  }

  setConnectionObserver(observer: ApiConnectionObserver | null): void {
    this.connectionObserver = observer;
  }

  // ---------------------------------------------------------------------------
  // Health & discovery
  // ---------------------------------------------------------------------------

  async health(): Promise<HealthResponse | null> {
    try {
      const res = await this.fetchWithTimeout('/api/health', {
        timeout: 5000,
        notifyConnection: false,
      });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  async getConnectInfo(): Promise<ConnectResponse | null> {
    try {
      const res = await this.fetchWithTimeout('/api/connect', {
        notifyConnection: false,
      });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  /**
   * Probe a protected API route to verify that the server is reachable with the
   * current token. /api/health is intentionally public, so it cannot prove API
   * auth is configured correctly.
   */
  async probeApiAccess(): Promise<ApiAccessProbe> {
    try {
      const res = await this.fetchWithTimeout('/api/files?limit=1', {
        timeout: 5000,
        notifyConnection: false,
      });
      if (res.ok) return { ok: true };
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          reason: 'auth_required',
          status: res.status,
          message: 'Access token required or invalid.',
        };
      }
      return {
        ok: false,
        reason: 'unreachable',
        status: res.status,
        message: `MindOS API returned HTTP ${res.status}.`,
      };
    } catch (e) {
      return {
        ok: false,
        reason: 'unreachable',
        message: e instanceof Error ? e.message : 'MindOS API is unreachable.',
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Files
  // ---------------------------------------------------------------------------

  async getFileTree(): Promise<FileNode[]> {
    const result = await this.getFileTreeWithStatus();
    return result.tree;
  }

  async getFileTreeWithStatus(): Promise<FileTreeLoadResult> {
    try {
      const res = await this.fetchWithTimeout('/api/files');
      if (!res.ok) throw new ApiError(res.status, 'Failed to load files');
      const data = await res.json();
      const tree = normalizeFilesResponseToTree(data);
      // Cache for offline use
      AsyncStorage.setItem(TREE_CACHE_KEY, JSON.stringify(tree)).catch(() => {});
      return { tree, stale: false };
    } catch (e) {
      // Fallback to cached tree when offline
      const cached = await AsyncStorage.getItem(TREE_CACHE_KEY).catch(() => null);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          const tree = normalizeFilesResponseToTree(parsed);
          return {
            tree,
            stale: true,
            error: errorMessage(e, 'Unable to refresh files. Showing cached files.'),
          };
        } catch { /* corrupt cache */ }
      }
      throw e;
    }
  }

  /** Check if a file exists (returns true/false, never throws). */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      const res = await this.fetchWithTimeout(
        `/api/file?path=${enc(filePath)}&op=read_file`,
        { timeout: 5000 },
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  async getFileContent(
    filePath: string,
    signal?: AbortSignal,
  ): Promise<{ content: string; mtime?: number }> {
    const res = await this.fetchWithTimeout(
      `/api/file?path=${enc(filePath)}&op=read_file`,
      { signal },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, readErrorMessage(data, `Failed to read ${filePath}`));
    return data;
  }

  async saveFile(
    filePath: string,
    content: string,
    expectedMtime?: number,
  ): Promise<FileSaveResponse> {
    const res = await this.fetchWithTimeout('/api/file', {
      method: 'POST',
      body: JSON.stringify({
        op: 'save_file',
        path: filePath,
        content,
        expectedMtime,
      }),
    });
    const data = await res.json();
    if (res.status === 409) return { ok: false, error: 'conflict', serverMtime: data.serverMtime };
    if (!res.ok) throw new ApiError(res.status, data.error || 'Save failed');
    return { ok: true, mtime: data.mtime };
  }

  async createFile(filePath: string, content: string): Promise<FileSaveResponse> {
    const res = await this.fetchWithTimeout('/api/file', {
      method: 'POST',
      body: JSON.stringify({
        op: 'create_file',
        path: filePath,
        content,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) return { ok: false, error: 'exists' };
    if (!res.ok) throw new ApiError(res.status, readErrorMessage(data, 'Create failed'));
    return { ok: true, mtime: data.mtime };
  }

  async deleteFile(filePath: string): Promise<FileDeleteResponse> {
    const res = await this.fetchWithTimeout('/api/file', {
      method: 'POST',
      body: JSON.stringify({ op: 'delete_file', path: filePath }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Delete failed' }));
      throw new ApiError(res.status, data.error || 'Delete failed');
    }
    return res.json();
  }

  async renameFile(filePath: string, newName: string): Promise<FileRenameResponse> {
    const res = await this.fetchWithTimeout('/api/file', {
      method: 'POST',
      body: JSON.stringify({ op: 'rename_file', path: filePath, new_name: newName }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Rename failed' }));
      throw new ApiError(res.status, data.error || 'Rename failed');
    }
    return res.json();
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  async search(query: string): Promise<SearchResult[]> {
    const res = await this.fetchWithTimeout(`/api/search?q=${enc(query)}`);
    if (!res.ok) throw new ApiError(res.status, 'Search failed');
    const data = await res.json();
    const results = data.results ?? data;
    if (!Array.isArray(results)) return [];
    return results;
  }

  // ---------------------------------------------------------------------------
  // Agent runtimes
  // ---------------------------------------------------------------------------

  async getAgentRuntimes(options: { force?: boolean } = {}): Promise<AgentRuntimesResponse> {
    const query = options.force ? '?force=1' : '';
    const res = await this.fetchWithTimeout(`/api/agent-runtimes${query}`, { timeout: 10_000 });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(res.status, readErrorMessage(data, 'Failed to load agent runtimes'));
    }
    return {
      runtimes: Array.isArray(data.runtimes) ? data.runtimes : [],
      installed: Array.isArray(data.installed) ? data.installed : [],
      notInstalled: Array.isArray(data.notInstalled) ? data.notInstalled : [],
    };
  }

  async resolveRuntimePermission(input: {
    runId: string;
    requestId: string;
    decision: string;
  }): Promise<{ ok: true }> {
    const res = await this.fetchWithTimeout('/api/agent/runtime-permission', {
      method: 'POST',
      body: JSON.stringify(input),
      timeout: 15_000,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(res.status, readErrorMessage(data, 'Permission request could not be resolved'));
    }
    return { ok: true };
  }

  async getPendingAgentActions(input: { signal?: AbortSignal } = {}): Promise<PendingAgentActionsResponse> {
    const res = await this.fetchWithTimeout('/api/agent/pending-actions', {
      timeout: 10_000,
      signal: input.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(res.status, readErrorMessage(data, 'Failed to load pending agent actions'));
    }
    const permissions = Array.isArray(data.permissions) ? data.permissions : [];
    const questions = Array.isArray(data.questions) ? data.questions : [];
    const automationApprovals = Array.isArray(data.automationApprovals) ? data.automationApprovals : [];
    return {
      permissions,
      questions,
      automationApprovals,
      pendingCount: typeof data.pendingCount === 'number'
        ? data.pendingCount
        : permissions.length + questions.length + automationApprovals.length,
      generatedAt: typeof data.generatedAt === 'number' ? data.generatedAt : Date.now(),
    };
  }

  async resolveAutomationApproval(input: {
    approvalId: string;
    decision: 'allow' | 'deny';
  }): Promise<{ ok: true }> {
    const res = await this.fetchWithTimeout('/api/agent/automation-approval', {
      method: 'POST',
      body: JSON.stringify(input),
      timeout: 15_000,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(res.status, readErrorMessage(data, 'Automation approval could not be resolved'));
    }
    return { ok: true };
  }

  async resolveUserQuestion(input: {
    runId: string;
    toolCallId: string;
    action?: 'answer' | 'cancel';
    answers?: AskUserQuestionAnswer[];
    reason?: string;
  }): Promise<{ ok: true }> {
    const res = await this.fetchWithTimeout('/api/agent/user-question', {
      method: 'POST',
      body: JSON.stringify(input),
      timeout: 15_000,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(res.status, readErrorMessage(data, 'Question could not be resolved'));
    }
    return { ok: true };
  }

  async getAgentRuns(input: {
    chatSessionId?: string;
    rootRunId?: string;
    startedAfter?: number;
    limit?: number;
    includeEvents?: boolean;
    signal?: AbortSignal;
  } = {}): Promise<AgentRunsResponse> {
    const params = new URLSearchParams();
    if (input.chatSessionId) params.set('chatSessionId', input.chatSessionId);
    if (input.rootRunId) params.set('rootRunId', input.rootRunId);
    if (typeof input.startedAfter === 'number' && Number.isFinite(input.startedAfter)) {
      params.set('startedAfter', String(input.startedAfter));
    }
    params.set('limit', String(input.limit ?? 50));
    if (input.includeEvents ?? true) params.set('includeEvents', '1');

    const query = params.toString();
    const res = await this.fetchWithTimeout(`/api/agent-runs${query ? `?${query}` : ''}`, {
      timeout: 10_000,
      signal: input.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(res.status, readErrorMessage(data, 'Failed to load agent activity'));
    }
    return {
      runs: Array.isArray(data.runs) ? data.runs : [],
      events: Array.isArray(data.events) ? data.events : [],
      ...(data.observatory && typeof data.observatory === 'object' && Array.isArray(data.observatory.traces)
        ? { observatory: { traces: data.observatory.traces } }
        : {}),
    };
  }

  async recoverAgentRunCapsule(
    capsuleId: string,
    action: Exclude<AgentRunCapsuleRecoveryAction, 'rollback'>,
  ): Promise<{ planId: string; chatSessionId: string }> {
    const idempotencyKey = `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const planResponse = await this.fetchWithTimeout(
      `/api/agent-run-capsules/${enc(capsuleId)}/recovery`,
      { method: 'POST', body: JSON.stringify({ action, idempotencyKey }), timeout: 15_000 },
    );
    const planPayload = await planResponse.json().catch(() => ({})) as {
      plan?: { id?: string; targetChatSessionId?: string };
      error?: string;
    };
    if (!planResponse.ok || !planPayload.plan?.id) {
      throw new ApiError(planResponse.status, readErrorMessage(planPayload, 'Recovery plan could not be created'));
    }
    const planId = planPayload.plan.id;
    const chatSessionId = planPayload.plan.targetChatSessionId ?? `recovery-${planId}`;
    const turnResponse = await this.fetchWithTimeout(
      `/api/agent/sessions/${enc(chatSessionId)}/turns`,
      {
        method: 'POST',
        body: '{}',
        timeout: 15_000,
        headers: { 'X-MindOS-Recovery-Plan-Id': planId, Accept: 'text/event-stream' },
      },
    );
    if (!turnResponse.ok) {
      const errorPayload = await turnResponse.json().catch(() => ({}));
      throw new ApiError(turnResponse.status, readErrorMessage(errorPayload, 'Recovery run could not be started'));
    }
    return { planId, chatSessionId };
  }

  async getRetrievalReceipts(input: { limit?: number; signal?: AbortSignal } = {}): Promise<MobileRetrievalReceipt[]> {
    const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(20, Math.floor(input.limit!))) : 6;
    const res = await this.fetchWithTimeout(`/api/retrieval-receipts?limit=${limit}`, {
      timeout: 10_000,
      signal: input.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, readErrorMessage(data, 'Failed to load retrieval receipts'));
    return normalizeMobileRetrievalReceipts(data);
  }

  async submitContextFeedback(input: {
    receiptId: string;
    signal: MobileContextFeedbackSignal;
    assetId?: string;
    note?: string;
    expectedPath?: string;
  }): Promise<Record<string, unknown>> {
    return this.postContextFeedback({ action: 'submit', ...input });
  }

  async getContextFeedback(input: { limit?: number; signal?: AbortSignal } = {}): Promise<MobileContextFeedback[]> {
    const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(500, Math.floor(input.limit!))) : 100;
    const res = await this.fetchWithTimeout(`/api/context-feedback?limit=${limit}`, {
      timeout: 10_000,
      signal: input.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, readErrorMessage(data, 'Failed to load context feedback'));
    return normalizeMobileContextFeedback(data);
  }

  async retractContextFeedback(feedbackId: string): Promise<Record<string, unknown>> {
    return this.postContextFeedback({ action: 'retract', feedbackId });
  }

  async reviewStaleContextAsset(input: {
    assetId: string;
    decision: 'keep' | 'deprecate';
    idempotencyKey: string;
    note?: string;
  }): Promise<Record<string, unknown>> {
    return this.postContextFeedback({ action: 'review-stale', ...input });
  }

  private async postContextFeedback(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await this.fetchWithTimeout('/api/context-feedback', {
      method: 'POST',
      body: JSON.stringify(body),
      timeout: 15_000,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, readErrorMessage(data, 'Context feedback could not be saved'));
    return data as Record<string, unknown>;
  }

  // ---------------------------------------------------------------------------
  // Internal fetch wrapper — uses AbortController (RN-compatible, no AbortSignal.timeout)
  // ---------------------------------------------------------------------------

  private fetchWithTimeout(
    path: string,
    opts: {
      method?: string;
      body?: string;
      timeout?: number;
      signal?: AbortSignal;
      notifyConnection?: boolean;
      headers?: Record<string, string>;
    } = {},
  ): Promise<Response> {
    const {
      method = 'GET',
      body,
      timeout = DEFAULT_TIMEOUT,
      signal,
      notifyConnection = true,
      headers: extraHeaders = {},
    } = opts;
    const headers: Record<string, string> = { ...extraHeaders };
    if (body) headers['Content-Type'] = 'application/json';
    if (this._authToken) headers.Authorization = `Bearer ${this._authToken}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // If an external signal is provided, forward its abort
    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    return fetch(`${this._baseUrl}${path}`, {
      method,
      headers,
      body,
      signal: controller.signal,
    })
      .then((res) => {
        if (notifyConnection) this.notifyResponse(path, res);
        return res;
      })
      .catch((error) => {
        if (notifyConnection) {
          this.notifyConnectionFailure({
            path,
            reason: 'connection_lost',
            message: errorMessage(error, 'Network request failed.'),
          });
        }
        throw error;
      })
      .finally(() => clearTimeout(timeoutId));
  }

  private notifyResponse(path: string, res: Response) {
    if (res.ok) {
      this.connectionObserver?.({ type: 'success', path, checkedAt: Date.now() });
      return;
    }

    const failure = classifyConnectionFailure(res.status);
    if (!failure) return;
    this.notifyConnectionFailure({
      path,
      reason: failure,
      status: res.status,
      message: failure === 'auth_required'
        ? 'Access token required or invalid.'
        : `MindOS API returned HTTP ${res.status}.`,
    });
  }

  private notifyConnectionFailure(input: {
    path: string;
    reason: ConnectionIssueReason;
    message: string;
    status?: number;
  }) {
    this.connectionObserver?.({
      type: 'failure',
      checkedAt: Date.now(),
      ...input,
    });
  }
}

function enc(s: string) {
  return encodeURIComponent(s);
}

function readErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback;
  const record = data as { error?: unknown; message?: unknown };
  if (typeof record.message === 'string' && record.message.trim()) return record.message;
  if (typeof record.error === 'string' && record.error.trim()) return record.error;
  return fallback;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return fallback;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function classifyConnectionFailure(status: number): ConnectionIssueReason | null {
  if (status === 401 || status === 403) return 'auth_required';
  if (status === 408 || status >= 500) return 'api_unavailable';
  return null;
}

/** Singleton API client */
export const mindosClient = new MindOSClient();

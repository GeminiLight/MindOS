/**
 * MindOS API client for mobile.
 * Communicates with the MindOS web server over HTTP.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getWorkspaceIdentity, setWorkspaceIdentity, workspaceKey, migrateLegacyWorkspace, serializeWorkspace } from './workspace-storage';
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
  PendingAskUserQuestion,
  PendingAutomationApproval,
  PendingRuntimePermission,
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
const IDENTITY_KEY = 'mindos_connection_identity';
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
  private _rootId = '';
  private epoch = 0;
  private requests = new Set<AbortController>();
  private connectionListeners = new Set<() => void>();

  get rootId() { return this._rootId; }
  get workspaceIdentity() { return getWorkspaceIdentity(); }
  subscribeConnectionChange(listener: () => void): () => void {
    this.connectionListeners.add(listener);
    return () => { this.connectionListeners.delete(listener); };
  }
  private invalidateConnection(): void {
    this.epoch += 1;
    for (const controller of this.requests) controller.abort();
    this.requests.clear();
    setWorkspaceIdentity(this._baseUrl, this._rootId);
    for (const listener of this.connectionListeners) listener();
  }
  setRootId(rootId: string): void {
    if (rootId === this._rootId) return;
    this._rootId = rootId; this.invalidateConnection();
  }
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
      this.setBaseUrl(savedUrl);
      const raw = await AsyncStorage.getItem(IDENTITY_KEY);
      if (raw) {
        try { const saved = JSON.parse(raw); if (saved.url === savedUrl) this.setRootId(saved.rootId ?? ''); } catch { /* keep URL identity */ }
      }
      await migrateLegacyWorkspace(this.workspaceIdentity);
      const savedToken = await readConnectionAuthToken();
      this.setAuthToken(savedToken);
      return true;
    }
    this._authToken = '';
    return false;
  }

  /** Set base URL in memory (does NOT persist). */
  setBaseUrl(url: string): void {
    const next = url.replace(/\/+$/, '');
    if (next === this._baseUrl) return;
    this._baseUrl = next; this._rootId = ''; this._authToken = ''; this.invalidateConnection();
  }

  /** Set API token in memory (does NOT persist). */
  setAuthToken(token?: string): void {
    const next = token?.trim() ?? '';
    if (next === this._authToken) return;
    this._authToken = next; this.invalidateConnection();
  }

  /** Persist current base URL and optional token to storage. Call only after verifying connection. */
  async persistServer(): Promise<void> {
    try {
      const url = this._baseUrl; const rootId = this._rootId; const token = this._authToken;
      await migrateLegacyWorkspace(this.workspaceIdentity);
      await AsyncStorage.setItem(STORAGE_KEY, url);
      await AsyncStorage.setItem(IDENTITY_KEY, JSON.stringify({ url, rootId }));
      await persistConnectionAuthToken(token);
    } catch (error) {
      await AsyncStorage.removeItem(STORAGE_KEY).catch(() => { });
      await clearConnectionAuthToken().catch(() => { });
      throw error;
    }
  }

  /** Clear the saved server URL and token. */
  async disconnect(): Promise<void> {
    this._baseUrl = ''; this._authToken = ''; this._rootId = ''; this.invalidateConnection();
    await AsyncStorage.removeItem(STORAGE_KEY);
    await AsyncStorage.removeItem(IDENTITY_KEY);
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
      return await res.json();
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
      return await res.json();
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
    const scope = this.workspaceIdentity;
    const cacheKey = workspaceKey(TREE_CACHE_KEY, scope);
    try {
      const res = await this.fetchWithTimeout('/api/files');
      if (!res.ok) throw new ApiError(res.status, 'Failed to load files');
      const data = await res.json();
      if (scope !== this.workspaceIdentity) throw new Error('Workspace changed');
      const tree = normalizeFilesResponseToTree(data);
      // Cache for offline use
      AsyncStorage.setItem(cacheKey, JSON.stringify(tree)).catch(() => { });
      return { tree, stale: false };
    } catch (e) {
      if (scope !== this.workspaceIdentity) throw e;
      // Fallback to cached tree when offline
      const cached = await AsyncStorage.getItem(cacheKey).catch(() => null);
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
  async getRecentFiles(): Promise<FileNode[]> {
    const key = workspaceKey('recent-files');
    const scope = this.workspaceIdentity;
    try {
      const response = await this.fetchWithTimeout('/api/recent-files?limit=10');
      if (!response.ok) throw new ApiError(response.status, 'Could not load recent notes');
      const data: unknown = await response.json();
      if (!Array.isArray(data)) throw new Error('Invalid recent notes response');
      const files: FileNode[] = data.filter(item => item && typeof item.path === 'string' && Number.isFinite(item.mtime))
        .map(item => ({ name: item.path.split('/').pop() || item.path, path: item.path, type: 'file', mtime: item.mtime }));
      if (scope !== this.workspaceIdentity) throw new Error('Workspace changed');
      await AsyncStorage.setItem(key, JSON.stringify(files));
      return files;
    } catch (error) {
      if (scope !== this.workspaceIdentity) throw error;
      const raw = await AsyncStorage.getItem(key);
      if (raw) return normalizeFilesResponseToTree(JSON.parse(raw));
      throw error;
    }
  }

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
  ): Promise<{ content: string; mtime?: number; revision?: string; vaultId?: string }> {
    const res = await this.fetchWithTimeout(
      `/api/file?path=${enc(filePath)}&op=read_file`,
      { signal },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, readErrorMessage(data, `Failed to read ${filePath}`));
    return data;
  }

  /** Reader-only fallback. Mutation preflights always use getFileContent and require a live response. */
  async getReadableFile(filePath: string, signal?: AbortSignal): Promise<{ content: string; mtime?: number; revision?: string; vaultId?: string; cached?: boolean }> {
    const scope = this.workspaceIdentity;
    const key = workspaceKey(`reader:${filePath}`, scope);
    try {
      const data = await this.getFileContent(filePath, signal);
      if (scope !== this.workspaceIdentity || signal?.aborted) throw new Error('Workspace changed');
      if (typeof data.content !== 'string') throw new Error('Invalid document response');
      // Keep at most 30 recently read notes, each below 200 KB (UTF-16 upper bound).
      if (data.content.length <= 100_000) {
        await serializeWorkspace(workspaceKey('reader-index', scope), async () => {
          const indexKey = workspaceKey('reader-index', scope);
          const raw = await AsyncStorage.getItem(indexKey);
          const old: string[] = raw ? JSON.parse(raw) : [];
          const next = [key, ...old.filter(k => k !== key)];
          await AsyncStorage.setItem(key, JSON.stringify(data));
          await AsyncStorage.setItem(indexKey, JSON.stringify(next.slice(0, 30)));
          await Promise.all(next.slice(30).map(k => AsyncStorage.removeItem(k)));
        }).catch(() => { });
      }
      return data;
    } catch (error) {
      if (scope !== this.workspaceIdentity || signal?.aborted || (error instanceof ApiError && error.status >= 400 && error.status < 500)) throw error;
      const raw = await AsyncStorage.getItem(key);
      if (!raw) throw error;
      const cached = JSON.parse(raw);
      if (typeof cached.content !== 'string') throw error;
      return { ...cached, cached: true };
    }
  }

  async saveFile(
    filePath: string,
    content: string,
    expectedMtime?: number,
    guard?: { expectedRevision?: string; expectedVaultId?: string },
  ): Promise<FileSaveResponse> {
    const res = await this.fetchWithTimeout('/api/file', {
      method: 'POST',
      body: JSON.stringify({
        op: 'save_file',
        path: filePath,
        content,
        expectedMtime,
        ...guard,
      }),
    });
    const data = await res.json();
    if (res.status === 409) return { ok: false, error: data.error === 'vault_changed' ? 'vault_changed' : 'conflict', serverMtime: data.serverMtime };
    if (!res.ok) throw new ApiError(res.status, data.error || 'Save failed');
    return { ok: true, mtime: data.mtime, revision: data.revision };
  }

  async createFile(filePath: string, content: string, expectedRootId = this._rootId || undefined): Promise<FileSaveResponse> {
    const res = await this.fetchWithTimeout('/api/file', {
      method: 'POST',
      body: JSON.stringify({
        op: 'create_file',
        path: filePath,
        content,
        expectedRootId,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) return { ok: false, error: data.error === 'root_changed' ? 'root_changed' : 'exists' };
    if (!res.ok) throw new ApiError(res.status, readErrorMessage(data, 'Create failed'));
    return { ok: true, mtime: data.mtime, revision: data.revision };
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
    return await res.json();
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
    return await res.json();
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  async search(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
    const res = await this.fetchWithTimeout(`/api/search?q=${enc(query)}`, { signal });
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
    // Current servers answer with the normalized `actions` list (core
    // projection, spec-cross-process-run-events D). Older servers only send
    // the three groups: merge them by createdAt with locally built keys so
    // the sheet keeps working during a mixed-version window (no expiry
    // filtering — the old server already listed only open prompts).
    const actions = Array.isArray(data.actions)
      ? data.actions
      : [
        ...permissions.map((action: PendingRuntimePermission) => ({
          ...action,
          key: `runtime-permission:${action.runId}:${action.requestId}`,
        })),
        ...questions.map((action: PendingAskUserQuestion) => ({
          ...action,
          key: `user-question:${action.runId}:${action.toolCallId}`,
        })),
        ...automationApprovals.map((action: PendingAutomationApproval) => ({
          ...action,
          key: `automation-approval:${action.approvalId}`,
        })),
      ].sort((left: { createdAt?: number }, right: { createdAt?: number }) =>
        (left.createdAt ?? 0) - (right.createdAt ?? 0));
    return {
      permissions,
      questions,
      automationApprovals,
      actions,
      pendingCount: typeof data.pendingCount === 'number'
        ? data.pendingCount
        : actions.length,
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
    /** Lean timeline view: server skips observatory attachments and precomputes `timeline`. */
    view?: 'timeline';
    signal?: AbortSignal;
  } = {}): Promise<AgentRunsResponse> {
    const params = new URLSearchParams();
    if (input.view) params.set('view', input.view);
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
      ...(data.timeline !== undefined ? { timeline: data.timeline } : {}),
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

    const requestEpoch = this.epoch;
    const controller = new AbortController();
    this.requests.add(controller);
    const forwardAbort = () => controller.abort();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // If an external signal is provided, forward its abort
    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', forwardAbort, { once: true });
      }
    }

    return fetch(`${this._baseUrl}${path}`, {
      method,
      headers,
      body,
      signal: controller.signal,
    })
      .then((res) => {
        if (requestEpoch !== this.epoch) throw new Error('Workspace changed');
        if (notifyConnection) this.notifyResponse(path, res);
        return res;
      })
      .catch((error) => {
        if (notifyConnection && !signal?.aborted && requestEpoch === this.epoch) {
          this.notifyConnectionFailure({
            path,
            reason: 'connection_lost',
            message: errorMessage(error, 'Network request failed.'),
          });
        }
        throw error;
      })
      .finally(() => {
        clearTimeout(timeoutId); this.requests.delete(controller);
        signal?.removeEventListener('abort', forwardAbort);
      });
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

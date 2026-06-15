/**
 * Connection state store with heartbeat monitoring.
 */
import { create } from 'zustand';
import { AppState } from 'react-native';
import { mindosClient } from './api-client';
import {
  type ConnectionDiagnosticState,
  type ConnectionIssueReason,
  formatApiAccessError,
  formatConnectionDiagnostic,
} from './connection-diagnostics';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
type ConnectionOperation = 'init' | 'connect' | 'retry' | 'heartbeat' | null;

const HEARTBEAT_INTERVAL = 30_000; // 30 seconds

interface ConnectionState {
  status: ConnectionStatus;
  activeOperation: ConnectionOperation;
  serverUrl: string;
  serverVersion: string;
  hostname: string;
  hasAuthToken: boolean;
  error: string;
  diagnostic?: ConnectionDiagnosticState;
  lastCheckedAt?: number;

  init: () => Promise<void>;
  connect: (url: string, authToken?: string) => Promise<boolean>;
  disconnect: () => Promise<void>;
  checkHealth: () => Promise<boolean>;
  markRequestFailure: (reason: ConnectionIssueReason, message?: string, checkedAt?: number) => void;
  markRequestSuccess: (checkedAt?: number) => void;
  startHeartbeat: () => void;
  stopHeartbeat: () => void;
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let connectionEpoch = 0;

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  status: 'disconnected',
  activeOperation: null,
  serverUrl: '',
  serverVersion: '',
  hostname: '',
  hasAuthToken: false,
  error: '',
  diagnostic: undefined,
  lastCheckedAt: undefined,

  init: async () => {
    const epoch = nextConnectionEpoch();
    let hasSaved = false;
    try {
      hasSaved = await mindosClient.init();
    } catch (error) {
      if (!isCurrentConnection(epoch)) return;
      setConnectionError(set, {
        reason: 'secure_storage_unavailable',
        message: errorMessage(error, 'Could not load the saved access token securely.'),
        serverUrl: '',
      });
      return;
    }
    if (!hasSaved) return;

    const savedUrl = mindosClient.baseUrl;
    set({
      status: 'connecting',
      activeOperation: 'init',
      serverUrl: savedUrl,
      hasAuthToken: mindosClient.hasAuthToken,
      error: '',
      diagnostic: undefined,
    });
    const health = await mindosClient.health();
    if (!isCurrentConnection(epoch, savedUrl)) return;
    if (!health?.ok) {
      setConnectionError(set, {
        reason: 'saved_unreachable',
        serverUrl: savedUrl,
        hasAuthToken: mindosClient.hasAuthToken,
      });
      return;
    }

    const apiAccess = await mindosClient.probeApiAccess();
    if (!isCurrentConnection(epoch, savedUrl)) return;
    if (!apiAccess.ok) {
      const diagnostic = formatApiAccessError(apiAccess.reason);
      set({
        serverVersion: health.version,
        ...buildConnectionErrorState(diagnostic.reason, {
          message: apiAccess.message,
          serverUrl: savedUrl,
          hasAuthToken: mindosClient.hasAuthToken,
        }),
      });
      return;
    }

    const connectInfo = await mindosClient.getConnectInfo();
    if (!isCurrentConnection(epoch, savedUrl)) return;
    set({
      status: 'connected',
      activeOperation: null,
      serverVersion: health.version,
      hostname: connectInfo?.hostname ?? '',
      serverUrl: savedUrl,
      error: '',
      diagnostic: undefined,
      lastCheckedAt: Date.now(),
    });
    get().startHeartbeat();
  },

  connect: async (url: string, authToken?: string) => {
    const normalized = normalizeServerUrl(url);
    if (!normalized) {
      setConnectionError(set, {
        reason: 'invalid_url',
        serverUrl: '',
      });
      return false;
    }

    const epoch = nextConnectionEpoch();
    const trimmedToken = authToken?.trim() ?? '';
    set({
      status: 'connecting',
      activeOperation: 'connect',
      serverUrl: normalized,
      hasAuthToken: Boolean(trimmedToken),
      error: '',
      diagnostic: undefined,
    });

    mindosClient.setBaseUrl(normalized);
    mindosClient.setAuthToken(trimmedToken);
    const health = await mindosClient.health();
    if (!isCurrentConnection(epoch, normalized)) return false;

    if (!health?.ok) {
      mindosClient.setBaseUrl('');
      mindosClient.setAuthToken('');
      setConnectionError(set, {
        reason: 'unreachable',
        serverUrl: '',
        hasAuthToken: false,
      });
      return false;
    }

    const apiAccess = await mindosClient.probeApiAccess();
    if (!isCurrentConnection(epoch, normalized)) return false;
    if (!apiAccess.ok) {
      mindosClient.setBaseUrl('');
      mindosClient.setAuthToken('');
      const diagnostic = formatApiAccessError(apiAccess.reason);
      setConnectionError(set, {
        reason: diagnostic.reason,
        message: apiAccess.message,
        serverUrl: '',
        hasAuthToken: false,
      });
      return false;
    }

    try {
      await mindosClient.persistServer();
    } catch (error) {
      if (!isCurrentConnection(epoch, normalized)) return false;
      mindosClient.setBaseUrl('');
      mindosClient.setAuthToken('');
      setConnectionError(set, {
        reason: 'secure_storage_unavailable',
        message: errorMessage(error, 'Could not save the access token securely.'),
        serverUrl: '',
        hasAuthToken: false,
      });
      return false;
    }
    const connectInfo = await mindosClient.getConnectInfo();
    if (!isCurrentConnection(epoch, normalized)) return false;
    set({
      status: 'connected',
      activeOperation: null,
      serverUrl: normalized,
      serverVersion: health.version,
      hostname: connectInfo?.hostname ?? '',
      hasAuthToken: mindosClient.hasAuthToken,
      error: '',
      diagnostic: undefined,
      lastCheckedAt: Date.now(),
    });
    get().startHeartbeat();
    return true;
  },

  disconnect: async () => {
    nextConnectionEpoch();
    get().stopHeartbeat();
    await mindosClient.disconnect().catch(() => {});
    set({
      status: 'disconnected',
      activeOperation: null,
      serverUrl: '',
      serverVersion: '',
      hostname: '',
      hasAuthToken: false,
      error: '',
      diagnostic: undefined,
      lastCheckedAt: undefined,
    });
  },

  checkHealth: async () => {
    const prevStatus = get().status;
    const currentUrl = mindosClient.baseUrl || get().serverUrl;
    if (!currentUrl) {
      set({ status: 'disconnected', activeOperation: null });
      return false;
    }
    const epoch = nextConnectionEpoch();
    // Don't show "connecting" spinner for background checks
    set({
      activeOperation: prevStatus === 'connected' ? 'heartbeat' : 'retry',
      ...(prevStatus !== 'connected' ? { status: 'connecting' as const } : {}),
    });
    const health = await mindosClient.health();
    if (!isCurrentConnection(epoch, currentUrl)) return false;
    if (!health?.ok) {
      setConnectionError(set, {
        reason: 'connection_lost',
        serverUrl: currentUrl,
        hasAuthToken: mindosClient.hasAuthToken,
      });
      return false;
    }

    const apiAccess = await mindosClient.probeApiAccess();
    if (!isCurrentConnection(epoch, currentUrl)) return false;
    if (!apiAccess.ok) {
      const diagnostic = formatApiAccessError(apiAccess.reason);
      set({
        serverVersion: health.version,
        ...buildConnectionErrorState(diagnostic.reason, {
          message: apiAccess.message,
          serverUrl: currentUrl,
          hasAuthToken: mindosClient.hasAuthToken,
        }),
      });
      return false;
    }

    set({
      status: 'connected',
      activeOperation: null,
      serverUrl: currentUrl,
      serverVersion: health.version,
      hasAuthToken: mindosClient.hasAuthToken,
      error: '',
      diagnostic: undefined,
      lastCheckedAt: Date.now(),
    });
    return true;
  },

  markRequestFailure: (reason, message, checkedAt = Date.now()) => {
    const state = get();
    if (!state.serverUrl && !mindosClient.baseUrl) return;
    if (state.status === 'disconnected' || state.status === 'connecting') return;
    set(buildConnectionErrorState(reason, {
      message,
      checkedAt,
      serverUrl: state.serverUrl || mindosClient.baseUrl,
      hasAuthToken: mindosClient.hasAuthToken,
    }));
  },

  markRequestSuccess: (checkedAt = Date.now()) => {
    const state = get();
    const serverUrl = state.serverUrl || mindosClient.baseUrl;
    if (!serverUrl || state.status === 'disconnected' || state.status === 'connecting') return;
    set({
      status: 'connected',
      activeOperation: null,
      serverUrl,
      hasAuthToken: mindosClient.hasAuthToken,
      error: '',
      diagnostic: undefined,
      lastCheckedAt: checkedAt,
    });
  },

  startHeartbeat: () => {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => {
      const { status } = get();
      // Only heartbeat when app is active and we think we're connected
      if (AppState.currentState === 'active' && (status === 'connected' || status === 'error')) {
        get().checkHealth();
      }
    }, HEARTBEAT_INTERVAL);
  },

  stopHeartbeat: () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  },
}));

mindosClient.setConnectionObserver((event) => {
  const store = useConnectionStore.getState();
  if (event.type === 'success') {
    store.markRequestSuccess(event.checkedAt);
  } else {
    store.markRequestFailure(event.reason, event.message, event.checkedAt);
  }
});

function normalizeServerUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function nextConnectionEpoch(): number {
  connectionEpoch += 1;
  return connectionEpoch;
}

function isCurrentConnection(epoch: number, expectedUrl?: string): boolean {
  if (epoch !== connectionEpoch) return false;
  if (expectedUrl && mindosClient.baseUrl !== expectedUrl) return false;
  return true;
}

function setConnectionError(
  set: (partial: Partial<ConnectionState>) => void,
  input: {
    reason: ConnectionIssueReason;
    message?: string;
    serverUrl?: string;
    hasAuthToken?: boolean;
    checkedAt?: number;
  },
) {
  set(buildConnectionErrorState(input.reason, input));
}

function buildConnectionErrorState(
  reason: ConnectionIssueReason,
  input: {
    message?: string;
    serverUrl?: string;
    hasAuthToken?: boolean;
    checkedAt?: number;
  } = {},
): Partial<ConnectionState> {
  const checkedAt = input.checkedAt ?? Date.now();
  const diagnostic: ConnectionDiagnosticState = {
    reason,
    message: input.message,
    checkedAt,
  };
  const formatted = formatConnectionDiagnostic(diagnostic);
  return {
    status: 'error',
    activeOperation: null,
    serverUrl: input.serverUrl ?? '',
    hasAuthToken: input.hasAuthToken ?? false,
    error: formatted.message,
    diagnostic,
    lastCheckedAt: checkedAt,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return fallback;
}

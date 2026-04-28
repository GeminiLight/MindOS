/**
 * Connection state store with heartbeat monitoring.
 */
import { create } from 'zustand';
import { AppState } from 'react-native';
import { mindosClient } from './api-client';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

const HEARTBEAT_INTERVAL = 30_000; // 30 seconds

interface ConnectionState {
  status: ConnectionStatus;
  serverUrl: string;
  serverVersion: string;
  hostname: string;
  error: string;

  init: () => Promise<void>;
  connect: (url: string) => Promise<boolean>;
  disconnect: () => Promise<void>;
  checkHealth: () => Promise<boolean>;
  startHeartbeat: () => void;
  stopHeartbeat: () => void;
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  status: 'disconnected',
  serverUrl: '',
  serverVersion: '',
  hostname: '',
  error: '',

  init: async () => {
    const hasSaved = await mindosClient.init();
    if (!hasSaved) return;

    set({ status: 'connecting', serverUrl: mindosClient.baseUrl });
    const health = await mindosClient.health();
    if (health?.ok) {
      set({ status: 'connected', serverVersion: health.version });
      get().startHeartbeat();
    } else {
      set({ status: 'error', error: 'Saved server is unreachable' });
    }
  },

  connect: async (url: string) => {
    const normalized = url.replace(/\/+$/, '');
    set({ status: 'connecting', error: '' });

    mindosClient.setBaseUrl(normalized);
    const health = await mindosClient.health();

    if (health?.ok) {
      await mindosClient.persistServer();
      const connectInfo = await mindosClient.getConnectInfo();
      set({
        status: 'connected',
        serverUrl: normalized,
        serverVersion: health.version,
        hostname: connectInfo?.hostname ?? '',
      });
      get().startHeartbeat();
      return true;
    }

    mindosClient.setBaseUrl('');
    set({
      status: 'error',
      serverUrl: '',
      error: 'Unable to connect. Make sure MindOS is running and on the same network.',
    });
    return false;
  },

  disconnect: async () => {
    get().stopHeartbeat();
    await mindosClient.disconnect();
    set({
      status: 'disconnected',
      serverUrl: '',
      serverVersion: '',
      hostname: '',
      error: '',
    });
  },

  checkHealth: async () => {
    const prevStatus = get().status;
    // Don't show "connecting" spinner for background checks
    if (prevStatus !== 'connected') set({ status: 'connecting' });
    const health = await mindosClient.health();
    if (health?.ok) {
      set({ status: 'connected', serverVersion: health.version, error: '' });
      return true;
    }
    set({ status: 'error', error: 'Connection lost' });
    return false;
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

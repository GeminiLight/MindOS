import AsyncStorage from '@react-native-async-storage/async-storage';

export const LEGACY_AUTH_TOKEN_STORAGE_KEY = 'mindos_auth_token';

const SECURE_AUTH_TOKEN_KEY = 'mindos_connection_auth_token';

export interface SecureTokenStoreAdapter {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
}

let secureStoreAdapter: SecureTokenStoreAdapter | null = null;

export function setSecureTokenStoreAdapterForTests(adapter: SecureTokenStoreAdapter | null) {
  secureStoreAdapter = adapter;
}

export async function readConnectionAuthToken(): Promise<string> {
  const adapter = await getSecureStoreAdapter();
  const secureToken = (await adapter.getItemAsync(SECURE_AUTH_TOKEN_KEY))?.trim();
  if (secureToken) return secureToken;

  const legacyToken = (await AsyncStorage.getItem(LEGACY_AUTH_TOKEN_STORAGE_KEY).catch(() => null))?.trim();
  if (!legacyToken) return '';

  await adapter.setItemAsync(SECURE_AUTH_TOKEN_KEY, legacyToken);
  await AsyncStorage.removeItem(LEGACY_AUTH_TOKEN_STORAGE_KEY).catch(() => {});
  return legacyToken;
}

export async function persistConnectionAuthToken(token?: string): Promise<void> {
  const adapter = await getSecureStoreAdapter();
  const trimmed = token?.trim() ?? '';
  if (trimmed) {
    await adapter.setItemAsync(SECURE_AUTH_TOKEN_KEY, trimmed);
    await AsyncStorage.removeItem(LEGACY_AUTH_TOKEN_STORAGE_KEY).catch(() => {});
    return;
  }

  await adapter.deleteItemAsync(SECURE_AUTH_TOKEN_KEY);
  await AsyncStorage.removeItem(LEGACY_AUTH_TOKEN_STORAGE_KEY).catch(() => {});
}

export async function clearConnectionAuthToken(): Promise<void> {
  const adapter = await getSecureStoreAdapter();
  await adapter.deleteItemAsync(SECURE_AUTH_TOKEN_KEY);
  await AsyncStorage.removeItem(LEGACY_AUTH_TOKEN_STORAGE_KEY).catch(() => {});
}

async function getSecureStoreAdapter(): Promise<SecureTokenStoreAdapter> {
  if (secureStoreAdapter) return secureStoreAdapter;

  try {
    const secureStore = await import('expo-secure-store');
    const available = await secureStore.isAvailableAsync?.();
    if (available === false) {
      throw new Error('Secure token storage is not available on this device.');
    }
    return {
      getItemAsync: secureStore.getItemAsync,
      setItemAsync: secureStore.setItemAsync,
      deleteItemAsync: secureStore.deleteItemAsync,
    };
  } catch (error) {
    throw new Error(error instanceof Error && error.message
      ? error.message
      : 'Secure token storage is not available on this device.');
  }
}

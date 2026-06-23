import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8')),
    decryptString: vi.fn((data: Buffer) => data.toString('utf-8').replace(/^encrypted:/, '')),
  },
}));

vi.mock('electron', () => ({
  safeStorage: electronMock.safeStorage,
}));

import { startObsidianSecretStorageBroker, type ObsidianSecretStorageBrokerHandle } from './obsidian-secret-storage-broker';

let broker: ObsidianSecretStorageBrokerHandle | null = null;

async function postJson(url: string, token: string | null, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('Obsidian SecretStorage desktop broker', () => {
  beforeEach(() => {
    electronMock.safeStorage.isEncryptionAvailable.mockReturnValue(true);
    electronMock.safeStorage.encryptString.mockImplementation((plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'));
    electronMock.safeStorage.decryptString.mockImplementation((data: Buffer) => data.toString('utf-8').replace(/^encrypted:/, ''));
  });

  afterEach(async () => {
    await broker?.close();
    broker = null;
    vi.clearAllMocks();
  });

  it('does not start when Electron safeStorage is unavailable', async () => {
    electronMock.safeStorage.isEncryptionAvailable.mockReturnValue(false);

    broker = await startObsidianSecretStorageBroker();

    expect(broker).toBeNull();
  });

  it('encrypts and decrypts through a loopback-only bearer protected HTTP broker', async () => {
    broker = await startObsidianSecretStorageBroker();
    expect(broker).not.toBeNull();
    expect(broker?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(broker?.token).toEqual(expect.any(String));

    const encryptResponse = await postJson(
      `${broker!.url}/v1/obsidian-secret-storage/encrypt`,
      broker!.token,
      { plaintext: 'secret-value' },
    );
    await expect(encryptResponse.json()).resolves.toEqual({
      ok: true,
      data: Buffer.from('encrypted:secret-value', 'utf-8').toString('base64'),
    });
    expect(electronMock.safeStorage.encryptString).toHaveBeenCalledWith('secret-value');

    const decryptResponse = await postJson(
      `${broker!.url}/v1/obsidian-secret-storage/decrypt`,
      broker!.token,
      { data: Buffer.from('encrypted:secret-value', 'utf-8').toString('base64') },
    );
    await expect(decryptResponse.json()).resolves.toEqual({
      ok: true,
      plaintext: 'secret-value',
    });
  });

  it('rejects unauthenticated requests', async () => {
    broker = await startObsidianSecretStorageBroker();

    const response = await postJson(
      `${broker!.url}/v1/obsidian-secret-storage/encrypt`,
      null,
      { plaintext: 'secret-value' },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'unauthorized' });
    expect(electronMock.safeStorage.encryptString).not.toHaveBeenCalled();
  });

  it('caps request bodies before safeStorage is called', async () => {
    broker = await startObsidianSecretStorageBroker({ maxBodyBytes: 32 });

    const response = await postJson(
      `${broker!.url}/v1/obsidian-secret-storage/encrypt`,
      broker!.token,
      { plaintext: 'x'.repeat(128) },
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'request-too-large' });
    expect(electronMock.safeStorage.encryptString).not.toHaveBeenCalled();
  });

  it('does not return safeStorage error details that could contain secret material', async () => {
    broker = await startObsidianSecretStorageBroker();
    electronMock.safeStorage.decryptString.mockImplementation(() => {
      throw new Error('native error included secret-value');
    });

    const response = await postJson(
      `${broker!.url}/v1/obsidian-secret-storage/decrypt`,
      broker!.token,
      { data: Buffer.from('encrypted:secret-value', 'utf-8').toString('base64') },
    );
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain('decrypt-failed');
    expect(body).not.toContain('secret-value');
    expect(body).not.toContain('native error');
  });
});

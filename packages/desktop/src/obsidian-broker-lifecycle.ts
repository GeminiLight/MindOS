/**
 * Obsidian SecretStorage safeStorage broker lifecycle.
 *
 * Extracted from main.ts, which held the handle in a module-level `let`.
 * Startup must never block on it: a broker that is slow or unavailable
 * degrades to "no broker" rather than delaying the local services.
 */
import type { ObsidianSecretStorageBrokerHandle } from './obsidian-secret-storage-broker';
import { startObsidianSecretStorageBroker } from './obsidian-secret-storage-broker';

let obsidianSecretStorageBroker: ObsidianSecretStorageBrokerHandle | null = null;

const OBSIDIAN_SECRET_STORAGE_BROKER_TIMEOUT_MS = 2_500;

export function getObsidianSecretStorageBrokerTimeoutMs(): number {
  const value = Number(process.env.MINDOS_OBSIDIAN_SECRET_STORAGE_BROKER_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0
    ? value
    : OBSIDIAN_SECRET_STORAGE_BROKER_TIMEOUT_MS;
}

function startObsidianSecretStorageBrokerWithTimeout(
  timeoutMs: number,
): Promise<ObsidianSecretStorageBrokerHandle | null> {
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const brokerPromise = Promise.resolve().then(() => startObsidianSecretStorageBroker());

  brokerPromise.then(
    (broker) => {
      if (timedOut && broker) void broker.close();
    },
    (err) => {
      if (timedOut) {
        console.warn(
          '[MindOS] Obsidian SecretStorage safeStorage broker eventually failed after startup moved on:',
          err instanceof Error ? err.message : String(err),
        );
      }
    },
  );

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      reject(new Error(`startup timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timeout.unref?.();
  });

  return Promise.race([brokerPromise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

export async function ensureObsidianSecretStorageBroker(): Promise<ObsidianSecretStorageBrokerHandle | null> {
  if (obsidianSecretStorageBroker) return obsidianSecretStorageBroker;
  if (process.env.MINDOS_DISABLE_OBSIDIAN_SECRET_STORAGE_BROKER === '1') {
    console.info('[MindOS] Obsidian SecretStorage safeStorage broker disabled by env');
    return null;
  }
  try {
    const timeoutMs = getObsidianSecretStorageBrokerTimeoutMs();
    console.info(`[MindOS] Starting Obsidian SecretStorage safeStorage broker (timeout ${timeoutMs}ms)`);
    obsidianSecretStorageBroker = await startObsidianSecretStorageBrokerWithTimeout(timeoutMs);
    if (obsidianSecretStorageBroker) {
      console.info('[MindOS] Obsidian SecretStorage safeStorage broker started');
    }
  } catch (err) {
    console.warn('[MindOS] Obsidian SecretStorage safeStorage broker unavailable:', err instanceof Error ? err.message : String(err));
    obsidianSecretStorageBroker = null;
  }
  return obsidianSecretStorageBroker;
}

export async function stopObsidianSecretStorageBroker(): Promise<void> {
  const broker = obsidianSecretStorageBroker;
  obsidianSecretStorageBroker = null;
  if (!broker) return;
  try {
    await broker.close();
  } catch (err) {
    console.warn('[MindOS] Obsidian SecretStorage safeStorage broker cleanup failed:', err instanceof Error ? err.message : String(err));
  }
}

import { Buffer } from 'node:buffer';
import { managedObsidianBaseUrl, readObsidianJson, untilAbort } from './obsidian-response';
type Options = { baseUrl: string; token: string; pluginId: string; vaultId: string; fingerprint: string; signal: AbortSignal; fetchImpl?: typeof fetch; timeoutMs?: number };
const LIMIT = 1024 * 1024;
/** The plugin cannot choose the target identity, revision, URL, or credential. */
export function createObsidianDataClient(options: Options) {
  const base = managedObsidianBaseUrl(options.baseUrl);
  const binding = { pluginId: options.pluginId, vaultId: options.vaultId, fingerprint: options.fingerprint };
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(binding.pluginId) || !/^[a-f0-9]{64}$/.test(binding.vaultId) || !/^[a-f0-9]{64}$/.test(binding.fingerprint) || !options.token) throw new Error('Invalid plugin configuration binding.');
  const { signal, token } = options;
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('Invalid configuration timeout.');
  const fetchImpl = options.fetchImpl ?? fetch;
  let revision: string | undefined;
  let failed = false;
  let queued = 0;
  let tail: Promise<unknown> = Promise.resolve();
  async function request(data?: unknown, write = false) {
    signal.throwIfAborted();
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    const url = new URL('/api/obsidian-plugins/data', base);
    if (!write) for (const [key, value] of Object.entries(binding)) url.searchParams.set(key, value);
    const response = await untilAbort(fetchImpl(url, { method: write ? 'POST' : 'GET', redirect: 'error', signal: deadline,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-mindos-agent': `obsidian:${binding.pluginId}` },
      ...(write ? { body: JSON.stringify({ ...binding, revision, data }) } : {}),
    }), deadline);
    const result = await readObsidianJson(response, 2 * LIMIT, deadline, 'Plugin configuration');
    if (!response.ok) throw new Error(`Plugin configuration ${typeof result.error === 'string' ? result.error.slice(0, 160) : 'request failed'} (${response.status}).`);
    if (typeof result.revision !== 'string' || !/^[a-f0-9]{64}$/.test(result.revision) || !Object.hasOwn(result, 'data')) throw new Error('Invalid plugin configuration response.');
    revision = result.revision;
    return result.data;
  }
  return Object.freeze({
    async read() {
      if (queued) throw new Error('Configuration writes are pending.');
      if (failed) throw new Error('Reload the plugin editor after a configuration failure.');
      return request();
    },
    async save(data: unknown): Promise<void> {
      signal.throwIfAborted();
      if (!revision) throw new Error('Read plugin configuration before saving.');
      if (failed) throw new Error('Reload the plugin editor after a configuration conflict or failure.');
      if (queued >= 32) throw new Error('Too many pending configuration writes.');
      const json = JSON.stringify(data);
      if (json === undefined) throw new Error('Plugin configuration must be JSON.');
      if (Buffer.byteLength(json) > LIMIT) throw new Error('Plugin configuration size limit exceeded.');
      const snapshot = JSON.parse(json); queued++;
      const write = tail.then(async () => {
        if (failed) throw new Error('Reload the plugin editor after a configuration conflict or failure.');
        try { await request(snapshot, true); } catch (error) { failed = true; throw error; }
      }).finally(() => { queued--; });
      tail = write.catch(() => {});
      await write;
    },
  });
}

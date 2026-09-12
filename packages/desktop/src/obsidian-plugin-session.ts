import { createObsidianDataClient } from './obsidian-data-client';
import { createObsidianDocumentSession, type DocumentApproval } from './obsidian-document-session';
import { assertSamePackage, createObsidianPackageClient, type VerifiedPackage } from './obsidian-package-client';
import { untilAbort } from './obsidian-response';
import { createObsidianVaultClient, type VerifiedVault } from './obsidian-vault-client';

export type PluginApprovalDecision = boolean | 'read-vault';

export type PluginSessionApproval = DocumentApproval & Readonly<{
  pluginName: string; pluginVersion: string; fingerprint: string;
  capabilities: readonly ('document:read' | 'document:write' | 'vault:read' | 'plugin-data:read' | 'plugin-data:write')[];
  optionalCapabilities?: readonly ['vault:read'];
}>;
export type PluginSessionOptions = {
  baseUrl: string; token: string; pluginId: string; filePath: string;
  /** The launching window's lifetime. Abort on navigation, close, crash or mode switch. */
  signal: AbortSignal;
  /** Main-process identity check, not a renderer-supplied boolean. */
  isCurrent: () => boolean;
  /** Native owner approval. Never let plugin code implement this callback. */
  approve: (subject: PluginSessionApproval) => Promise<PluginApprovalDecision>;
  fetchImpl?: typeof fetch; timeoutMs?: number;
};

/**
 * Owns one approved package/document pair. Keep the returned controller in main;
 * only its immutable package and document snapshots may enter a sandboxed view.
 * This coordinates authority, not the Electron process sandbox itself.
 */
export async function prepareObsidianPluginSession(options: PluginSessionOptions) {
  // A pending approval must keep the original window/mode predicate and callbacks.
  options = { ...options };
  const lifetime = new AbortController();
  let closed = false;
  let saving = false;
  let document: Awaited<ReturnType<typeof createObsidianDocumentSession>> = null;
  let approved: PluginSessionApproval | undefined;
  let captured: VerifiedPackage | undefined;
  let vault: VerifiedVault | undefined;
  let vaultClient: ReturnType<typeof createObsidianVaultClient> | undefined;
  let reading: Promise<VerifiedVault> | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    options.signal.removeEventListener('abort', close);
    lifetime.abort(new Error('Plugin session closed.'));
    document?.close();
  };
  const assertCurrent = () => {
    if (closed || options.signal.aborted) { close(); throw new Error('Plugin session closed.'); }
    let valid = false;
    try { valid = options.isCurrent() === true; } catch { /* Failure revokes; never inherit a later valid identity. */ }
    if (!valid) { close(); throw new Error('Plugin session authorization is no longer valid.'); }
  };
  options.signal.addEventListener('abort', close, { once: true });
  try {
    assertCurrent();
    const client = createObsidianPackageClient({ ...options, signal: lifetime.signal });
    const preview = await client.preview();
    assertCurrent();
    document = await createObsidianDocumentSession({
      ...options, signal: lifetime.signal,
      isAuthorized: () => { assertCurrent(); return true; },
      approve: async binding => {
        assertCurrent();
        if (binding.vaultId !== preview.vaultId) throw new Error('Plugin package and document vault changed.');
        const subject: PluginSessionApproval = Object.freeze({ ...binding, fingerprint: preview.fingerprint,
          pluginName: preview.manifest.name, pluginVersion: preview.manifest.version,
          capabilities: Object.freeze(['document:read', 'document:write', 'plugin-data:read', 'plugin-data:write'] as const),
          optionalCapabilities: Object.freeze(['vault:read'] as const),
        });
        const decision = await untilAbort(options.approve(subject), lifetime.signal);
        if (decision !== true && decision !== 'read-vault') return false;
        assertCurrent();
        captured = await client.download(preview);
        assertCurrent();
        approved = decision === 'read-vault' ? Object.freeze({ ...subject,
          capabilities: Object.freeze(['document:read', 'document:write', 'plugin-data:read', 'plugin-data:write', 'vault:read'] as const) }) : subject;
        if (decision === 'read-vault') {
          vaultClient = createObsidianVaultClient({ ...options, vaultId: preview.vaultId, fingerprint: preview.fingerprint, signal: lifetime.signal });
          vault = await vaultClient.read(); assertCurrent();
        }
        return true;
      },
    });
    if (!document) { close(); return null; }
    assertCurrent();
    const activeDocument = document;
    const dataClient = createObsidianDataClient({ ...options, ...approved!, signal: lifetime.signal });
    const checkDataApproval = async () => {
      assertCurrent();
      try { assertSamePackage(await client.preview(), preview); assertCurrent(); }
      catch (error) { close(); throw error; }
    };
    return Object.freeze({
      binding: approved!, package: captured!, vault,
      get snapshot() { return activeDocument.snapshot; },
      async readVault(): Promise<VerifiedVault> {
        assertCurrent();
        if (!vaultClient) throw new Error('Vault read is not approved.');
        // The authenticated reader pins both identifiers on every refresh. Coalesce
        // concurrent trusted requests; no plugin-supplied path or URL enters main.
        reading ??= vaultClient.read().then(value => { assertCurrent(); return value; })
          .catch(error => { close(); throw error; }).finally(() => { reading = undefined; });
        return reading;
      },
      async readPluginData() { await checkDataApproval(); const data = await dataClient.read(); assertCurrent(); return data; },
      async savePluginData(data: unknown) { await checkDataApproval(); await dataClient.save(data); assertCurrent(); },
      setDraft(content: string) { assertCurrent(); activeDocument.setDraft(content); },
      async save() {
        assertCurrent();
        if (saving) throw new Error('A plugin document save is already in progress.');
        // A sticky conflict is local state, not a new request to be preflighted.
        if (activeDocument.snapshot.status === 'conflict') return activeDocument.save();
        if (!activeDocument.snapshot.dirty) return;
        saving = true;
        try {
          // Check the installed package before granting another write. A failed or
          // changed approval subject closes this session instead of silently rebinding.
          try { assertSamePackage(await client.preview(), preview); assertCurrent(); }
          catch (error) { close(); throw error; }
          await activeDocument.save();
          assertCurrent();
        } finally { saving = false; }
      },
      close,
    });
  } catch (error) { close(); throw error; }
}

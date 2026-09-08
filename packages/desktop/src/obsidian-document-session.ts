import { Buffer } from 'node:buffer';
import { managedObsidianBaseUrl, readObsidianJson, untilAbort } from './obsidian-response';

const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 3 * MAX_DOCUMENT_BYTES + 4096;
const SHA256 = /^[a-f0-9]{64}$/;
type DocumentSnapshot = { content: string; revision: string; vaultId: string };
type SessionStatus = 'ready' | 'saving' | 'conflict' | 'closed';
export type DocumentApproval = Readonly<{ filePath: string; pluginId: string; revision: string; vaultId: string }>;
export type ObsidianDocumentSessionOptions = {
  baseUrl: string;
  filePath: string;
  pluginId: string;
  token: string;
  /** Called by the trusted Desktop coordinator, never by the plugin frame. */
  approve: (request: DocumentApproval) => Promise<boolean>;
  /** Recheck the launching window/mode and package approval before each request. */
  isAuthorized: () => boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Optional launching coordinator lifetime, including the initial document read. */
  signal?: AbortSignal;
};
type Request = (body?: Record<string, unknown>, signal?: AbortSignal) => Promise<{ status: number; data: Record<string, unknown> }>;
class DocumentAuthorizationError extends Error {}

/**
 * Main-process transport for ONE owner-approved note. Never expose this object,
 * its request callback, or credentials to a plugin renderer. This is not a package
 * approval or process sandbox; those remain the launching coordinator's job.
 */
class ObsidianDocumentSession {
  #revision: string;
  #savedContent: string;
  #draft: string;
  #status: SessionStatus = 'ready';
  #abort = new AbortController();
  #request: Request;
  #binding: DocumentApproval;

  constructor(snapshot: DocumentSnapshot, binding: DocumentApproval, request: Request) {
    this.#revision = snapshot.revision;
    this.#savedContent = this.#draft = snapshot.content;
    this.#binding = binding;
    this.#request = request;
  }

  get snapshot() {
    return Object.freeze({
      filePath: this.#binding.filePath, content: this.#draft, revision: this.#revision,
      dirty: this.#draft !== this.#savedContent, status: this.#status,
    });
  }

  setDraft(content: string): void {
    this.#assertOpen();
    assertDocument(content);
    this.#draft = content;
  }

  async save(): Promise<void> {
    this.#assertOpen();
    if (this.#status === 'conflict') throw new Error('Document conflict: preserve the draft and reopen the document to reconcile it.');
    if (this.#status === 'saving') throw new Error('A document save is already in progress.');
    if (!this.snapshot.dirty) return;
    const content = this.#draft;
    this.#status = 'saving';
    try {
      const response = await this.#request({
        op: 'save_file', path: this.#binding.filePath, content,
        expectedRevision: this.#revision, expectedVaultId: this.#binding.vaultId,
      }, this.#abort.signal);
      this.#assertOpen();
      if (response.status === 409) this.#status = 'conflict';
      assertSuccess(response);
      if (response.data.ok !== true || typeof response.data.revision !== 'string' || !SHA256.test(response.data.revision)) {
        throw new Error('Invalid save response: cannot confirm that the document was saved.');
      }
      this.#revision = response.data.revision;
      // A later edit may have arrived while the request was in flight.
      this.#savedContent = content;
    } catch (error) {
      if (error instanceof DocumentAuthorizationError) this.close();
      throw error;
    } finally {
      if (this.#status === 'saving') this.#status = 'ready';
    }
  }

  close(): void {
    this.#status = 'closed';
    this.#abort.abort(new Error('Document session is closed.'));
    // Keep the last draft readable for recovery. Aborting cannot undo a write
    // that the server already committed; never claim a late response is saved.
  }

  #assertOpen(): void {
    if (this.#status === 'closed') throw new Error('Document session is closed.');
  }
}

export async function createObsidianDocumentSession(options: ObsidianDocumentSessionOptions): Promise<ObsidianDocumentSession | null> {
  options = { ...options };
  const url = managedObsidianBaseUrl(options.baseUrl);
  const { filePath, pluginId, token } = options;
  if (typeof filePath !== 'string' || filePath.length > 1024 || !/\.md$/i.test(filePath)
    || /[\\:\x00-\x1f]/.test(filePath) || filePath.split('/').some(part => !part || part.startsWith('.'))) {
    throw new Error('Invalid approved Markdown document path.');
  }
  if (typeof pluginId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(pluginId)) throw new Error('Invalid plugin id.');
  if (typeof token !== 'string' || !token) throw new Error('Missing local server authentication.');
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('Invalid request timeout.');
  const fetchImpl = options.fetchImpl ?? fetch;
  const isAuthorized = options.isAuthorized;
  let revoked = false;
  const assertAuthorized = () => {
    if (revoked || typeof isAuthorized !== 'function' || isAuthorized() !== true) {
      revoked = true;
      throw new DocumentAuthorizationError('Document session authorization is no longer valid.');
    }
  };
  const fileUrl = new URL('/api/file', url);
  const readUrl = new URL(fileUrl);
  readUrl.searchParams.set('path', filePath);
  const request: Request = async (body, signal) => {
    assertAuthorized();
    const deadline = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : []), ...(options.signal ? [options.signal] : [])]);
    deadline.throwIfAborted();
    const response = await untilAbort(fetchImpl(body ? fileUrl : readUrl, {
      method: body ? 'POST' : 'GET', redirect: 'error',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-mindos-agent': `obsidian:${pluginId}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: deadline,
    }), deadline);
    const data = await readObsidianJson(response, MAX_RESPONSE_BYTES, deadline, 'Document');
    assertAuthorized();
    return { status: response.status, data };
  };
  const response = await request();
  assertSuccess(response);
  const snapshot = response.data;
  if (typeof snapshot.content !== 'string' || typeof snapshot.revision !== 'string' || !SHA256.test(snapshot.revision)
    || typeof snapshot.vaultId !== 'string' || !SHA256.test(snapshot.vaultId)) {
    throw new Error('Invalid document snapshot: the local server must support versioned document saves.');
  }
  assertDocument(snapshot.content);
  const binding = Object.freeze({ filePath, pluginId, revision: snapshot.revision, vaultId: snapshot.vaultId });
  if (await options.approve(binding) !== true) return null;
  assertAuthorized();
  return new ObsidianDocumentSession(snapshot as DocumentSnapshot, binding, request);
}

function assertDocument(content: string): void {
  if (typeof content !== 'string') throw new Error('Document content must be text.');
  if (Buffer.byteLength(content, 'utf8') > MAX_DOCUMENT_BYTES) throw new Error('Document is too large for the isolated editor (2 MiB limit).');
}

function assertSuccess(response: { status: number; data: Record<string, unknown> }): void {
  if (response.status >= 200 && response.status < 300) return;
  const reason = typeof response.data.error === 'string' ? response.data.error.slice(0, 200) : 'request failed';
  throw new Error(`Document ${reason} (${response.status}).`);
}

import { KNOWLEDGE_WRITE_MAX_BODY_BYTES } from '../body.js';
import { handleBootstrapGet } from '../handlers/bootstrap.js';
import { handleChangesGet, handleChangesPost } from '../handlers/changes.js';
import { handleContextAssetsGet } from '../handlers/context-assets.js';
import { handleContextFeedbackGet, handleContextFeedbackPost } from '../handlers/context-feedback.js';
import { handleGit } from '../handlers/git.js';
import { handleBacklinks, handleGraph } from '../handlers/graph.js';
import { handleInboxDelete, handleInboxGet, handleInboxPost, type InboxSaveInput } from '../handlers/inbox.js';
import { handleRetrievalReceiptsGet } from '../handlers/retrieval-receipts.js';
import { handleSpaceOverviewGet } from '../handlers/space-overview.js';
import { handleWorkflowsGet, handleWorkflowsPost } from '../handlers/workflows.js';
import { defineRoutes } from '../route-table.js';
import type { MindosHttpServices } from '../services.js';

/** Lets the host turn captured binaries (PDF, Word) into companion markdown before the inbox writes them. */
async function expandInboxBody(body: unknown, services: MindosHttpServices): Promise<unknown> {
  const expand = services.knowledgeWrites?.expandInboxFiles;
  if (!expand || !body || typeof body !== 'object') return body;
  const files = (body as { files?: unknown }).files;
  if (!Array.isArray(files)) return body;
  return { ...(body as Record<string, unknown>), files: await expand(files as InboxSaveInput[]) };
}

function writtenPaths(body: unknown, key: 'saved' | 'archived', field: 'path' | 'archivedPath'): string[] {
  const entries = body && typeof body === 'object' ? (body as Record<string, unknown>)[key] : undefined;
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => (entry && typeof entry === 'object' ? (entry as Record<string, unknown>)[field] : undefined))
    .filter((value): value is string => typeof value === 'string');
}

/** Inbox writes always add or remove files, so the tree shape changed whenever anything was written. */
function notifyInboxChange(services: MindosHttpServices, paths: string[]): void {
  if (paths.length > 0) services.knowledgeWrites?.onChanged?.({ treeChanged: true, paths });
}

export const knowledgeRoutes = defineRoutes([
  { id: 'context-assets', method: 'GET', path: '/api/context-assets', auth: 'required',
    handler: ({ query, services }) => handleContextAssetsGet(query, services) },
  { id: 'retrieval-receipts', method: 'GET', path: '/api/retrieval-receipts', auth: 'required',
    handler: ({ query, services }) => handleRetrievalReceiptsGet(query, services) },
  { id: 'context-feedback', method: 'GET', path: '/api/context-feedback', auth: 'required',
    handler: ({ query, services }) => handleContextFeedbackGet(query, { mindRoot: services.mindRoot }) },
  { id: 'context-feedback.mutate', method: 'POST', path: '/api/context-feedback', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleContextFeedbackPost(await readJsonBody(), { mindRoot: services.mindRoot }) },
  { id: 'backlinks', method: 'GET', path: '/api/backlinks', auth: 'required',
    handler: ({ query, services }) => handleBacklinks(query, services) },
  { id: 'graph', method: 'GET', path: '/api/graph', auth: 'required',
    handler: ({ query, services }) => handleGraph(query, services) },
  { id: 'bootstrap', method: 'GET', path: '/api/bootstrap', auth: 'required',
    handler: ({ query, services }) => handleBootstrapGet(query, services) },
  { id: 'inbox', method: 'GET', path: '/api/inbox', auth: 'required',
    handler: ({ services }) => handleInboxGet(services) },
  { id: 'inbox.save', method: 'POST', path: '/api/inbox', auth: 'required',
    handler: async ({ readJsonBody, services }) => {
      const response = handleInboxPost(await expandInboxBody(await readJsonBody(KNOWLEDGE_WRITE_MAX_BODY_BYTES), services), services);
      notifyInboxChange(services, writtenPaths(response.body, 'saved', 'path'));
      return response;
    } },
  { id: 'inbox.archive', method: 'DELETE', path: '/api/inbox', auth: 'required',
    handler: async ({ readJsonBody, services }) => {
      const response = handleInboxDelete(await readJsonBody(KNOWLEDGE_WRITE_MAX_BODY_BYTES), services);
      notifyInboxChange(services, writtenPaths(response.body, 'archived', 'archivedPath'));
      return response;
    } },
  { id: 'workflows', method: 'GET', path: '/api/workflows', auth: 'required',
    handler: ({ services }) => handleWorkflowsGet(services) },
  { id: 'workflows.create', method: 'POST', path: '/api/workflows', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleWorkflowsPost(await readJsonBody(), services) },
  { id: 'space-overview', method: 'GET', path: '/api/space-overview', auth: 'required',
    handler: ({ query, services }) => handleSpaceOverviewGet(query, services) },
  { id: 'git', method: 'GET', path: '/api/git', auth: 'required',
    handler: ({ query, services }) => handleGit(query, services) },
  { id: 'changes', method: 'GET', path: '/api/changes', auth: 'required',
    handler: ({ query, services }) => handleChangesGet(query, services) },
  { id: 'changes.mark-seen', method: 'POST', path: '/api/changes', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleChangesPost(await readJsonBody(), services) },
]);

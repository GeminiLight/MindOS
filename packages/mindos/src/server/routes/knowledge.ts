import { handleBootstrapGet } from '../handlers/bootstrap.js';
import { handleChangesGet, handleChangesPost } from '../handlers/changes.js';
import { handleContextAssetsGet } from '../handlers/context-assets.js';
import { handleContextFeedbackGet, handleContextFeedbackPost } from '../handlers/context-feedback.js';
import { handleGit } from '../handlers/git.js';
import { handleBacklinks, handleGraph } from '../handlers/graph.js';
import { handleInboxDelete, handleInboxGet, handleInboxPost } from '../handlers/inbox.js';
import { handleRetrievalReceiptsGet } from '../handlers/retrieval-receipts.js';
import { handleSpaceOverviewGet } from '../handlers/space-overview.js';
import { handleWorkflowsGet, handleWorkflowsPost } from '../handlers/workflows.js';
import { defineRoutes } from '../route-table.js';

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
    handler: async ({ readJsonBody, services }) => handleInboxPost(await readJsonBody(), services) },
  { id: 'inbox.archive', method: 'DELETE', path: '/api/inbox', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleInboxDelete(await readJsonBody(), services) },
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

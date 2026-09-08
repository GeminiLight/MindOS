import { readWebPassword } from '../auth.js';
import { handleEventsStream } from '../handlers/events.js';
import { handleHealth } from '../handlers/health.js';
import { handleMonitoringGet } from '../handlers/monitoring.js';
import { handleSyncGet, handleSyncPost } from '../handlers/sync.js';
import { handleUninstallPost } from '../handlers/uninstall.js';
import { handleRestartPost, handleUpdateCheckGet, handleUpdatePost, handleUpdateStatusGet } from '../handlers/update.js';
import { json } from '../response.js';
import { defineRoutes } from '../route-table.js';
import { sseFrames } from '../web-response.js';

export const systemRoutes = defineRoutes([
  { id: 'health', method: 'GET', path: '/api/health', auth: 'public',
    handler: ({ services, runtimeRoot }) => handleHealth({
      runtimeRoot: runtimeRoot ?? services.runtimeRoot,
      // Lets the version resolve from the runtime root's package.json when the
      // process was not started through npm (npm_package_version unset).
      projectRoot: services.runtimeRoot ?? runtimeRoot,
      authRequired: Boolean(readWebPassword(services)),
    }) },
  { id: 'events', method: 'GET', path: '/api/events', auth: 'required',
    handler: ({ query, headers, signal, services }) => {
      if (!services.events) return json({ error: 'Server events are not configured' }, { status: 503 });
      const response = handleEventsStream(query, {
        events: services.events,
        getTreeVersion: () => services.getTreeVersion(),
      }, {
        // Aborts on client disconnect so the frame generator unsubscribes promptly.
        signal,
        lastEventId: headers.get('last-event-id'),
      });
      if (!response.ok) return response;
      return { status: response.status, headers: response.headers, body: sseFrames(response.body) };
    } },
  { id: 'monitoring', method: 'GET', path: '/api/monitoring', auth: 'required',
    handler: ({ services }) => handleMonitoringGet(services) },
  { id: 'update-status', method: 'GET', path: '/api/update-status', auth: 'required',
    handler: ({ services }) => handleUpdateStatusGet({ statusPath: services.updateStatusPath }) },
  { id: 'update-check', method: 'GET', path: '/api/update-check', auth: 'required',
    handler: ({ services, runtimeRoot }) => handleUpdateCheckGet({
      projectRoot: services.runtimeRoot ?? runtimeRoot ?? process.cwd(),
    }) },
  { id: 'restart', method: 'POST', path: '/api/restart', auth: 'required',
    handler: ({ services }) => handleRestartPost({ runtimeRoot: services.runtimeRoot }) },
  { id: 'update', method: 'POST', path: '/api/update', auth: 'required',
    handler: ({ services }) => handleUpdatePost({ runtimeRoot: services.runtimeRoot }) },
  { id: 'uninstall', method: 'POST', path: '/api/uninstall', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleUninstallPost(await readJsonBody(), { runtimeRoot: services.runtimeRoot }) },
  { id: 'sync', method: 'GET', path: '/api/sync', auth: 'required',
    handler: () => handleSyncGet() },
  { id: 'sync.action', method: 'POST', path: '/api/sync', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleSyncPost(await readJsonBody(), {
      runtimeRoot: services.runtimeRoot,
      syncDaemon: services.syncDaemon,
      events: services.events,
    }) },
]);

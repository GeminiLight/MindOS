import { handleAutomationEventsGet, handleAutomationEventsPost } from '../handlers/automation-events.js';
import { handleStudioAutomationsGet, handleStudioAutomationsPost } from '../handlers/studio-automations.js';
import { defineRoutes } from '../route-table.js';

export const automationRoutes = defineRoutes([
  { id: 'studio-automations', method: 'GET', path: '/api/studio/automations', auth: 'required',
    handler: ({ services }) => handleStudioAutomationsGet({ mindRoot: services.mindRoot, homeDir: services.homeDir }) },
  { id: 'studio-automations.mutate', method: 'POST', path: '/api/studio/automations', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleStudioAutomationsPost(await readJsonBody(), {
      mindRoot: services.mindRoot,
      homeDir: services.homeDir,
    }) },
  { id: 'studio-automation-events', method: 'GET', path: '/api/studio/automation-events', auth: 'required',
    handler: ({ query, services }) => handleAutomationEventsGet(query, { mindRoot: services.mindRoot }) },
  { id: 'studio-automation-events.emit', method: 'POST', path: '/api/studio/automation-events', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleAutomationEventsPost(await readJsonBody(), { mindRoot: services.mindRoot }) },
]);

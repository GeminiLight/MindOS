import { handleAutomationEventsGet, handleAutomationEventsPost } from '../handlers/automation-events.js';
import { handleStudioAutomationsGet, handleStudioAutomationsPost } from '../handlers/studio-automations.js';
import { defineRoutes } from '../route-table.js';
import type { MindosHttpServices } from '../services.js';

/** Legacy schedule store lives under the home dir; the env override lets tests and hosted setups relocate it. */
function studioAutomationServices(services: MindosHttpServices) {
  return {
    mindRoot: services.mindRoot,
    homeDir: process.env.MINDOS_STUDIO_AUTOMATION_HOME || services.homeDir,
  };
}

export const automationRoutes = defineRoutes([
  { id: 'studio-automations', method: 'GET', path: '/api/studio/automations', auth: 'required',
    handler: ({ services }) => handleStudioAutomationsGet(studioAutomationServices(services)) },
  { id: 'studio-automations.mutate', method: 'POST', path: '/api/studio/automations', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleStudioAutomationsPost(await readJsonBody(), studioAutomationServices(services)) },
  { id: 'studio-automation-events', method: 'GET', path: '/api/studio/automation-events', auth: 'required',
    handler: ({ query, services }) => handleAutomationEventsGet(query, { mindRoot: services.mindRoot }) },
  { id: 'studio-automation-events.emit', method: 'POST', path: '/api/studio/automation-events', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleAutomationEventsPost(await readJsonBody(), { mindRoot: services.mindRoot }) },
]);

import type { MindosRouteAuthGuard, MindosRouteDefinition } from '../route-table.js';
import { a2aRoutes } from './a2a.js';
import { acpRoutes } from './acp.js';
import { agentRoutes } from './agent.js';
import { agentRuntimeRoutes, codexThreadAuthGuard } from './agent-runtimes.js';
import { automationRoutes } from './automations.js';
import { fileRoutes } from './files.js';
import { imRoutes } from './im.js';
import { knowledgeRoutes } from './knowledge.js';
import { mcpRoutes } from './mcp.js';
import { searchRoutes } from './search.js';
import { settingsRoutes } from './settings.js';
import { setupRoutes } from './setup.js';
import { skillRoutes } from './skills.js';
import { systemRoutes } from './system.js';

/**
 * The Product Server route table. Adding a route is one entry in the matching
 * domain file; `MINDOS_SERVER_ROUTES` (contract), the Hono app and the Next
 * delegation all derive from this list.
 */
export const MINDOS_ROUTE_TABLE: MindosRouteDefinition[] = [
  ...systemRoutes,
  ...fileRoutes,
  ...searchRoutes,
  ...knowledgeRoutes,
  ...automationRoutes,
  ...a2aRoutes,
  ...acpRoutes,
  ...agentRoutes,
  ...agentRuntimeRoutes,
  ...imRoutes,
  ...settingsRoutes,
  ...setupRoutes,
  ...mcpRoutes,
  ...skillRoutes,
];

/** Prefixes that stay behind auth even when no route matches (legacy fail-closed behaviour). */
export const MINDOS_ROUTE_AUTH_GUARDS: MindosRouteAuthGuard[] = [codexThreadAuthGuard];

import { MINDOS_ROUTE_TABLE } from './routes/index.js';

export type MindosServerRouteContract = {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';
  path: string;
  auth: 'public' | 'required';
};

export type MindosServerContract = {
  service: 'mindos';
  protocolVersion: 1;
  routes: MindosServerRouteContract[];
};

/**
 * Public route contract, derived from the route table in `./routes/*.ts`.
 * Hosts (Next proxy, mobile, desktop) read this; nobody edits it by hand.
 */
export const MINDOS_SERVER_ROUTES: MindosServerRouteContract[] = MINDOS_ROUTE_TABLE.map(
  ({ id, method, path, auth }) => ({ id, method, path, auth }),
);

export function getMindosServerContract(): MindosServerContract {
  return {
    service: 'mindos',
    protocolVersion: 1,
    routes: MINDOS_SERVER_ROUTES,
  };
}

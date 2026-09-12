import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  MINDOS_WEB_API_ROUTE_OWNERSHIP,
  getMindosWebApiRouteOwnership,
} from '../packages/mindos/src/server/route-ownership';
import { MINDOS_SERVER_ROUTES } from '../packages/mindos/src/server/contract';

const root = resolve(__dirname, '..');
const apiRoot = resolve(root, 'packages/web/app/api');

/**
 * Web-only HTTP methods a delegated route file may export next to its
 * delegations. They are not part of the Product Server contract and are the
 * only non-delegation exports a `mindos-app` file is allowed to carry.
 */
const WEB_ONLY_EXTRA_METHODS: Record<string, string[]> = {
  '/api/tree-version': ['POST'],
  '/api/space-overview': ['POST'],
};

function listRouteFiles(dir: string): string[] {
  const entries = readdirSync(dir).sort();
  const files: string[] = [];

  for (const entry of entries) {
    const absolute = join(dir, entry);
    const stats = statSync(absolute);
    if (stats.isDirectory()) {
      files.push(...listRouteFiles(absolute));
    } else if (entry === 'route.ts') {
      files.push(absolute);
    }
  }

  return files;
}

function routePathFromFile(file: string): string {
  const relativeRoute = relative(apiRoot, file).split(sep).join('/');
  return `/api/${relativeRoute.replace(/\/route\.ts$/, '')}`;
}

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf-8');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `export const GET = delegateToMindos('GET', '/api/x')` pairs, keyed by exported method. */
function delegatedMethods(source: string, path: string): Map<string, string> {
  const pattern = new RegExp(`export const (GET|POST|PUT|PATCH|DELETE|OPTIONS) = delegateToMindos\\('(GET|POST|PUT|PATCH|DELETE|OPTIONS)', '${escapeRegExp(path)}'`, 'g');
  const methods = new Map<string, string>();
  for (const match of source.matchAll(pattern)) methods.set(match[1]!, match[2]!);
  return methods;
}

/** Every HTTP method the file exports, delegated or hand-written. */
function exportedMethods(source: string): string[] {
  return [...source.matchAll(/export (?:const|async function|function) (GET|POST|PUT|PATCH|DELETE|OPTIONS)\b/g)].map((match) => match[1]!);
}

describe('Web API route ownership contract', () => {
  it('classifies every Next API route exactly once', () => {
    const routePaths = listRouteFiles(apiRoot).map(routePathFromFile);
    const registryPaths = MINDOS_WEB_API_ROUTE_OWNERSHIP.map((route) => route.path);

    expect(new Set(registryPaths).size).toBe(registryPaths.length);
    expect(registryPaths.sort()).toEqual(routePaths.sort());

    for (const path of routePaths) {
      expect(getMindosWebApiRouteOwnership(path), path).toBeDefined();
    }
  });

  it('does not keep stale registry entries for deleted route files', () => {
    for (const route of MINDOS_WEB_API_ROUTE_OWNERSHIP) {
      const file = resolve(root, route.webRouteFile);
      expect(existsSync(file), route.path).toBe(true);
    }
  });

  it('keeps product server routes aligned with product-owned Web routes', () => {
    const productServerPaths = new Set(MINDOS_SERVER_ROUTES.map((route) => route.path));
    const productOwned = MINDOS_WEB_API_ROUTE_OWNERSHIP.filter((route) => route.owner === 'product-owned');

    for (const route of productOwned) {
      expect(productServerPaths.has(route.path), route.path).toBe(true);
    }
  });

  it('serves every product-owned non-stream route through the shared Hono route table', () => {
    const registrySource = read('packages/mindos/src/server/route-ownership.ts');
    // The Next-side glue adapter is gone for good; a new route is either delegated, a stream, host-owned or optional.
    expect(registrySource).not.toContain("'next-response'");
    expect(registrySource).not.toContain('const migrated =');

    const productOwned = MINDOS_WEB_API_ROUTE_OWNERSHIP.filter((route) => route.owner === 'product-owned');
    for (const route of productOwned) {
      expect(['mindos-app', 'stream'], route.path).toContain(route.adapter);
    }
    expect(MINDOS_WEB_API_ROUTE_OWNERSHIP.filter((route) => route.adapter === 'mindos-app')).toHaveLength(107);
  });

  it('keeps delegated Web routes as one-line hand-offs with no Next-side glue', () => {
    const delegated = MINDOS_WEB_API_ROUTE_OWNERSHIP.filter((route) => route.adapter === 'mindos-app');

    for (const route of delegated) {
      const source = read(route.webRouteFile);
      expect(source, route.path).toContain('_mindos-adapter');
      expect(source, route.path).not.toContain('toNextResponse(');
      // Handlers are reached only through the route table; a direct (non-type) product import means glue crept back.
      expect(source, route.path).not.toMatch(/^import\s+(?!type\b)[^;]*from ['"]@geminilight\/mindos\/server['"]/m);
      expect(source, route.path).not.toMatch(/\bfrom ['"]node:(fs|child_process|os|net)['"]/);
      expect(source, route.path).not.toMatch(/\bfrom ['"](fs|child_process|os|net)['"]/);

      const extras = WEB_ONLY_EXTRA_METHODS[route.path] ?? [];
      const delegations = delegatedMethods(source, route.path);
      for (const [exported, delegatedAs] of delegations) {
        expect(delegatedAs, `${route.path} exports ${exported} but delegates ${delegatedAs}`).toBe(exported);
      }
      const nonDelegated = exportedMethods(source).filter((method) => !delegations.has(method));
      expect(nonDelegated.sort(), `${route.path} hand-written methods`).toEqual([...extras].sort());
      if (extras.length === 0) {
        expect(source.split('\n').length, route.path).toBeLessThanOrEqual(20);
      }
    }
  });

  it('delegates exactly the method set the route table declares for each mindos-app route', () => {
    const tableMethods = new Map<string, Set<string>>();
    for (const route of MINDOS_SERVER_ROUTES) {
      if (!tableMethods.has(route.path)) tableMethods.set(route.path, new Set());
      tableMethods.get(route.path)!.add(route.method);
    }

    const delegated = MINDOS_WEB_API_ROUTE_OWNERSHIP.filter((route) => route.adapter === 'mindos-app');
    for (const route of delegated) {
      const expected = tableMethods.get(route.path);
      expect(expected, `${route.path} is not in MINDOS_SERVER_ROUTES`).toBeDefined();
      const actual = new Set(delegatedMethods(read(route.webRouteFile), route.path).keys());
      for (const method of expected!) {
        expect(actual.has(method), `${route.path} does not delegate ${method}`).toBe(true);
      }
      // OPTIONS is answered app-wide before routing, so a file may delegate it without a table row.
      const unexpected = [...actual].filter((method) => !expected!.has(method) && method !== 'OPTIONS');
      expect(unexpected, `${route.path} delegates methods the table does not declare`).toEqual([]);
    }
  });

  it('makes every route carry a phase and residual-risk note', () => {
    for (const route of MINDOS_WEB_API_ROUTE_OWNERSHIP) {
      expect(route.phase, route.path).toMatch(/^Phase [1-8]|Host-owned$/);
      expect(route.residualRisk.trim().length, route.path).toBeGreaterThan(20);
    }
  });

  it('does not keep deferred or planned route states in the OpenCode-quality target', () => {
    const registrySource = read('packages/mindos/src/server/route-ownership.ts');

    expect(registrySource).not.toContain("| 'deferred'");
    expect(registrySource).not.toContain("| 'planned'");
    expect(registrySource).not.toContain('const planned =');

    for (const route of MINDOS_WEB_API_ROUTE_OWNERSHIP) {
      expect(route.owner, route.path).not.toBe('deferred');
      expect(route.adapter, route.path).not.toBe('planned');
    }
  });
});

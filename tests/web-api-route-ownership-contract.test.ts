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

  it('keeps migrated product-owned Web routes as thin Product Server adapters', () => {
    const migrated = MINDOS_WEB_API_ROUTE_OWNERSHIP.filter((route) => route.adapter === 'next-response');

    for (const route of migrated) {
      const source = read(route.webRouteFile);
      expect(source, route.path).toContain('@geminilight/mindos/server');
      expect(source, route.path).toContain('toNextResponse');
      expect(source, route.path).not.toMatch(/\bfrom ['"]node:(fs|child_process|os|net)['"]/);
    }
  });

  it('makes every non-migrated route carry a phase and residual-risk note', () => {
    const nonMigrated = MINDOS_WEB_API_ROUTE_OWNERSHIP.filter((route) => route.adapter !== 'next-response');

    for (const route of nonMigrated) {
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

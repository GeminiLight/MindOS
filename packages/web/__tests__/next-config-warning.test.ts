import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import nextConfig from '../next.config';

function collectRouteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const entryPath = resolve(dir, entry);
    if (statSync(entryPath).isDirectory()) return collectRouteFiles(entryPath);
    return entry === 'route.ts' ? [entryPath] : [];
  });
}

describe('next config warning hygiene', () => {
  it('keeps tracing and Turbopack roots aligned with the app standalone layout', () => {
    const appRoot = resolve(__dirname, '..');

    expect(nextConfig.outputFileTracingRoot).toBe(appRoot);
    expect(nextConfig.turbopack?.root).toBe(appRoot);
  });

  it('runs local dev with webpack to preserve the app-root standalone tracing layout under pnpm', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };

    const launcher = readFileSync(resolve(__dirname, '../scripts/next-with-port.mjs'), 'utf-8');

    expect(pkg.scripts?.dev).toContain('node scripts/next-with-port.mjs dev');
    expect(launcher).toContain("'--webpack'");
    expect(pkg.scripts?.dev).not.toContain('npx tsx');
    expect(pkg.scripts?.generate).toBe('tsx scripts/generate-explore.ts');
    expect(pkg.scripts?.prebuild).toContain('tsx scripts/generate-explore.ts');
  });

  it('uses a cross-platform launcher for dev and start port selection', async () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    const launcherPath = resolve(__dirname, '../scripts/next-with-port.mjs');
    const launcherModule = await import('../scripts/next-with-port.mjs') as {
      buildNextArgs: (command: string, env?: Record<string, string | undefined>) => string[];
    };

    expect(pkg.scripts?.dev).toBe('tsx scripts/generate-explore.ts && node scripts/next-with-port.mjs dev');
    expect(pkg.scripts?.start).toBe('node scripts/next-with-port.mjs start');
    expect(`${pkg.scripts?.dev ?? ''}\n${pkg.scripts?.start ?? ''}`).not.toMatch(/\$\{[^}]+:-/);
    expect(existsSync(launcherPath)).toBe(true);

    const launcher = readFileSync(launcherPath, 'utf-8');
    expect(launcher).toContain('MINDOS_WEB_PORT');
    expect(launcher).toContain('3456');
    expect(launcher).toContain('spawn(');
    expect(launcher).not.toContain('shell: true');
    expect(launcherModule.buildNextArgs('dev', {})).toEqual(['dev', '--webpack', '-p', '3456']);
    expect(launcherModule.buildNextArgs('dev', { MINDOS_WEB_PORT: '4567' })).toEqual(['dev', '--webpack', '-p', '4567']);
    expect(launcherModule.buildNextArgs('start', { MINDOS_WEB_PORT: '70000' })).toEqual(['start', '-p', '3456']);
    expect(() => launcherModule.buildNextArgs('build', {})).toThrow(/Unsupported Next.js command/);
  });

  it('suppresses only the known pi-ai dynamic dependency webpack warning', () => {
    const config: {
      ignoreWarnings?: unknown[];
      resolve?: {
        alias?: Record<string, string>;
        extensionAlias?: Record<string, string[]>;
      };
    } = {};
    const webpack = nextConfig.webpack;
    expect(typeof webpack).toBe('function');
    if (typeof webpack !== 'function') return;

    const result = webpack(config, {
      buildId: 'test',
      dev: false,
      isServer: true,
      defaultLoaders: {},
      nextRuntime: 'nodejs',
      webpack: {},
    } as never);

    expect(result.resolve?.extensionAlias?.['.js']).toEqual(['.ts', '.tsx', '.js']);
    expect(result.resolve?.extensionAlias?.['.mjs']).toEqual(['.mts', '.mjs']);
    expect(result.resolve?.extensionAlias?.['.cjs']).toEqual(['.cts', '.cjs']);

    const ignoreWarning = result.ignoreWarnings?.find((entry): entry is (warning: unknown) => boolean => {
      return typeof entry === 'function';
    });
    expect(ignoreWarning).toBeTypeOf('function');
    if (!ignoreWarning) return;

    expect(ignoreWarning({
      message: 'Critical dependency: the request of a dependency is an expression',
      module: { resource: '/repo/node_modules/@earendil-works/pi-ai/dist/providers/openai-codex-responses.js' },
    })).toBe(true);
    expect(ignoreWarning({
      message: 'Critical dependency: the request of a dependency is an expression',
      module: { resource: '/repo/node_modules/some-other-package/index.js' },
    })).toBe(false);
  });

  it('externalizes only PI runtime packages that need Node to handle dynamic probes', () => {
    expect(nextConfig.serverExternalPackages).toContain('@earendil-works/pi-ai');
    expect(nextConfig.serverExternalPackages).toContain('@earendil-works/pi-coding-agent');
    expect(nextConfig.serverExternalPackages).not.toContain('@earendil-works/pi-agent-core');
  });

  it('keeps PI runtime packages out of Desktop startup route module imports', () => {
    const appRoot = resolve(__dirname, '..');
    const startupBoundaryFiles = [
      'app/api/agent/sessions/[sessionId]/turns/route.ts',
      'app/api/agent/_lib/turn-runner.ts',
      'app/api/agent/_lib/turn-runtime-lane.ts',
      'lib/agent/headless.ts',
      'app/api/mcp/agents/route.ts',
      'app/api/settings/list-models/route.ts',
      'app/api/settings/test-key/route.ts',
      'app/api/space-overview/route.ts',
      'lib/compile.ts',
    ];

    for (const relativePath of startupBoundaryFiles) {
      const source = readFileSync(resolve(appRoot, relativePath), 'utf-8');

      expect(source, relativePath).not.toMatch(
        /import\s+(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from ['"]@geminilight\/mindos\/session\/pi-coding-agent['"]/,
      );
      expect(source, relativePath).not.toMatch(
        /import\s+(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from ['"]@earendil-works\/pi-coding-agent['"]/,
      );
      expect(source, relativePath).not.toMatch(
        /import\s+(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from ['"]@earendil-works\/pi-ai['"]/,
      );
      expect(source, relativePath).not.toMatch(
        /import\s+(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from ['"]@\/lib\/agent\/mindos-pi-runtime-host['"]/,
      );
      expect(source, relativePath).not.toMatch(
        /import\s+(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from ['"]@\/lib\/agent\/model['"]/,
      );
    }

    const turnRunnerSource = readFileSync(resolve(appRoot, 'app/api/agent/_lib/turn-runner.ts'), 'utf-8');
    const runtimeLaneSource = readFileSync(resolve(appRoot, 'app/api/agent/_lib/turn-runtime-lane.ts'), 'utf-8');
    const mindosPiRunnerSource = readFileSync(resolve(appRoot, 'app/api/agent/_lib/turn-runner-mindos-pi.ts'), 'utf-8');
    const piSessionStoreSource = readFileSync(resolve(appRoot, 'lib/pi-integration/session-store.ts'), 'utf-8');

    expect(turnRunnerSource).toContain("import { resolveRuntimeTurnLane } from './turn-runtime-lane'");
    expect(runtimeLaneSource).toContain("await import('./turn-runner-mindos-pi')");
    expect(runtimeLaneSource).toContain("await import('./turn-runner-external')");
    expect(mindosPiRunnerSource).toContain(
      "await import('@geminilight/mindos/agent/runtime/adapters/mindos')",
    );
    expect(readFileSync(resolve(appRoot, 'lib/agent/headless.ts'), 'utf-8')).toContain(
      "await import('@geminilight/mindos/agent/runtime/adapters/mindos')",
    );
    expect(readFileSync(resolve(appRoot, 'app/api/mcp/agents/route.ts'), 'utf-8')).toContain(
      "await import('@earendil-works/pi-coding-agent')",
    );
    expect(readFileSync(resolve(appRoot, 'app/api/settings/list-models/route.ts'), 'utf-8')).toContain(
      "await import('@earendil-works/pi-ai')",
    );
    expect(readFileSync(resolve(appRoot, 'app/api/settings/test-key/route.ts'), 'utf-8')).toContain(
      "await import('@earendil-works/pi-ai')",
    );
    expect(readFileSync(resolve(appRoot, 'lib/compile.ts'), 'utf-8')).toContain(
      "await import('@earendil-works/pi-ai')",
    );
    expect(mindosPiRunnerSource).toContain(
      "await import('@/lib/agent/mindos-pi-runtime-host')",
    );
    expect(readFileSync(resolve(appRoot, 'lib/agent/headless.ts'), 'utf-8')).toContain(
      "await import('@/lib/agent/mindos-pi-runtime-host')",
    );
    expect(readFileSync(resolve(appRoot, 'app/api/settings/test-key/route.ts'), 'utf-8')).toContain(
      "await import('@/lib/agent/model')",
    );
    expect(readFileSync(resolve(appRoot, 'lib/compile.ts'), 'utf-8')).toContain(
      "await import('@/lib/agent/model')",
    );
    expect(piSessionStoreSource).not.toContain('@earendil-works/pi-coding-agent');
  });

  it('marks API routes that import Node-only modules as nodejs runtime routes', () => {
    const appRoot = resolve(__dirname, '..');
    const apiRoot = resolve(appRoot, 'app/api');
    const nodeOnlyImport = /from ['"](?:node:)?(?:fs|os|path|stream|child_process|crypto)['"]|import\s+[^;]+from ['"](?:node:)?(?:fs|os|path|stream|child_process|crypto)['"]/;
    const missingRuntime = collectRouteFiles(apiRoot).filter((routeFile) => {
      const source = readFileSync(routeFile, 'utf-8');
      return nodeOnlyImport.test(source) && !source.includes("export const runtime = 'nodejs'");
    });

    expect(missingRuntime.map(file => file.replace(`${appRoot}/`, ''))).toEqual([]);
  });
});

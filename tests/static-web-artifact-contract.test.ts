import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf-8');
}

describe('static Web artifact runtime contract', () => {
  it('has a build step that materializes a static Web artifact under the product package', () => {
    const scriptPath = 'scripts/prepare-static-web.mjs';
    expect(existsSync(resolve(root, scriptPath))).toBe(true);

    const script = read(scriptPath);
    expect(script).toContain('packages/mindos/static-web');
    expect(script).toContain('index.html');
    expect(script).toContain('_next/static');
    expect(script).toContain('static-web-manifest.json');
  });

  it('allows the Bun runtime envelope to use static Web instead of Next standalone', () => {
    const buildBinary = read('scripts/build-bun-binary.mjs');
    const platformPackages = read('scripts/build-platform-packages.mjs');
    const runtimeManifest = read('scripts/runtime-manifest.mjs');

    expect(buildBinary).toContain('static-web/index.html');
    expect(buildBinary).toContain('excludeStandalone');
    expect(buildBinary).not.toContain('Next standalone server not found under runtime root');
    expect(platformPackages).toContain('static-web/index.html');
    expect(runtimeManifest).toContain('static-web/');
  });

  it('starts the Product Server automatically when a static Web artifact is available', () => {
    const constants = read('packages/mindos/bin/lib/constants.js');
    const build = read('packages/mindos/bin/lib/build.js');
    const start = read('packages/mindos/bin/commands/start.js');

    expect(constants).toContain('STATIC_WEB_ROOT');
    expect(build).toContain('hasPrebuiltStaticWeb');
    expect(start).toContain('hasPrebuiltStaticWeb');
    expect(start).toContain('MINDOS_NEXT_STANDALONE');
    expect(start).toContain('createMindosHttpServer');
  });
});

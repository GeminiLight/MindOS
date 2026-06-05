import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');

function readText(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf-8');
}

describe('Desktop release packaging contract', () => {
  it('keeps Linux deb package metadata free of scoped npm package names', () => {
    const config = readText('packages/desktop/electron-builder.yml');

    expect(config).toMatch(/^deb:\n  packageName: mindos-desktop\n  artifactName: mindos-desktop_\$\{version\}_\$\{arch\}\.\$\{ext\}$/m);
    expect(config).not.toContain('@mindos/desktop_${version}_${arch}.${ext}');
  });

  it('builds Windows ARM64 installers with a distinct updater channel and artifact name', () => {
    const workflow = readText('.github/workflows/build-desktop.yml');
    const updater = readText('packages/desktop/src/updater.ts');
    const runtimePrep = readText('packages/desktop/scripts/prepare-mindos-runtime.mjs');

    expect(workflow).toContain('platform: win\n            arch: arm64');
    expect(workflow).toContain('publish_channel: latest-arm64');
    expect(workflow).toContain('--config.publish.channel="${{ matrix.publish_channel }}"');
    expect(workflow).toContain('MindOS-Setup-${VERSION}-arm64.\\${ext}');
    expect(workflow).toContain('MindOS-Setup-${VERSION}.\\${ext}');
    expect(workflow).toContain('packages/desktop/dist/*.blockmap');
    expect(updater).toContain("autoUpdater.channel = 'latest-arm64'");
    expect(runtimePrep).toContain('targetNodePlatform');
    expect(runtimePrep).toContain('targetNodeArch');
    expect(runtimePrep).toContain('RUNTIME_DEPENDENCY_SEEDS');
    expect(runtimePrep).toContain('platform: `${targetNodePlatform}-${targetNodeArch}`');
    expect(runtimePrep).not.toContain("spawnSync('tar', ['xzf', tmpFile");
    expect(runtimePrep).toContain('extractTarGzSafe(tmpFile, nodeDest, 1)');
    expect(runtimePrep).toContain('function resolveTarSymlinkTarget(destDir, entryPath, linkName)');
    expect(runtimePrep).toContain('symlinkSync(safeLinkName, entryPath)');
    expect(runtimePrep).toContain('Expand-Archive -LiteralPath');
    expect(runtimePrep).toContain('Node.js tar entry outside extraction directory');
    expect(runtimePrep).toContain("const symlinkSkipRoots = [path.resolve(dest, 'node')]");
    expect(runtimePrep).toContain('official npm/npx launchers are');
  });

  it('keeps Electron main and preload builds externalized for Node runtime modules', () => {
    const config = readText('packages/desktop/electron.vite.config.ts');

    expect(config).toContain('externalizeDepsPlugin');
    expect(config).toContain('nodeBuiltins');
    expect(config).toContain("include: ['electron']");
    expect(config).toContain('plugins: [externalizeDepsPlugin');
    expect(config).toContain('external: electronMainExternal');
  });

  it('smokes packaged Desktop runtime before release artifacts are uploaded', () => {
    const workflow = readText('.github/workflows/build-desktop.yml');
    const verifier = readText('scripts/verify-desktop-runtime.mjs');
    const smoke = readText('scripts/smoke-desktop-app.mjs');

    expect(workflow).toContain('node scripts/verify-desktop-runtime.mjs');
    expect(workflow).toContain('node scripts/smoke-desktop-app.mjs --skip-if-arch-mismatch --timeout 90000');
    expect(workflow.indexOf('Smoke packaged app')).toBeGreaterThan(workflow.indexOf('Package (${{ matrix.platform }})'));
    expect(workflow.indexOf('Upload artifacts')).toBeGreaterThan(workflow.indexOf('Smoke packaged app'));
    expect(workflow).toContain('electron-builder --${{ matrix.platform }} --${{ matrix.arch }} --publish never');
    expect(workflow).not.toContain('--publish always');
    expect(workflow).toContain('gh release delete-asset "$DESIRED_TAG" "MindOS.Setup.${VERSION}.exe" --yes');
    expect(workflow).toContain('gh release delete-asset "$DESIRED_TAG" "MindOS.Setup.${VERSION}.exe.blockmap" --yes');
    expect(workflow).toContain('gh release upload "$DESIRED_TAG" "${assets[@]}" --clobber');

    expect(verifier).toContain('packages/web/.next/standalone/node_modules/@sinclair/typebox/package.json');
    expect(verifier).toContain('packages/web/.next/standalone/node_modules/@earendil-works/pi-ai/package.json');
    expect(verifier).toContain("import { fileURLToPath } from 'node:url'");
    expect(verifier).toContain("fileURLToPath(new URL('..', import.meta.url))");
    expect(verifier).not.toContain("new URL('..', import.meta.url).pathname");
    expect(verifier).toContain('optional local embedding runtime should not be bundled by default');
    expect(verifier).toContain('@huggingface/transformers/package.json');
    expect(verifier).toContain('dist/protocols/mcp-server/index.cjs');
    expect(verifier).toContain('ERR_MODULE_NOT_FOUND');
    expect(verifier).toContain('Cannot find module');
    expect(verifier).toContain('path.join is not a function');

    expect(smoke).toContain('/api/health');
    expect(smoke).toContain('APPIMAGE_EXTRACT_AND_RUN');
    expect(smoke).toContain("process.platform === 'linux' ? ['--no-sandbox'] : []");
    expect(smoke).toContain("desktopMode: 'local'");
    expect(smoke).toContain('setupPending: false');
    expect(smoke).toContain("join(homedir(), '.mindos', 'config.json')");
    expect(smoke).toContain('restoreSeededConfigs');
    expect(smoke).toContain("detached: process.platform !== 'win32'");
    expect(smoke).toContain("process.kill(-pid, 'SIGTERM')");
    expect(smoke).toContain('process.exit(process.exitCode ?? 0)');
    expect(smoke).toContain("resolve('packages/desktop/dist')");
    expect(smoke).toContain("resolve('dist')");
    expect(smoke).toContain("join(desktopDist, 'linux-unpacked', 'MindOS')");
    expect(smoke).toContain("join(desktopDist, 'linux-unpacked', 'mindos')");
    expect(smoke).toContain('/\\.AppImage$/');
    expect(smoke).toContain('root/login did not return the MindOS HTML shell');
    expect(smoke).toContain('MCP bundle not found');
    expect(smoke).toContain('Cannot find module');
    expect(smoke).toContain('Internal Error');
  });
});

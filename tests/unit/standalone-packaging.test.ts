import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  copyAppForBundledRuntime,
  materializeStandaloneAssets,
} from '../../packages/desktop/scripts/prepare-mindos-bundle.mjs';

let tmpRoots: string[] = [];

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'mindos-standalone-packaging-'));
  tmpRoots.push(dir);
  return dir;
}

function writeFile(path: string, content = '') {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

function writeMindosRuntimeExtensionSources(app: string) {
  for (const rel of [
    'lib/acp/agent-descriptors.ts',
    'lib/agent/ask-user-question-bridge-extension.ts',
    'lib/agent/builtin-extension-runtime.ts',
    'lib/agent/kb-extension.ts',
    'lib/agent/mindos-mcp-adapter-extension.ts',
    'lib/agent/providers.ts',
    'lib/agent/reconnect.ts',
    'lib/agent/subagent-ledger-extension.ts',
    'lib/custom-endpoints.ts',
    'lib/im/index.ts',
    'lib/im/executor.ts',
    'lib/im/adapters/telegram.ts',
    'lib/im/adapters/feishu.ts',
    'lib/im/adapters/slack.ts',
    'lib/im/adapters/discord.ts',
    'lib/mind-root.ts',
    'lib/pi-integration/mcp-config.ts',
    'lib/schedule-prompt/index.ts',
    'lib/settings.ts',
  ]) {
    writeFile(join(app, rel), `// ${rel}`);
  }
}

describe('standalone runtime packaging', () => {
  afterEach(() => {
    for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
    tmpRoots = [];
  });

  it('materializes pnpm symlinked standalone dependencies as real package files', () => {
    const root = tempDir();
    const sourceApp = join(root, 'source-app');
    const destApp = join(root, 'dest-app');
    const realNext = join(sourceApp, 'node_modules', '.pnpm', 'next@16.1.6', 'node_modules', 'next');
    const standaloneNodeModules = join(sourceApp, '.next', 'standalone', 'node_modules');

    writeFile(join(sourceApp, '.next', 'standalone', 'server.js'), 'require("next/dist/server/next")');
    writeFile(join(realNext, 'package.json'), '{"name":"next"}');
    writeFile(join(realNext, 'dist', 'server', 'next.js'), 'module.exports = {}');
    mkdirSync(standaloneNodeModules, { recursive: true });
    symlinkSync(realNext, join(standaloneNodeModules, 'next'));

    copyAppForBundledRuntime(sourceApp, destApp);

    const copiedNext = join(destApp, '.next', 'standalone', 'node_modules', 'next');
    expect(existsSync(join(copiedNext, 'package.json'))).toBe(true);
    expect(readFileSync(join(copiedNext, 'package.json'), 'utf-8')).toContain('"next"');
    expect(lstatSync(copiedNext).isSymbolicLink()).toBe(false);
  });

  it('adds the Next package entry files when standalone tracing only copied dist', () => {
    const root = tempDir();
    const app = join(root, 'app');

    writeFile(join(app, '.next', 'standalone', 'server.js'), 'require("next")');
    writeFile(join(app, '.next', 'standalone', '.next', 'server', 'app', 'page.js'));
    writeFile(join(app, '.next', 'standalone', '.next', 'server', 'app', 'wiki', 'page.js'));
    writeFile(join(app, '.next', 'standalone', '.next', 'server', 'app', 'explore', 'page.js'));
    writeFile(join(app, '.next', 'standalone', '.next', 'server', 'app', 'changelog', 'page.js'));
    writeFile(join(app, '.next', 'standalone', '.next', 'server', 'app', 'setup', 'page.js'));
    writeFile(join(app, '.next', 'standalone', 'scripts', 'extract-pdf.cjs'));
    writeFile(join(app, '.next', 'standalone', 'scripts', 'extract-docx.cjs'));
    writeFile(join(app, '.next', 'standalone', 'node_modules', 'next', 'dist', 'server', 'next.js'), '');
    writeFile(join(app, '.next', 'standalone', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'));
    writeFile(join(app, '.next', 'standalone', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs'));
    writeFile(join(app, '.next', 'standalone', 'node_modules', 'mammoth', 'package.json'), '{"name":"mammoth","version":"1.0.0"}');
    writeFile(join(app, '.next', 'standalone', 'node_modules', 'word-extractor', 'package.json'), '{"name":"word-extractor","version":"1.0.0"}');
    writeFile(join(app, '.next', 'standalone', 'node_modules', 'pi-web-access', 'index.ts'));
    writeFile(join(app, '.next', 'standalone', 'node_modules', 'pi-subagents', 'src', 'extension', 'index.ts'));
    mkdirSync(join(app, '.next', 'standalone', 'node_modules', 'pi-subagents', 'agents'), { recursive: true });
    writeFile(join(app, '.next', 'standalone', 'node_modules', 'pi-mcp-adapter', 'index.ts'));
    writeFile(join(app, '.next', 'standalone', 'node_modules', 'pi-schedule-prompt', 'src', 'tool.ts'));
    writeFile(join(app, '.next', 'standalone', 'node_modules', 'pi-schedule-prompt', 'src', 'storage.ts'));
    writeFile(join(app, '.next', 'standalone', 'node_modules', 'pi-schedule-prompt', 'src', 'scheduler.ts'));
    writeFile(join(app, '.next', 'standalone', 'node_modules', '@juicesharp', 'rpiv-ask-user-question', 'index.ts'));
    writeFile(join(app, '.next', 'static', 'placeholder'));
    writeFile(
      join(app, 'node_modules', 'next', 'package.json'),
      '{"name":"next","main":"./dist/server/next.js","dependencies":{"styled-jsx":"1.0.0","@swc/helpers":"1.0.0"},"peerDependencies":{"react":"1.0.0","react-dom":"1.0.0"}}'
    );
    writeFile(join(app, 'node_modules', 'next', 'server.js'), 'module.exports = require("./dist/server/next")');
    writeFile(join(app, 'node_modules', 'next', 'dist', 'server', 'next.js'), 'module.exports = {}');
    writeFile(join(app, 'node_modules', 'styled-jsx', 'package.json'), '{"name":"styled-jsx","version":"1.0.0"}');
    writeFile(join(app, 'node_modules', '@swc', 'helpers', 'package.json'), '{"name":"@swc/helpers","version":"1.0.0"}');
    writeFile(join(app, 'node_modules', 'react', 'package.json'), '{"name":"react","version":"1.0.0"}');
    writeFile(join(app, 'node_modules', 'react-dom', 'package.json'), '{"name":"react-dom","version":"1.0.0"}');
    writeMindosRuntimeExtensionSources(app);

    materializeStandaloneAssets(app);

    expect(
      readFileSync(
        join(app, '.next', 'standalone', 'node_modules', 'next', 'package.json'),
        'utf-8'
      )
    ).toContain('"main"');
    expect(existsSync(join(app, '.next', 'standalone', 'node_modules', 'next', 'server.js'))).toBe(true);
    expect(existsSync(join(app, '.next', 'standalone', 'node_modules', 'styled-jsx', 'package.json'))).toBe(true);
    expect(existsSync(join(app, '.next', 'standalone', 'node_modules', '@swc', 'helpers', 'package.json'))).toBe(true);
    expect(existsSync(join(app, '.next', 'standalone', 'node_modules', 'react', 'package.json'))).toBe(true);
    expect(existsSync(join(app, '.next', 'standalone', 'node_modules', 'react-dom', 'package.json'))).toBe(true);
  });
});

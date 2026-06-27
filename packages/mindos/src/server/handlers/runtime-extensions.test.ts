import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MINDOS_RUNTIME_EXTENSIONS_ROOT,
  buildAgentRuntimeExtensionPreflight,
  handleAgentRuntimeExtensionInstallPost,
  handleAgentRuntimeExtensionPreflightPost,
  listInstalledAgentRuntimeExtensions,
  type RuntimeExtensionSettings,
} from './runtime-extensions.js';

let mindRoot: string;
let settings: RuntimeExtensionSettings;
let now: Date;

const services = {
  get mindRoot() {
    return mindRoot;
  },
  readSettings: () => settings,
  writeSettings: (next: RuntimeExtensionSettings) => {
    settings = next;
  },
  now: () => now,
};

function aionStyleManifest() {
  return {
    $schema: 'mindos.agent-runtime.extension.v0',
    id: 'aion-style-pack',
    name: 'Aion Style Pack',
    version: '0.1.0',
    description: 'Runtime extension manifest fixture.',
    author: 'MindOS',
    permissions: ['agent.runtime'],
    lifecycle: {
      postInstall: 'scripts/post-install.sh',
    },
    contributes: {
      acpAdapters: [
        {
          id: 'ext-buddy',
          name: 'External Buddy',
          description: 'Extension-provided ACP adapter',
          connectionType: 'cli',
          cliCommand: 'codebuddy',
          acpArgs: ['--acp'],
          supportsStreaming: true,
          models: ['demo-model'],
          outputCapabilities: {
            kinds: ['artifact', 'diff', 'secret-output'],
            fileChanges: true,
            artifacts: true,
          },
          env: { BUDDY_TOKEN: 'must-not-leak' },
          apiKeyFields: [{ key: 'BUDDY_TOKEN', type: 'password' }],
        },
      ],
      commands: [
        { id: 'explain', title: 'Explain Selection', slash: '/explain', runtimeId: 'ext-buddy' },
      ],
      skills: [
        { id: 'code-review', name: 'Code Review', entry: '$file:skills/code-review/SKILL.md' },
      ],
      assistants: [
        { id: 'reviewer', name: 'Reviewer', prompt: '$file:prompts/reviewer.md' },
      ],
      mcpServers: {
        docs: {
          type: 'stdio',
          command: 'mcp-docs',
          env: { API_KEY: 'must-not-leak' },
        },
      },
    },
  };
}

describe('runtime extension install/preflight handlers', () => {
  beforeEach(() => {
    mindRoot = mkdtempSync(join(tmpdir(), 'mindos-runtime-extension-'));
    settings = { mindRoot };
    now = new Date('2026-06-27T00:00:00.000Z');
  });

  afterEach(() => {
    rmSync(mindRoot, { recursive: true, force: true });
  });

  it('preflights AionUI-style contributes without writing or leaking sensitive fields', () => {
    const response = handleAgentRuntimeExtensionPreflightPost(
      {
        manifest: aionStyleManifest(),
        extensionRoot: '/tmp/source-extension',
      },
      services,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      readOnly: true,
      writePolicy: 'preflight-only',
      installable: true,
      extension: {
        id: 'aion-style-pack',
        name: 'Aion Style Pack',
        targetDir: `${MINDOS_RUNTIME_EXTENSIONS_ROOT}/aion-style-pack`,
        alreadyInstalled: false,
        contributionCounts: {
          acpAdapters: 1,
          mcpServers: 1,
          assistants: 1,
          skills: 1,
          commands: 1,
        },
        lifecycleScriptsDeclared: 1,
      },
      acpAgentIds: ['ext-buddy'],
      acpAgentOverrides: {
        'ext-buddy': expect.objectContaining({
          name: 'External Buddy',
          command: 'codebuddy',
          args: ['--acp'],
        }),
      },
    });
    expect(response.body && JSON.stringify(response.body)).not.toContain('must-not-leak');
    expect(response.body && JSON.stringify(response.body)).not.toContain('BUDDY_TOKEN');
    expect(response.body && JSON.stringify(response.body)).not.toContain('resolvedPath');
    expect(existsSync(join(mindRoot, '.mindos'))).toBe(false);
  });

  it('requires confirmation before installing a runtime extension', () => {
    const response = handleAgentRuntimeExtensionInstallPost(
      { manifest: aionStyleManifest() },
      services,
    );

    expect(response).toMatchObject({
      status: 400,
      body: { error: 'Runtime extension install requires explicit confirmation.' },
    });
    expect(settings.acpAgents).toBeUndefined();
  });

  it('installs sanitized manifests atomically and registers ACP adapters in settings', () => {
    const response = handleAgentRuntimeExtensionInstallPost(
      {
        manifest: aionStyleManifest(),
        extensionRoot: '/tmp/source-extension',
        confirm: true,
      },
      services,
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      ok: true,
      installed: {
        id: 'aion-style-pack',
        targetDir: `${MINDOS_RUNTIME_EXTENSIONS_ROOT}/aion-style-pack`,
        manifestPath: `${MINDOS_RUNTIME_EXTENSIONS_ROOT}/aion-style-pack/manifest.json`,
        metadata: {
          source: 'agent-runtime-extension',
          extensionId: 'aion-style-pack',
          installedAt: '2026-06-27T00:00:00.000Z',
          appliedAcpAgents: ['ext-buddy'],
          lifecycleScriptsDeclared: 1,
        },
      },
      acpAgents: {
        'ext-buddy': expect.objectContaining({
          command: 'codebuddy',
          args: ['--acp'],
        }),
      },
    });
    expect(settings.acpAgents?.['ext-buddy']).toMatchObject({
      name: 'External Buddy',
      command: 'codebuddy',
      args: ['--acp'],
      adapterMetadata: expect.objectContaining({
        connectionType: 'cli',
        supportsStreaming: true,
        output: {
          kinds: ['artifact', 'diff', 'text'],
          fileChanges: true,
          artifacts: true,
        },
      }),
    });

    const manifestPath = join(mindRoot, '.mindos', 'runtime-extensions', 'aion-style-pack', 'manifest.json');
    const metadataPath = join(mindRoot, '.mindos', 'runtime-extensions', 'aion-style-pack', 'mindos-runtime-extension.json');
    expect(readFileSync(manifestPath, 'utf-8')).not.toContain('resolvedPath');
    expect(readFileSync(manifestPath, 'utf-8')).not.toContain('must-not-leak');
    expect(readFileSync(metadataPath, 'utf-8')).toContain('"source": "agent-runtime-extension"');

    const listed = listInstalledAgentRuntimeExtensions(mindRoot);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: 'aion-style-pack',
      metadata: {
        appliedAcpAgents: ['ext-buddy'],
      },
    });
  });

  it('updates an installed extension only for ACP adapters previously applied by that extension', () => {
    const first = handleAgentRuntimeExtensionInstallPost(
      {
        manifest: aionStyleManifest(),
        confirm: true,
      },
      services,
    );
    expect(first.status).toBe(201);

    const duplicate = buildAgentRuntimeExtensionPreflight(
      { manifest: aionStyleManifest() },
      services,
    );
    expect(duplicate.installable).toBe(false);
    expect(duplicate.blockedReasons).toContain('Runtime extension is already installed: aion-style-pack');
    expect(duplicate.blockedReasons).toContain('ACP agent already configured: ext-buddy');

    now = new Date('2026-06-28T00:00:00.000Z');
    const updatedManifest = aionStyleManifest();
    updatedManifest.version = '0.2.0';
    updatedManifest.contributes.acpAdapters[0].cliCommand = 'codebuddy-next';
    updatedManifest.contributes.acpAdapters[0].acpArgs = ['--acp', '--workspace'];

    const replacePreflight = buildAgentRuntimeExtensionPreflight(
      { manifest: updatedManifest, replace: true },
      services,
    );
    expect(replacePreflight.installable).toBe(true);

    const replaced = handleAgentRuntimeExtensionInstallPost(
      {
        manifest: updatedManifest,
        confirm: true,
        replace: true,
      },
      services,
    );

    expect(replaced.status).toBe(200);
    expect(replaced.body).toMatchObject({
      ok: true,
      installed: {
        version: '0.2.0',
        metadata: {
          installedAt: '2026-06-27T00:00:00.000Z',
          updatedAt: '2026-06-28T00:00:00.000Z',
        },
      },
      acpAgents: {
        'ext-buddy': expect.objectContaining({
          command: 'codebuddy-next',
          args: ['--acp', '--workspace'],
        }),
      },
    });
  });

  it('blocks built-in ACP adapter overrides and existing ACP id conflicts', () => {
    const builtIn = buildAgentRuntimeExtensionPreflight(
      {
        manifest: {
          id: 'bad-pack',
          name: 'Bad Pack',
          contributes: {
            acpAdapters: [{ id: 'codex', cliCommand: 'fake-codex' }],
          },
        },
      },
      services,
    );
    expect(builtIn.installable).toBe(false);
    expect(builtIn.blockedReasons).toContain('ACP adapter id collides with a built-in agent: codex');

    settings = {
      mindRoot,
      acpAgents: {
        'ext-buddy': { command: 'existing-buddy' },
      },
    };
    const duplicate = buildAgentRuntimeExtensionPreflight(
      { manifest: aionStyleManifest() },
      services,
    );
    expect(duplicate.installable).toBe(false);
    expect(duplicate.blockedReasons).toContain('ACP agent already configured: ext-buddy');
  });

  it('rejects writes when the managed extension root resolves outside mindRoot', () => {
    const outside = mkdtempSync(join(tmpdir(), 'mindos-runtime-extension-outside-'));
    symlinkSync(outside, join(mindRoot, '.mindos'), 'dir');

    const response = handleAgentRuntimeExtensionInstallPost(
      {
        manifest: aionStyleManifest(),
        confirm: true,
      },
      services,
    );

    expect(response).toMatchObject({
      status: 403,
      body: { error: 'Access denied' },
    });
    rmSync(outside, { recursive: true, force: true });
  });
});

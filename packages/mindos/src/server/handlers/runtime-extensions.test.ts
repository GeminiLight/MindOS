import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
      warnings: [],
      fingerprint: expect.stringMatching(/^[0-9a-f]{32}$/),
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

  it('rejects malformed and ambiguous confirmation shapes before installing', () => {
    for (const confirmation of [
      { confirmFingerprint: true },
      { confirmFingerprint: 1234 },
      { confirmFingerprint: '   ' },
      { confirmFingerprint: { value: 'abc' } },
    ]) {
      const response = handleAgentRuntimeExtensionInstallPost(
        { manifest: aionStyleManifest(), ...confirmation },
        services,
      );
      expect(response, JSON.stringify(confirmation)).toMatchObject({
        status: 400,
        body: { error: 'Runtime extension install requires explicit confirmation.' },
      });
    }

    const preflight = buildAgentRuntimeExtensionPreflight({ manifest: aionStyleManifest() }, services);
    const ambiguous = handleAgentRuntimeExtensionInstallPost(
      { manifest: aionStyleManifest(), confirm: true, confirmFingerprint: preflight.fingerprint },
      services,
    );
    expect(ambiguous).toMatchObject({
      status: 400,
      body: { error: 'Runtime extension install requires explicit confirmation.' },
    });
    expect(settings.acpAgents).toBeUndefined();
    expect(existsSync(join(mindRoot, '.mindos'))).toBe(false);
  });

  it('installs when the preflight fingerprint is echoed back and stays deterministic', () => {
    const preflightA = buildAgentRuntimeExtensionPreflight({ manifest: aionStyleManifest() }, services);
    const preflightB = buildAgentRuntimeExtensionPreflight({ manifest: aionStyleManifest() }, services);
    expect(preflightA.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(preflightA.fingerprint).toBe(preflightB.fingerprint);

    const response = handleAgentRuntimeExtensionInstallPost(
      {
        manifest: aionStyleManifest(),
        extensionRoot: '/tmp/source-extension',
        confirmFingerprint: preflightA.fingerprint,
      },
      services,
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ ok: true, warnings: [] });
    expect(settings.acpAgents?.['ext-buddy']).toBeDefined();
  });

  it('rejects a fingerprint that does not match the submitted manifest', () => {
    const preflight = buildAgentRuntimeExtensionPreflight({ manifest: aionStyleManifest() }, services);

    const mutated = aionStyleManifest();
    mutated.contributes.acpAdapters[0].cliCommand = 'codebuddy-trojan';
    const response = handleAgentRuntimeExtensionInstallPost(
      { manifest: mutated, confirmFingerprint: preflight.fingerprint },
      services,
    );

    expect(response).toMatchObject({
      status: 409,
      body: {
        error: 'Runtime extension confirmation does not match the submitted manifest. Re-run preflight and confirm the current fingerprint.',
      },
    });
    expect(settings.acpAgents).toBeUndefined();
    expect(existsSync(join(mindRoot, '.mindos'))).toBe(false);
  });

  it('rejects a stale replayed fingerprint after the extension was replaced', () => {
    const first = buildAgentRuntimeExtensionPreflight({ manifest: aionStyleManifest() }, services);
    const installed = handleAgentRuntimeExtensionInstallPost(
      { manifest: aionStyleManifest(), confirmFingerprint: first.fingerprint },
      services,
    );
    expect(installed.status).toBe(201);

    const updatedManifest = aionStyleManifest();
    updatedManifest.version = '0.2.0';
    updatedManifest.contributes.acpAdapters[0].cliCommand = 'codebuddy-next';

    // Replay the original install confirmation against the changed manifest.
    const replay = handleAgentRuntimeExtensionInstallPost(
      { manifest: updatedManifest, confirmFingerprint: first.fingerprint, replace: true },
      services,
    );
    expect(replay).toMatchObject({ status: 409 });
    expect(settings.acpAgents?.['ext-buddy']).toMatchObject({ command: 'codebuddy' });

    // The same manifest without replace is a different operation entirely.
    const withoutReplace = handleAgentRuntimeExtensionInstallPost(
      { manifest: aionStyleManifest(), confirmFingerprint: first.fingerprint },
      services,
    );
    expect(withoutReplace).toMatchObject({ status: 409 });

    // A fresh replace preflight produces a new fingerprint that authorizes it.
    const replacePreflight = buildAgentRuntimeExtensionPreflight(
      { manifest: updatedManifest, replace: true },
      services,
    );
    expect(replacePreflight.fingerprint).not.toBe(first.fingerprint);
    const replaced = handleAgentRuntimeExtensionInstallPost(
      { manifest: updatedManifest, replace: true, confirmFingerprint: replacePreflight.fingerprint },
      services,
    );
    expect(replaced.status).toBe(200);
    expect(settings.acpAgents?.['ext-buddy']).toMatchObject({ command: 'codebuddy-next' });
  });

  it('still accepts the legacy boolean confirm for one release with a deprecation warning', () => {
    const response = handleAgentRuntimeExtensionInstallPost(
      { manifest: aionStyleManifest(), confirm: true },
      services,
    );

    expect(response.status).toBe(201);
    const body = response.body as { warnings?: string[] };
    expect(body.warnings).toEqual([
      'confirm: true is deprecated; send confirmFingerprint from the preflight response. '
      + 'Boolean confirmation will be removed in the next release.',
    ]);
    expect(settings.acpAgents?.['ext-buddy']).toBeDefined();
  });

  it('installs sanitized manifests atomically and registers ACP adapters in settings', () => {
    const preflight = buildAgentRuntimeExtensionPreflight(
      { manifest: aionStyleManifest(), extensionRoot: '/tmp/source-extension' },
      services,
    );
    const response = handleAgentRuntimeExtensionInstallPost(
      {
        manifest: aionStyleManifest(),
        extensionRoot: '/tmp/source-extension',
        confirmFingerprint: preflight.fingerprint,
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

  it('records applied ACP agents in host settings so the extension directory cannot self-authorize', () => {
    const preflight = buildAgentRuntimeExtensionPreflight({ manifest: aionStyleManifest() }, services);
    const installed = handleAgentRuntimeExtensionInstallPost(
      { manifest: aionStyleManifest(), confirmFingerprint: preflight.fingerprint },
      services,
    );
    expect(installed.status).toBe(201);

    // settings.runtimeExtensions is the authorization record (P2-6).
    expect(settings.runtimeExtensions?.['aion-style-pack']).toMatchObject({
      appliedAcpAgents: ['ext-buddy'],
      updatedAt: '2026-06-27T00:00:00.000Z',
    });

    // Forge the extension-dir metadata to claim ownership of a user agent.
    settings.acpAgents = {
      ...settings.acpAgents,
      'user-agent': { command: 'user-cli' },
    };
    const metadataPath = join(mindRoot, MINDOS_RUNTIME_EXTENSIONS_ROOT, 'aion-style-pack', 'mindos-runtime-extension.json');
    const forged = JSON.parse(readFileSync(metadataPath, 'utf-8'));
    forged.appliedAcpAgents = ['ext-buddy', 'user-agent'];
    writeFileSync(metadataPath, `${JSON.stringify(forged, null, 2)}\n`, 'utf-8');

    const replaceManifest = aionStyleManifest();
    replaceManifest.contributes.acpAdapters.push({
      id: 'user-agent',
      name: 'Hijacked',
      cliCommand: 'evil-cli',
    });
    const replacePreflight = buildAgentRuntimeExtensionPreflight(
      { manifest: replaceManifest, replace: true },
      services,
    );
    expect(replacePreflight.installable).toBe(false);
    expect(replacePreflight.blockedReasons).toContain('ACP agent already configured: user-agent');

    const attempted = handleAgentRuntimeExtensionInstallPost(
      { manifest: replaceManifest, replace: true, confirmFingerprint: replacePreflight.fingerprint },
      services,
    );
    expect(attempted.status).toBe(409);
    expect(settings.acpAgents?.['user-agent']).toMatchObject({ command: 'user-cli' });
  });

  it('keeps migrated installs working from extension-dir metadata and rewrites settings on the next replace', () => {
    // Simulate a pre-migration install: files on disk, no settings records.
    const extensionDir = join(mindRoot, MINDOS_RUNTIME_EXTENSIONS_ROOT, 'aion-style-pack');
    mkdirSync(extensionDir, { recursive: true });
    const parsedManifest = buildAgentRuntimeExtensionPreflight({ manifest: aionStyleManifest() }, services);
    writeFileSync(join(extensionDir, 'manifest.json'), `${JSON.stringify(parsedManifest.manifest, null, 2)}\n`, 'utf-8');
    writeFileSync(join(extensionDir, 'mindos-runtime-extension.json'), `${JSON.stringify({
      schemaVersion: 1,
      source: 'agent-runtime-extension',
      extensionId: 'aion-style-pack',
      version: '0.1.0',
      installedAt: '2026-06-20T00:00:00.000Z',
      contributionCounts: parsedManifest.extension?.contributionCounts,
      appliedAcpAgents: ['ext-buddy'],
      lifecycleScriptsDeclared: 1,
    }, null, 2)}\n`, 'utf-8');
    settings = { mindRoot, acpAgents: { 'ext-buddy': { command: 'codebuddy', args: ['--acp'] } } };

    const updatedManifest = aionStyleManifest();
    updatedManifest.version = '0.2.0';
    updatedManifest.contributes.acpAdapters[0].cliCommand = 'codebuddy-next';

    // Migration fallback: the extension-dir record still authorizes replace.
    const replacePreflight = buildAgentRuntimeExtensionPreflight(
      { manifest: updatedManifest, replace: true },
      services,
    );
    expect(replacePreflight.installable).toBe(true);

    const replaced = handleAgentRuntimeExtensionInstallPost(
      { manifest: updatedManifest, replace: true, confirmFingerprint: replacePreflight.fingerprint },
      services,
    );
    expect(replaced.status).toBe(200);
    expect(settings.acpAgents?.['ext-buddy']).toMatchObject({ command: 'codebuddy-next' });
    // The successful operation rewrote the authorization record into settings.
    expect(settings.runtimeExtensions?.['aion-style-pack']).toMatchObject({
      appliedAcpAgents: ['ext-buddy'],
      updatedAt: '2026-06-27T00:00:00.000Z',
    });

    // Forged extension-dir metadata is ignored from now on: settings win.
    const metadataPath = join(extensionDir, 'mindos-runtime-extension.json');
    const forged = JSON.parse(readFileSync(metadataPath, 'utf-8'));
    forged.appliedAcpAgents = ['ext-buddy', 'victim'];
    writeFileSync(metadataPath, `${JSON.stringify(forged, null, 2)}\n`, 'utf-8');
    settings.acpAgents = { ...settings.acpAgents, victim: { command: 'victim-cli' } };

    const hijackManifest = aionStyleManifest();
    hijackManifest.contributes.acpAdapters.push({ id: 'victim', name: 'Victim', cliCommand: 'evil' });
    const hijackPreflight = buildAgentRuntimeExtensionPreflight(
      { manifest: hijackManifest, replace: true },
      services,
    );
    expect(hijackPreflight.installable).toBe(false);
    expect(hijackPreflight.blockedReasons).toContain('ACP agent already configured: victim');
  });

  it('ignores malformed settings.runtimeExtensions records when checking replace authorization', () => {
    const preflight = buildAgentRuntimeExtensionPreflight({ manifest: aionStyleManifest() }, services);
    const installed = handleAgentRuntimeExtensionInstallPost(
      { manifest: aionStyleManifest(), confirmFingerprint: preflight.fingerprint },
      services,
    );
    expect(installed.status).toBe(201);

    settings.runtimeExtensions = {
      'aion-style-pack': { appliedAcpAgents: ['ext-buddy', 42, null], updatedAt: 7 },
      __proto__: { appliedAcpAgents: ['polluted'] },
    } as never;
    settings.acpAgents = { ...settings.acpAgents, 'other-agent': { command: 'other-cli' } };

    const replaceManifest = aionStyleManifest();
    replaceManifest.contributes.acpAdapters.push({ id: 'other-agent', name: 'Other', cliCommand: 'evil' });
    const replacePreflight = buildAgentRuntimeExtensionPreflight(
      { manifest: replaceManifest, replace: true },
      services,
    );
    // Non-string entries are dropped, but the valid id still authorizes.
    expect(replacePreflight.installable).toBe(false);
    expect(replacePreflight.blockedReasons).toContain('ACP agent already configured: other-agent');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects writes when the managed extension root resolves outside mindRoot', () => {
    const outside = mkdtempSync(join(tmpdir(), 'mindos-runtime-extension-outside-'));
    symlinkSync(outside, join(mindRoot, '.mindos'), 'dir');

    // Preflight itself cannot run against the escaped root, so the install is
    // driven with the legacy boolean; the 403 must come from the path guard,
    // not from confirmation handling.
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

import { describe, expect, it } from 'vitest';
import { parseAgentRuntimeExtensionManifest } from './extension-manifest.js';

describe('parseAgentRuntimeExtensionManifest', () => {
  it('parses AionUI-style runtime extension contributions into safe declarative contracts', () => {
    const result = parseAgentRuntimeExtensionManifest({
      $schema: 'mindos.agent-runtime.extension.v0',
      id: 'aion-style-pack',
      name: 'Aion Style Pack',
      displayName: 'Aion Style Pack',
      version: '0.1.0',
      description: 'Runtime extension manifest fixture.',
      author: 'MindOS',
      homepage: 'https://mindos.you',
      icon: '$file:assets/icon.png',
      engines: { mindos: '>=1.1.0' },
      permissions: ['agent.runtime', 'mcp.inherit'],
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
            apiKeyFields: [{ key: 'BUDDY_TOKEN', type: 'password' }],
          },
        ],
        mcpServers: {
          docs: {
            type: 'stdio',
            command: 'mcp-docs',
            args: ['--stdio'],
            env: { API_KEY: 'must-not-leak' },
          },
        },
        assistants: [
          {
            id: 'reviewer',
            name: 'Reviewer',
            runtimeId: 'ext-buddy',
            prompt: '$file:prompts/reviewer.md',
          },
        ],
        agents: [
          {
            id: 'fixer',
            name: 'Fixer',
            runtimeId: 'ext-buddy',
            command: 'codebuddy',
            args: ['--fix'],
            manifest: '$file:agents/fixer.json',
          },
        ],
        skills: [
          {
            id: 'code-review',
            name: 'Code Review',
            path: '$file:skills/code-review',
            entry: '$file:skills/code-review/SKILL.md',
          },
        ],
        commands: [
          {
            id: 'explain',
            title: 'Explain Selection',
            slash: '/explain',
            runtimeId: 'ext-buddy',
          },
        ],
      },
    }, { extensionRoot: '/tmp/mindos-extension' });

    expect(result.manifest).toMatchObject({
      schemaVersion: 0,
      id: 'aion-style-pack',
      name: 'Aion Style Pack',
      icon: {
        kind: 'file',
        path: 'assets/icon.png',
        resolvedPath: '/tmp/mindos-extension/assets/icon.png',
      },
      contributes: {
        acpAdapters: [
          expect.objectContaining({
            id: 'ext-buddy',
            name: 'External Buddy',
            command: 'codebuddy',
            args: ['--acp'],
            adapterMetadata: expect.objectContaining({
              connectionType: 'cli',
              supportsStreaming: true,
              models: [{ id: 'demo-model', label: 'demo-model' }],
            }),
          }),
        ],
        mcpServers: [
          expect.objectContaining({
            id: 'docs',
            type: 'stdio',
            command: 'mcp-docs',
            args: ['--stdio'],
          }),
        ],
        assistants: [
          expect.objectContaining({
            id: 'reviewer',
            prompt: {
              kind: 'file',
              path: 'prompts/reviewer.md',
              resolvedPath: '/tmp/mindos-extension/prompts/reviewer.md',
            },
          }),
        ],
        agents: [expect.objectContaining({ id: 'fixer', command: 'codebuddy' })],
        skills: [expect.objectContaining({ id: 'code-review' })],
        commands: [expect.objectContaining({ id: 'explain', slash: '/explain' })],
      },
      lifecycle: { supported: false, scripts: [] },
    });
    expect(result.acpAgentOverrides['ext-buddy']).toMatchObject({
      name: 'External Buddy',
      command: 'codebuddy',
      args: ['--acp'],
    });
    expect(JSON.stringify(result)).not.toContain('BUDDY_TOKEN');
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('rejects unsafe paths and records lifecycle scripts without enabling execution', () => {
    const result = parseAgentRuntimeExtensionManifest({
      id: 'unsafe-pack',
      name: 'Unsafe Pack',
      lifecycle: {
        postInstall: '../scripts/install.sh',
      },
      contributes: {
        skills: [
          { id: 'bad-skill', name: 'Bad Skill', entry: '$file:../../secret.md' },
        ],
        assistants: [
          { id: 'inline', name: 'Inline', prompt: 'token=secret-value' },
        ],
      },
    }, { extensionRoot: '/tmp/mindos-extension' });

    expect(result.manifest?.contributes.skills[0]).toEqual({
      id: 'bad-skill',
      name: 'Bad Skill',
    });
    expect(result.manifest?.contributes.assistants[0]?.prompt).toEqual({
      kind: 'inline',
      text: 'token=[redacted]',
    });
    expect(result.manifest?.lifecycle.supported).toBe(false);
    expect(result.manifest?.lifecycle.scripts[0]).toMatchObject({
      name: 'postInstall',
      summary: 'Declared only; MindOS does not execute manifest lifecycle scripts.',
    });
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unsafe-path', severity: 'warning' }),
      expect.objectContaining({ code: 'lifecycle-scripts-declared-only', severity: 'warning' }),
    ]));
  });

  it('returns an error diagnostic for non-object manifests', () => {
    const result = parseAgentRuntimeExtensionManifest('nope');

    expect(result.manifest).toBeUndefined();
    expect(result.acpAgentOverrides).toEqual({});
    expect(result.diagnostics).toEqual([
      {
        code: 'invalid-manifest',
        severity: 'error',
        summary: 'Extension manifest must be an object.',
      },
    ]);
  });
});

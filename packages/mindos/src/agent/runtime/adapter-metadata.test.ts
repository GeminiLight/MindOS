import { describe, expect, it } from 'vitest';
import { sanitizeAdapterMetadata } from './adapter-metadata.js';
import { normalizeInstalled } from './detection.js';
import { parseAcpAgentOverrides } from '../../protocols/acp/agent-descriptors.js';

/**
 * One sanitiser, three entry points. The detection copy used to drop
 * `mcpCapabilities.acp` and `sessionCapabilities.delete`; the settings copy
 * used to reject a bare top-level `kinds` array. Every case below feeds the
 * same raw input through `sanitizeAdapterMetadata`, `normalizeInstalled`
 * (detect results) and `parseAcpAgentOverrides` (settings / manifests) and
 * requires identical output.
 */

type Case = { name: string; input: Record<string, unknown>; expected: unknown };

const CASES: Case[] = [
  {
    name: 'keeps mcpCapabilities.acp and sessionCapabilities.delete',
    input: {
      connectionType: 'stdio',
      mcpCapabilities: { stdio: true, http: false, acp: true },
      sessionCapabilities: { loadSession: true, list: true, delete: true, resume: false },
    },
    expected: {
      connectionType: 'stdio',
      mcpCapabilities: { stdio: true, http: false, acp: true },
      sessionCapabilities: { loadSession: true, list: true, delete: true, resume: false },
    },
  },
  {
    name: 'drops unknown capability flags and non-boolean values',
    input: {
      mcpCapabilities: { stdio: 'yes', websocket: true, sse: true },
      sessionCapabilities: { loadSession: 1, fork: true, archive: true },
      promptCapabilities: { image: true, video: true, audio: null },
    },
    expected: {
      mcpCapabilities: { sse: true },
      sessionCapabilities: { fork: true },
      promptCapabilities: { image: true },
    },
  },
  {
    name: 'accepts nested output objects',
    input: {
      output: { kinds: ['diff', 'text', 'diff', 'secret'], fileChanges: true, branches: false },
    },
    expected: {
      output: { kinds: ['diff', 'text'], fileChanges: true, branches: false },
    },
  },
  {
    name: 'accepts flat manifest-style output fields',
    input: {
      outputKinds: ['artifact'],
      reviewableOutputKinds: ['checkpoint'],
      pullRequests: true,
    },
    expected: {
      output: { kinds: ['artifact', 'checkpoint', 'pr', 'text'], pullRequests: true },
    },
  },
  {
    name: 'accepts a bare top-level kinds array (detect-result shape)',
    input: { kinds: ['diff'] },
    expected: { output: { kinds: ['diff', 'text'] } },
  },
  {
    name: 'accepts an output array shorthand',
    input: { output: ['branch', 'nonsense'], artifacts: true },
    expected: { output: { kinds: ['artifact', 'branch', 'text'], artifacts: true } },
  },
  {
    name: 'normalizes models, health check and commands with limits',
    input: {
      authRequired: true,
      supportsStreaming: false,
      models: ['plain-model', { id: ' spaced ', name: 'Spaced', description: 'x'.repeat(400) }, { label: 'no-id' }, 42],
      healthCheck: { versionCommand: 'agent --version', timeout: 999_999, summary: '  probe  ' },
      commands: [{ name: 'plan', description: 'Plan it' }, { description: 'nameless' }, 'string'],
    },
    expected: {
      authRequired: true,
      supportsStreaming: false,
      models: [
        { id: 'plain-model', label: 'plain-model' },
        { id: 'spaced', label: 'Spaced', description: 'x'.repeat(300) },
      ],
      healthCheck: { command: 'agent --version', timeoutMs: 60_000, summary: 'probe' },
      commands: [{ name: 'plan', description: 'Plan it' }],
    },
  },
  {
    name: 'ignores connection types outside the ACP surface',
    input: { connectionType: 'websocket', authRequired: 'true' },
    expected: undefined,
  },
];

function viaDetect(input: Record<string, unknown>): unknown {
  return normalizeInstalled({ id: 'x', name: 'X', binaryPath: '/bin/x', adapterMetadata: input })?.adapterMetadata;
}

function viaSettings(input: Record<string, unknown>): unknown {
  return parseAcpAgentOverrides({ 'custom-x': { command: 'x', adapterMetadata: input } })?.['custom-x']?.adapterMetadata;
}

describe('adapter metadata sanitiser', () => {
  for (const testCase of CASES) {
    it(testCase.name, () => {
      const direct = sanitizeAdapterMetadata(testCase.input);
      expect(direct).toEqual(testCase.expected);
      expect(viaDetect(testCase.input)).toEqual(testCase.expected);
      expect(viaSettings(testCase.input)).toEqual(testCase.expected);
    });
  }

  it('returns undefined for non-objects and empty objects', () => {
    for (const input of [null, undefined, 'stdio', 12, [], {}]) {
      expect(sanitizeAdapterMetadata(input)).toBeUndefined();
    }
  });

  it('caps unbounded lists (100 models, 50 commands, 20 output kinds)', () => {
    const models = Array.from({ length: 150 }, (_, index) => `model-${index}`);
    const commands = Array.from({ length: 80 }, (_, index) => ({ name: `cmd-${index}` }));
    const result = sanitizeAdapterMetadata({ models, commands });
    expect(result?.models).toHaveLength(100);
    expect(result?.commands).toHaveLength(50);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setMindRootResolverForTests } from '../../foundation/mind-root/index.js';
import {
  appendAgentArtifact,
  listAgentArtifacts,
  recordArtifactsFromAcpToolCall,
  reloadAgentArtifactsFromDiskForTest,
  resetAgentArtifactsForTest,
} from './artifact-ledger.js';

let root = '';

describe('agent artifact ledger', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-artifact-ledger-'));
    fs.mkdirSync(path.join(root, '.mindos'), { recursive: true });
    setMindRootResolverForTests(() => root);
    resetAgentArtifactsForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetAgentArtifactsForTest();
    setMindRootResolverForTests(null);
    reloadAgentArtifactsFromDiskForTest();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('stores durable artifact pointers and reloads them from the process shard', () => {
    const first = appendAgentArtifact({
      runtimeId: 'codex',
      agentKind: 'native-runtime',
      source: 'runtime-output',
      kind: 'diff',
      status: 'completed',
      runId: 'run-1',
      path: '/tmp/project/changes.diff',
      title: 'Generated diff',
    });
    const updated = appendAgentArtifact({
      runtimeId: 'codex',
      agentKind: 'native-runtime',
      source: 'runtime-output',
      kind: 'diff',
      status: 'completed',
      runId: 'run-1',
      path: '/tmp/project/changes.diff',
      title: 'Updated diff',
      metadata: { token: 'secret-token-value' },
    });

    expect(first?.id).toBe(updated?.id);
    expect(listAgentArtifacts({ runtimeId: 'codex' })).toEqual([
      expect.objectContaining({
        id: first?.id,
        runtimeId: 'codex',
        kind: 'diff',
        path: '/tmp/project/changes.diff',
        title: 'Updated diff',
      }),
    ]);
    expect(JSON.stringify(listAgentArtifacts())).not.toContain('secret-token-value');

    resetAgentArtifactsForTest();
    reloadAgentArtifactsFromDiskForTest();
    expect(listAgentArtifacts({ runtimeId: 'codex' })).toEqual([
      expect.objectContaining({
        id: first?.id,
        path: '/tmp/project/changes.diff',
      }),
    ]);
  });

  it('extracts ACP tool location pointers without storing raw blobs', () => {
    const hugeImage = `data:image/png;base64,${'a'.repeat(80_000)}`;
    const records = recordArtifactsFromAcpToolCall({
      runtimeId: 'declared-acp',
      sessionId: 'ses-1',
      externalSessionId: 'agent-ses-1',
      cwd: '/tmp/project',
      toolCall: {
        toolCallId: 'tool-1',
        title: 'Edit README',
        kind: 'edit',
        status: 'completed',
        rawOutput: hugeImage,
        locations: [
          { path: '/tmp/project/README.md', line: 7 },
          { path: '/tmp/project/README.md', line: 7 },
          { path: '/tmp/project/screenshot.png' },
        ],
        content: [
          { type: 'resource_link', uri: 'file:///tmp/project/report.md', name: 'report.md' },
          { type: 'image', data: hugeImage, mimeType: 'image/png' },
        ],
      },
    });

    expect(records).toHaveLength(3);
    expect(listAgentArtifacts({ runtimeId: 'declared-acp', toolCallId: 'tool-1' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/tmp/project/README.md', line: 7, kind: 'file' }),
      expect.objectContaining({ path: '/tmp/project/screenshot.png', kind: 'image' }),
      expect.objectContaining({ path: '/tmp/project/report.md', uri: 'file:///tmp/project/report.md', kind: 'file' }),
    ]));
    expect(JSON.stringify(listAgentArtifacts())).not.toContain(hugeImage.slice(0, 100));
  });
});

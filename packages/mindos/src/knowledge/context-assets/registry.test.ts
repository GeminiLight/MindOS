import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CONTEXT_ASSET_REGISTRY_FILE,
  listContextAssets,
  readContextAssetRegistry,
  registerContextAsset,
  registerContextFileAsset,
  updateContextAssetStatus,
} from './registry.js';

describe('context asset registry', () => {
  let mindRoot: string;

  beforeEach(() => {
    mindRoot = mkdtempSync(join(tmpdir(), 'mindos-context-assets-'));
  });

  afterEach(() => {
    rmSync(mindRoot, { recursive: true, force: true });
  });

  it('registers a selected knowledge file and versions it only when content changes', () => {
    mkdirSync(join(mindRoot, '研究 笔记'), { recursive: true });
    writeFileSync(join(mindRoot, '研究 笔记', '上下文.md'), '# 第一版\n', 'utf-8');

    const first = registerContextFileAsset(mindRoot, {
      path: '研究 笔记/上下文.md',
      kind: 'knowledge',
      status: 'active',
      source: { kind: 'file', ref: 'file:研究 笔记/上下文.md' },
    }, new Date('2026-09-02T01:00:00.000Z'));
    const duplicate = registerContextFileAsset(mindRoot, {
      path: '研究 笔记/上下文.md',
      kind: 'knowledge',
      status: 'active',
      source: { kind: 'file', ref: 'file:研究 笔记/上下文.md' },
    }, new Date('2026-09-02T01:01:00.000Z'));

    expect(duplicate).toMatchObject({ id: first.id, version: 1, updatedAt: first.updatedAt });

    writeFileSync(join(mindRoot, '研究 笔记', '上下文.md'), '# 第二版\n新增证据。\n', 'utf-8');
    const changed = registerContextFileAsset(mindRoot, {
      path: '研究 笔记/上下文.md',
      kind: 'knowledge',
      status: 'active',
      source: { kind: 'file', ref: 'file:研究 笔记/上下文.md' },
    }, new Date('2026-09-02T01:02:00.000Z'));

    expect(changed).toMatchObject({ id: first.id, version: 2, path: '研究 笔记/上下文.md' });
    expect(changed.contentHash).not.toBe(first.contentHash);
    expect(readContextAssetRegistry(mindRoot).assets).toHaveLength(1);
    expect(readFileSync(join(mindRoot, CONTEXT_ASSET_REGISTRY_FILE), 'utf-8')).toContain('研究 笔记/上下文.md');
  });

  it('filters assets and preserves stable source ownership through status changes', () => {
    const now = new Date('2026-09-02T02:00:00.000Z');
    const playbook = registerContextAsset(mindRoot, {
      kind: 'echo-playbook',
      status: 'draft',
      title: 'Release checklist',
      path: 'Echo/Playbooks/release-checklist.md',
      contentHash: 'a'.repeat(64),
      source: { kind: 'echo-card', ref: 'echo-card:card-1' },
    }, now);
    registerContextAsset(mindRoot, {
      kind: 'workflow',
      status: 'active',
      title: 'Daily radar',
      path: '.mindos/workflows/daily-radar.flow.yaml',
      contentHash: 'b'.repeat(64),
      source: { kind: 'workflow', ref: 'workflow:daily-radar' },
    }, now);

    const activePlaybook = updateContextAssetStatus(mindRoot, playbook.id, 'active', new Date('2026-09-02T02:05:00.000Z'));
    expect(activePlaybook).toMatchObject({ id: playbook.id, status: 'active', version: 1 });
    expect(listContextAssets(mindRoot, { kind: 'echo-playbook', status: 'active' })).toEqual([
      expect.objectContaining({ id: playbook.id, source: { kind: 'echo-card', ref: 'echo-card:card-1' } }),
    ]);
    expect(listContextAssets(mindRoot, { kind: 'knowledge' })).toEqual([]);
  });

  it('rejects id or source-ref collisions instead of changing asset ownership', () => {
    const first = registerContextAsset(mindRoot, {
      id: 'asset-fixed-owner',
      kind: 'knowledge',
      status: 'active',
      title: 'Owned note',
      path: 'Notes/owned.md',
      contentHash: 'a'.repeat(64),
      source: { kind: 'file', ref: 'file:Notes/owned.md' },
    });

    expect(() => registerContextAsset(mindRoot, {
      id: first.id,
      kind: 'knowledge',
      status: 'active',
      title: 'Different source',
      path: 'Notes/other.md',
      contentHash: 'b'.repeat(64),
      source: { kind: 'file', ref: 'file:Notes/other.md' },
    })).toThrow(/ownership|collision/i);
    expect(() => registerContextAsset(mindRoot, {
      id: 'asset-other-owner',
      kind: 'knowledge',
      status: 'active',
      title: 'Different id',
      path: 'Notes/owned.md',
      contentHash: 'a'.repeat(64),
      source: { kind: 'file', ref: 'file:Notes/owned.md' },
    })).toThrow(/ownership|collision/i);
    expect(readContextAssetRegistry(mindRoot).assets).toEqual([first]);
  });

  it('does not overwrite a corrupt registry during the next mutation', () => {
    const registryPath = join(mindRoot, CONTEXT_ASSET_REGISTRY_FILE);
    mkdirSync(join(mindRoot, '.mindos/context-assets'), { recursive: true });
    writeFileSync(registryPath, '{broken context registry');

    expect(() => registerContextAsset(mindRoot, {
      kind: 'knowledge',
      status: 'active',
      title: 'Must not overwrite',
      path: 'Notes/safe.md',
      contentHash: 'c'.repeat(64),
      source: { kind: 'file', ref: 'file:Notes/safe.md' },
    })).toThrow(/corrupt|preserved/i);
    expect(readFileSync(registryPath, 'utf-8')).toBe('{broken context registry');
  });

  it('rejects traversal and refuses registry writes through a symlinked metadata directory', () => {
    writeFileSync(join(mindRoot, 'safe.md'), 'safe', 'utf-8');
    expect(() => registerContextFileAsset(mindRoot, {
      path: '../outside.md',
      kind: 'knowledge',
      status: 'active',
      source: { kind: 'file', ref: 'file:../outside.md' },
    })).toThrow(/Access denied|outside|relative/i);

    const linkedRoot = mkdtempSync(join(tmpdir(), 'mindos-context-assets-linked-'));
    const outside = mkdtempSync(join(tmpdir(), 'mindos-context-assets-outside-'));
    symlinkSync(outside, join(linkedRoot, '.mindos'), 'dir');
    expect(() => registerContextAsset(linkedRoot, {
      kind: 'knowledge',
      status: 'active',
      title: 'Unsafe',
      path: 'safe.md',
      contentHash: 'c'.repeat(64),
      source: { kind: 'file', ref: 'file:safe.md' },
    })).toThrow(/Access denied|symlink|escape/i);
    expect(readContextAssetRegistry(linkedRoot).assets).toEqual([]);

    rmSync(linkedRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
});

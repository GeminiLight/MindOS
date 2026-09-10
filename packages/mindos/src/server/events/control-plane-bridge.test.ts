import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeAllMindosDatabases } from '../../foundation/storage/sqlite.js';
import { handleRuntimeControlPlanePost } from '../handlers/runtime-control-plane.js';
import { createMindosServerEventBus, type MindosServerEventEnvelope } from './bus.js';
import { installRuntimeControlPlaneBridge, isRuntimeControlPlaneBridgeInstalled } from './control-plane-bridge.js';

let mindRoot: string;

function collect(bus: ReturnType<typeof createMindosServerEventBus>): MindosServerEventEnvelope[] {
  const seen: MindosServerEventEnvelope[] = [];
  bus.subscribe((envelope) => { seen.push(envelope); });
  return seen;
}

describe('runtime control plane → server event bus bridge', () => {
  beforeEach(() => {
    mindRoot = mkdtempSync(join(tmpdir(), 'mindos-control-plane-bridge-'));
  });
  afterEach(() => {
    closeAllMindosDatabases();
    rmSync(mindRoot, { recursive: true, force: true });
  });

  it('emits control-plane.changed after a mutation is committed', () => {
    const bus = createMindosServerEventBus();
    const uninstall = installRuntimeControlPlaneBridge(bus);
    const seen = collect(bus);
    handleRuntimeControlPlanePost({
      action: 'upsert-task',
      task: { id: 'task-1', title: 'Bridge me', status: 'open', runtimeId: 'mindos' },
    }, { mindRoot, now: () => new Date('2026-09-10T00:00:00.000Z') });
    const events = seen.filter((envelope) => envelope.event.type === 'control-plane.changed');
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toMatchObject({ type: 'control-plane.changed', action: 'upsert-task', mindRoot });
    uninstall();
  });

  it('is idempotent per bus and stops forwarding after uninstall', () => {
    const bus = createMindosServerEventBus();
    const first = installRuntimeControlPlaneBridge(bus);
    const second = installRuntimeControlPlaneBridge(bus);
    expect(second).toBe(first);
    expect(isRuntimeControlPlaneBridgeInstalled(bus)).toBe(true);
    first();
    expect(isRuntimeControlPlaneBridgeInstalled(bus)).toBe(false);
    const seen = collect(bus);
    handleRuntimeControlPlanePost({
      action: 'upsert-task',
      task: { id: 'task-2', title: 'Silent', status: 'open', runtimeId: 'mindos' },
    }, { mindRoot, now: () => new Date('2026-09-10T00:00:00.000Z') });
    expect(seen.filter((envelope) => envelope.event.type === 'control-plane.changed')).toHaveLength(0);
  });

  it('does not emit when the mutation is rejected before commit', () => {
    const bus = createMindosServerEventBus();
    installRuntimeControlPlaneBridge(bus);
    const seen = collect(bus);
    const refused = handleRuntimeControlPlanePost({ action: 'not-a-control-plane-action' } as never, { mindRoot, now: () => new Date() });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(seen.filter((envelope) => envelope.event.type === 'control-plane.changed')).toHaveLength(0);
  });
});

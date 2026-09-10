import { subscribeRuntimeControlPlaneMutations } from '../handlers/runtime-control-plane.js';
import type { MindosServerEventBus } from './bus.js';

/**
 * Forwards committed runtime control-plane mutations (schedules, approvals,
 * wake events, tasks, mailbox …) onto the server event bus as
 * `control-plane.changed`. The handler only notifies in-process listeners after
 * the lease-guarded write has landed, so subscribers never see a mutation that
 * was refused or lost. Cross-process writers (the automation worker) are
 * covered by their own host installing this bridge on its bus.
 */
const installed = new WeakMap<MindosServerEventBus, () => void>();

export function installRuntimeControlPlaneBridge(bus: MindosServerEventBus): () => void {
  const existing = installed.get(bus);
  if (existing) return existing;
  const unsubscribe = subscribeRuntimeControlPlaneMutations((event) => {
    bus.emit({
      type: 'control-plane.changed',
      mindRoot: event.mindRoot,
      action: event.action,
      updatedAt: event.updatedAt,
    });
  });
  const uninstall = () => {
    if (installed.get(bus) !== uninstall) return;
    installed.delete(bus);
    unsubscribe();
  };
  installed.set(bus, uninstall);
  return uninstall;
}

export function isRuntimeControlPlaneBridgeInstalled(bus: MindosServerEventBus): boolean {
  return installed.has(bus);
}

/**
 * Obsidian Plugin Compatibility - Runtime Service
 * Keeps one request-shared PluginManager per MindOS root.
 */

import path from 'path';
import { PluginManager } from './plugin-manager';

type RuntimeOperation<T> = (manager: PluginManager) => Promise<T> | T;

export class ObsidianPluginRuntimeService {
  private readonly manager: PluginManager;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly mindRoot: string) {
    this.manager = new PluginManager(mindRoot);
  }

  async run<T>(operation: RuntimeOperation<T>): Promise<T> {
    const next = this.queue
      .catch(() => undefined)
      .then(async () => {
        await this.manager.discover();
        await this.manager.unloadUnavailablePlugins();
        return operation(this.manager);
      });
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }
}

const runtimeServices = new Map<string, ObsidianPluginRuntimeService>();

function serviceKeyForMindRoot(mindRoot: string): string {
  return path.resolve(mindRoot);
}

export function getObsidianPluginRuntimeService(mindRoot: string): ObsidianPluginRuntimeService {
  const key = serviceKeyForMindRoot(mindRoot);
  const existing = runtimeServices.get(key);
  if (existing) {
    return existing;
  }
  const service = new ObsidianPluginRuntimeService(key);
  runtimeServices.set(key, service);
  return service;
}

export async function withObsidianPluginRuntime<T>(
  mindRoot: string,
  operation: RuntimeOperation<T>,
): Promise<T> {
  return getObsidianPluginRuntimeService(mindRoot).run(operation);
}

export function resetObsidianPluginRuntimeServicesForTests(): void {
  runtimeServices.clear();
}

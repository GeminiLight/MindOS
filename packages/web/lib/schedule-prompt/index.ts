// ─── MindOS Schedule-Prompt Extension Wrapper ─────────────────────────────────
// Wraps pi-schedule-prompt with MindOS-specific storage path (~/.mindos/).
// Instead of storing to {cwd}/.pi/schedule-prompts.json (Pi default),
// persists to ~/.mindos/schedule-prompts.json (MindOS global).
//
// Loaded as an extension by DefaultResourceLoader in ask/route.ts.

import os from 'os';
import path from 'path';

type ExtensionAPI = {
  registerTool(tool: unknown): void;
  on(event: string, handler: () => Promise<void> | void): void;
};

type CronStorageLike = {
  getAllJobs(): Array<{ id: string; enabled: boolean }>;
  removeJob(id: string): void;
  piDir?: string;
  storePath?: string;
};

type CronSchedulerLike = {
  start(): void;
  stop(): void;
};

type SchedulePromptModules = {
  CronStorage: new (homeDir: string) => CronStorageLike;
  CronScheduler: new (storage: CronStorageLike, pi: ExtensionAPI) => CronSchedulerLike;
  createCronTool: (
    getStorage: () => CronStorageLike,
    getScheduler: () => CronSchedulerLike,
  ) => unknown;
};

async function loadSchedulePromptModules(): Promise<SchedulePromptModules> {
  // pi-schedule-prompt 0.1.2 ships TypeScript source only. Keep these imports
  // dynamic so app typecheck does not typecheck the dependency's internal TS.
  const storageModuleName = 'pi-schedule-prompt/src/storage.ts';
  const schedulerModuleName = 'pi-schedule-prompt/src/scheduler.ts';
  const toolModuleName = 'pi-schedule-prompt/src/tool.ts';
  const [{ CronStorage }, { CronScheduler }, { createCronTool }] = await Promise.all([
    import(storageModuleName),
    import(schedulerModuleName),
    import(toolModuleName),
  ]);
  return { CronStorage, CronScheduler, createCronTool };
}

/** Create a CronStorage that persists to ~/.mindos/schedule-prompts.json */
function createMindOSStorage(CronStorage: SchedulePromptModules['CronStorage']): CronStorageLike {
  const mindosDir = path.join(os.homedir(), '.mindos');
  const storage = new CronStorage(os.homedir());
  // Patch internal paths: ~/.pi/ → ~/.mindos/
  storage.piDir = mindosDir;
  storage.storePath = path.join(mindosDir, 'schedule-prompts.json');
  return storage;
}

export default async function mindosSchedulePrompt(pi: ExtensionAPI) {
  const { CronStorage, CronScheduler, createCronTool } = await loadSchedulePromptModules();
  let storage: CronStorageLike;
  let scheduler: CronSchedulerLike;

  // Register the tool once with getter functions
  const tool = createCronTool(
    () => storage,
    () => scheduler,
  );
  pi.registerTool(tool);

  // --- Session initialization ---

  const initializeSession = () => {
    storage = createMindOSStorage(CronStorage);
    scheduler = new CronScheduler(storage, pi);
    scheduler.start();
  };

  const cleanupSession = () => {
    if (scheduler) {
      scheduler.stop();
    }
    if (storage) {
      const jobs = storage.getAllJobs();
      const disabledJobs = jobs.filter((j) => !j.enabled);
      for (const job of disabledJobs) {
        storage.removeJob(job.id);
      }
    }
  };

  // --- Lifecycle events ---

  pi.on('session_start', async () => {
    initializeSession();
  });

  pi.on('session_switch', async () => {
    cleanupSession();
    initializeSession();
  });

  pi.on('session_fork', async () => {
    cleanupSession();
    initializeSession();
  });

  pi.on('session_shutdown', async () => {
    cleanupSession();
  });
}

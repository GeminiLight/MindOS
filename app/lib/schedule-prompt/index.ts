// ─── MindOS Schedule-Prompt Extension Wrapper ─────────────────────────────────
// Wraps pi-schedule-prompt with MindOS-specific storage path (~/.mindos/).
// Instead of storing to {cwd}/.pi/schedule-prompts.json (Pi default),
// persists to ~/.mindos/schedule-prompts.json (MindOS global).
//
// Loaded as an extension by DefaultResourceLoader in ask/route.ts.

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import os from 'os';
import path from 'path';
import { CronStorage } from 'pi-schedule-prompt/src/storage.js';
import { CronScheduler } from 'pi-schedule-prompt/src/scheduler.js';
import { createCronTool } from 'pi-schedule-prompt/src/tool.js';

/** Create a CronStorage that persists to ~/.mindos/schedule-prompts.json */
function createMindOSStorage(): CronStorage {
  const mindosDir = path.join(os.homedir(), '.mindos');
  const storage = new CronStorage(os.homedir());
  // Patch internal paths: ~/.pi/ → ~/.mindos/
  (storage as any).piDir = mindosDir;
  (storage as any).storePath = path.join(mindosDir, 'schedule-prompts.json');
  return storage;
}

export default async function mindosSchedulePrompt(pi: ExtensionAPI) {
  let storage: CronStorage;
  let scheduler: CronScheduler;

  // Register the tool once with getter functions
  const tool = createCronTool(
    () => storage,
    () => scheduler,
  );
  pi.registerTool(tool);

  // --- Session initialization ---

  const initializeSession = () => {
    storage = createMindOSStorage();
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

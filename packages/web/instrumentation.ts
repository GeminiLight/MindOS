import { getProjectRoot, resolveMindosCliLibPath } from '@/lib/project-root';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const { homedir } = await import('os');
    try {
      const configPath = join(homedir(), '.mindos', 'config.json');
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (config.sync?.enabled && config.mindRoot) {
        // Turbopack statically analyzes ALL forms of require/import — including
        // createRequire() calls. The only way to load a runtime-computed path
        // is to hide the require call inside a Function constructor, which is
        // opaque to bundler static analysis.
        const syncModule = resolveMindosCliLibPath('sync.js');
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const dynamicRequire = new Function('id', 'return require(id)') as (id: string) => any;
        const { startSyncDaemon } = dynamicRequire(syncModule);
        await startSyncDaemon(config.mindRoot);
      }
    } catch {
      // Sync not configured or failed to start — silently skip
    }

    // Cold-start index prewarming: build file tree cache + search index
    // in the background so the first search doesn't block.
    process.nextTick(async () => {
      try {
        const { getFileTree, startFileWatcher } = await import('@/lib/fs');
        getFileTree();       // Builds file tree cache + starts file watcher
        startFileWatcher();  // Ensure watcher is running
      } catch {
        // mindRoot not configured yet — skip prewarming
      }
    });

    // Skill auto-update: check if bundled skills are newer than installed
    // ones (covers both CLI startup and Desktop hot-update restarts).
    process.nextTick(async () => {
      try {
        const projRoot = getProjectRoot();
        const skillCheckModule = resolveMindosCliLibPath('skill-check.js');
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const dynamicRequireSkill = new Function('id', 'return require(id)') as (id: string) => any;
        const { checkSkillVersions, updateSkill } = dynamicRequireSkill(skillCheckModule);
        const mismatches = checkSkillVersions(projRoot);
        for (const m of mismatches) {
          try {
            updateSkill(m.bundledPath, m.installPath);
            console.log(`[SkillSync] Updated ${m.name}${m.agent ? ` (${m.agent})` : ''}: v${m.installed} → v${m.bundled}`);
          } catch (err) {
            console.warn(`[SkillSync] Failed to update ${m.name}: ${err instanceof Error ? err.message : err}`);
          }
        }
      } catch {
        // skill-check not available or failed — silently skip
      }
    });
    // Feishu long connection: auto-start WSClient if configured
    process.nextTick(async () => {
      try {
        const { autoStartFeishuWSIfNeeded } = await import('@/lib/im/feishu-ws-client');
        await autoStartFeishuWSIfNeeded();
      } catch {
        // Feishu WS not configured or failed — silently skip
      }
    });
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { readFileSync } = await import('fs');
    const { join, resolve } = await import('path');
    const { homedir } = await import('os');
    try {
      const configPath = join(homedir(), '.mindos', 'config.json');
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (config.sync?.enabled && config.mindRoot) {
        // Turbopack statically analyzes ALL forms of require/import — including
        // createRequire() calls. The only way to load a runtime-computed path
        // is to hide the require call inside a Function constructor, which is
        // opaque to bundler static analysis.
        const projRoot = process.env.MINDOS_PROJECT_ROOT || resolve(process.cwd(), '..');
        const syncModule = resolve(projRoot, 'bin', 'lib', 'sync.js');
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const dynamicRequire = new Function('id', 'return require(id)') as (id: string) => any;
        const { startSyncDaemon } = dynamicRequire(syncModule);
        await startSyncDaemon(config.mindRoot);
      }
    } catch {
      // Sync not configured or failed to start — silently skip
    }
  }
}

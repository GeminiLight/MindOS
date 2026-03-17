export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { readFileSync } = await import('fs');
    const { join, resolve } = await import('path');
    const { homedir } = await import('os');
    try {
      const configPath = join(homedir(), '.mindos', 'config.json');
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (config.sync?.enabled && config.mindRoot) {
        // Resolve absolute path to avoid Turbopack bundling issues
        const syncModule = resolve(process.cwd(), '..', 'bin', 'lib', 'sync.js');
        const { startSyncDaemon } = await import(/* webpackIgnore: true */ syncModule);
        await startSyncDaemon(config.mindRoot);
      }
    } catch {
      // Sync not configured or failed to start — silently skip
    }
  }
}

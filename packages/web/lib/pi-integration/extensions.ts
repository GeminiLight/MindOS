import fs from 'fs';
import os from 'os';
import path from 'path';
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';

export function getMindosExtensionsDir(): string {
  return path.join(os.homedir(), '.mindos', 'extensions');
}

/**
 * Memo for `scanExtensionPaths`, keyed by (dir, dir mtime). Adding, removing or
 * renaming an entry under `~/.mindos/extensions` bumps the directory mtime, so
 * an unchanged directory across turns costs one `statSync` and no `readdirSync`.
 * `invalidateExtensionScanCache()` is the explicit hook for settings/install
 * flows that change extension contents without touching the top-level dir mtime
 * (e.g. writing an `index.ts` inside an existing subdir).
 */
let extensionScanMemo: { dir: string; mtimeMs: number; paths: string[] } | null = null;

export function invalidateExtensionScanCache(): void {
  extensionScanMemo = null;
}

/** Scan ~/.mindos/extensions/ for .ts files and index.ts in subdirs (memoised per dir mtime). */
export function scanExtensionPaths(): string[] {
  const dir = getMindosExtensionsDir();
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dir);
  } catch {
    extensionScanMemo = null;
    return [];
  }
  if (!stat.isDirectory()) {
    extensionScanMemo = null;
    return [];
  }
  if (extensionScanMemo && extensionScanMemo.dir === dir && extensionScanMemo.mtimeMs === stat.mtimeMs) {
    return [...extensionScanMemo.paths];
  }
  const paths: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      paths.push(path.join(dir, entry.name));
    } else if (entry.isDirectory()) {
      const indexPath = path.join(dir, entry.name, 'index.ts');
      if (fs.existsSync(indexPath)) paths.push(indexPath);
    }
  }
  extensionScanMemo = { dir, mtimeMs: stat.mtimeMs, paths };
  return [...paths];
}

export interface ExtensionSummary {
  name: string;
  path: string;
  enabled: boolean;
  tools: string[];
  commands: string[];
}

export async function getExtensionsList(
  projectRoot: string,
  _mindRoot: string,
  disabledExtensions: string[] = [],
): Promise<ExtensionSummary[]> {
  const settingsManager = SettingsManager.inMemory();

  const loader = new DefaultResourceLoader({
    cwd: projectRoot,
    agentDir: path.join(os.homedir(), '.pi'),
    settingsManager,
    systemPrompt: '',
    appendSystemPrompt: [],
    additionalSkillPaths: [],
    additionalExtensionPaths: scanExtensionPaths(),
  });

  try {
    await loader.reload();
    const result = loader.getExtensions();

    return result.extensions.map((ext) => {
      const name = path.basename(ext.path, path.extname(ext.path));
      return {
        name,
        path: ext.resolvedPath || ext.path,
        enabled: !disabledExtensions.includes(name),
        tools: [...ext.tools.keys()],
        commands: [...ext.commands.keys()],
      };
    });
  } catch (error) {
    console.error('[getExtensionsList] Failed to load extensions:', error);
    return [];
  }
}

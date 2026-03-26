import fs from 'fs';
import os from 'os';
import path from 'path';
import { DefaultResourceLoader, SettingsManager } from '@mariozechner/pi-coding-agent';

export function getMindosExtensionsDir(): string {
  return path.join(os.homedir(), '.mindos', 'extensions');
}

/** Scan ~/.mindos/extensions/ for .ts files and index.ts in subdirs */
export function scanExtensionPaths(): string[] {
  const dir = getMindosExtensionsDir();
  if (!fs.existsSync(dir)) return [];
  const paths: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      paths.push(path.join(dir, entry.name));
    } else if (entry.isDirectory()) {
      const indexPath = path.join(dir, entry.name, 'index.ts');
      if (fs.existsSync(indexPath)) paths.push(indexPath);
    }
  }
  return paths;
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
    settingsManager,
    systemPromptOverride: () => '',
    appendSystemPromptOverride: () => [],
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

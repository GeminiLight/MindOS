import path from 'path';
import { DefaultResourceLoader, SettingsManager } from '@mariozechner/pi-coding-agent';

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

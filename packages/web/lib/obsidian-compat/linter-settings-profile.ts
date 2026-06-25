import {
  normalizeObsidianLinterRuleProfile,
  type ObsidianLinterAdapterRuleId,
  type ObsidianLinterRuleProfile,
} from './linter-adapter';

export const OBSIDIAN_LINTER_PLUGIN_ID = 'obsidian-linter';

export interface ObsidianLinterDataJsonRuleMapping {
  obsidianRule: string;
  mindosRule: ObsidianLinterAdapterRuleId;
}

export interface ImportedObsidianLinterProfile {
  schemaVersion: 1;
  source: 'obsidian-linter-data-json';
  pluginId: typeof OBSIDIAN_LINTER_PLUGIN_ID;
  profile: ObsidianLinterRuleProfile;
  mappedRules: ObsidianLinterAdapterRuleId[];
  ignoredRules: string[];
  warnings: string[];
}

export const OBSIDIAN_LINTER_DATA_JSON_RULE_MAPPINGS: readonly ObsidianLinterDataJsonRuleMapping[] = [
  {
    obsidianRule: 'trailing-spaces',
    mindosRule: 'trailing-whitespace',
  },
  {
    obsidianRule: 'consecutive-blank-lines',
    mindosRule: 'multiple-blank-lines',
  },
  {
    obsidianRule: 'line-break-at-document-end',
    mindosRule: 'missing-final-newline',
  },
] as const;

const MAPPED_OBSIDIAN_RULES = new Set(OBSIDIAN_LINTER_DATA_JSON_RULE_MAPPINGS.map((mapping) => mapping.obsidianRule));

export function buildImportedObsidianLinterProfile(
  pluginId: string,
  dataJson: unknown,
): ImportedObsidianLinterProfile | null {
  if (pluginId !== OBSIDIAN_LINTER_PLUGIN_ID || !isRecord(dataJson)) {
    return null;
  }

  const ruleConfigs = dataJson.ruleConfigs;
  if (!isRecord(ruleConfigs)) {
    return null;
  }

  const enabledRules: Partial<Record<ObsidianLinterAdapterRuleId, boolean>> = {};
  const mappedRules: ObsidianLinterAdapterRuleId[] = [];
  const warnings: string[] = [];

  for (const mapping of OBSIDIAN_LINTER_DATA_JSON_RULE_MAPPINGS) {
    const ruleConfig = ruleConfigs[mapping.obsidianRule];
    if (ruleConfig === undefined) {
      continue;
    }
    if (!isRecord(ruleConfig)) {
      warnings.push(`Ignored ruleConfigs.${mapping.obsidianRule}: expected an object.`);
      continue;
    }

    const enabled = ruleConfig.enabled;
    if (typeof enabled !== 'boolean') {
      if (enabled !== undefined) {
        warnings.push(`Ignored ruleConfigs.${mapping.obsidianRule}.enabled: expected a boolean.`);
      }
      continue;
    }

    enabledRules[mapping.mindosRule] = enabled;
    mappedRules.push(mapping.mindosRule);

    if (mapping.obsidianRule === 'trailing-spaces' && ruleConfig.twoSpaceLineBreak === true) {
      warnings.push('Ignored ruleConfigs.trailing-spaces.twoSpaceLineBreak: MindOS currently imports only the rule enabled state.');
    }
  }

  if (mappedRules.length === 0) {
    return null;
  }

  const ignoredRules = Object.entries(ruleConfigs)
    .filter(([obsidianRule, config]) => {
      if (MAPPED_OBSIDIAN_RULES.has(obsidianRule)) {
        return false;
      }
      return isRecord(config) && typeof config.enabled === 'boolean';
    })
    .map(([obsidianRule]) => obsidianRule)
    .sort((a, b) => a.localeCompare(b, 'en'));

  return {
    schemaVersion: 1,
    source: 'obsidian-linter-data-json',
    pluginId: OBSIDIAN_LINTER_PLUGIN_ID,
    profile: normalizeObsidianLinterRuleProfile({ enabledRules }),
    mappedRules,
    ignoredRules,
    warnings,
  };
}

export function parseImportedObsidianLinterProfileJson(
  pluginId: string,
  rawDataJson: string,
): ImportedObsidianLinterProfile | null {
  try {
    return buildImportedObsidianLinterProfile(pluginId, JSON.parse(rawDataJson));
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

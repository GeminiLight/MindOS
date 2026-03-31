#!/usr/bin/env node
/**
 * generate-explore.ts — YAML → TypeScript code generator for Explore use cases.
 *
 * Reads: components/explore/use-cases.yaml (single source of truth)
 * Generates:
 *   1. components/explore/use-cases.generated.ts  (UseCase[] array + types)
 *   2. lib/i18n/generated/explore-i18n.generated.ts  (zh + en translation objects)
 *
 * Run: npx tsx scripts/generate-explore.ts
 * Or:  npm run generate  (via package.json hook)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import yaml from 'js-yaml';

const BANNER = '// ⚠️ AUTO-GENERATED — DO NOT EDIT. Source: components/explore/use-cases.yaml\n// Run `npm run generate` to regenerate.\n';

interface YamlText { title: string; desc: string; prompt: string }
interface YamlCase {
  id: string;
  icon: string;
  image?: string;
  category: string;
  scenario: string;
  zh: YamlText;
  en: YamlText;
}
interface YamlMeta {
  categories: Record<string, { en: string; zh: string }>;
  scenarios: Record<string, { en: string; zh: string }>;
  ui: Record<string, { en: string; zh: string }>;
}
interface YamlRoot { meta: YamlMeta; cases: YamlCase[] }

// ── Load YAML ──
const appDir = resolve(__dirname, '..');
const yamlPath = resolve(appDir, 'components/explore/use-cases.yaml');
const raw = readFileSync(yamlPath, 'utf-8');
const data = yaml.load(raw) as YamlRoot;

if (!data?.cases?.length) {
  console.error('[generate-explore] No cases found in YAML');
  process.exit(1);
}
if (!data?.meta) {
  console.error('[generate-explore] No meta section found in YAML');
  process.exit(1);
}

// ── Validate ──
const validCategories = new Set(Object.keys(data.meta.categories));
const validScenarios = new Set(Object.keys(data.meta.scenarios));
for (const c of data.cases) {
  if (!c.id || !c.icon || !c.category || !c.scenario || !c.zh || !c.en) {
    console.error(`[generate-explore] Invalid case: ${JSON.stringify(c)}`);
    process.exit(1);
  }
  if (!validCategories.has(c.category)) {
    console.error(`[generate-explore] Unknown category "${c.category}" in case ${c.id}`);
    process.exit(1);
  }
  if (!validScenarios.has(c.scenario)) {
    console.error(`[generate-explore] Unknown scenario "${c.scenario}" in case ${c.id}`);
    process.exit(1);
  }
}

// ── Generate use-cases.generated.ts ──
const categoryUnion = Object.keys(data.meta.categories).map(k => `'${k}'`).join(' | ');
const scenarioUnion = Object.keys(data.meta.scenarios).map(k => `'${k}'`).join(' | ');

const useCasesTs = `${BANNER}
/** Capability axis — maps to product pillars */
export type UseCaseCategory = ${categoryUnion};

/** Scenario axis — maps to user journey phase */
export type UseCaseScenario = ${scenarioUnion};

export interface UseCase {
  id: string;
  icon: string;
  image?: string;
  category: UseCaseCategory;
  scenario: UseCaseScenario;
}

export const useCases: UseCase[] = ${JSON.stringify(
  data.cases.map(c => ({
    id: c.id,
    icon: c.icon,
    ...(c.image ? { image: c.image } : {}),
    category: c.category,
    scenario: c.scenario,
  })),
  null,
  2,
)};

export const categories: UseCaseCategory[] = ${JSON.stringify(Object.keys(data.meta.categories))};
export const scenarios: UseCaseScenario[] = ${JSON.stringify(Object.keys(data.meta.scenarios))};
`;

const useCasesPath = resolve(appDir, 'components/explore/use-cases.generated.ts');
writeFileSync(useCasesPath, useCasesTs, 'utf-8');
console.log(`[generate-explore] ✓ ${useCasesPath}`);

// ── Generate explore-i18n.generated.ts ──
function buildI18n(lang: 'en' | 'zh') {
  const ui: Record<string, string> = {};
  for (const [key, val] of Object.entries(data.meta.ui)) {
    ui[key] = val[lang];
  }

  const categories: Record<string, string> = {};
  for (const [key, val] of Object.entries(data.meta.categories)) {
    categories[key] = val[lang];
  }

  const scenarios: Record<string, string> = {};
  for (const [key, val] of Object.entries(data.meta.scenarios)) {
    scenarios[key] = val[lang];
  }

  const cases: Record<string, { title: string; desc: string; prompt: string }> = {};
  for (const c of data.cases) {
    cases[c.id] = c[lang];
  }

  return { ...ui, categories, scenarios, ...cases };
}

const i18nTs = `${BANNER}
export const exploreEn = ${JSON.stringify(buildI18n('en'), null, 2)} as const;

export const exploreZh = ${JSON.stringify(buildI18n('zh'), null, 2)} as const;
`;

const i18nDir = resolve(appDir, 'lib/i18n/generated');
mkdirSync(i18nDir, { recursive: true });
const i18nPath = resolve(i18nDir, 'explore-i18n.generated.ts');
writeFileSync(i18nPath, i18nTs, 'utf-8');
console.log(`[generate-explore] ✓ ${i18nPath}`);

console.log(`[generate-explore] Done — ${data.cases.length} use cases generated.`);

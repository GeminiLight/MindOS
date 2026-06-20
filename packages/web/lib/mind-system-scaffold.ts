import fs from 'fs';
import path from 'path';
import { defaultMindSystemSlots, type MindSystemSlot } from './mind-system';

export const CURRENT_MIND_SYSTEM_SCAFFOLD_VERSION = 2;
const LEGACY_MIND_SYSTEM_SCAFFOLD_VERSIONS = [1] as const;
const MIND_SYSTEM_SLOT_KEYS: readonly MindSystemSlot['key'][] = ['dao', 'fa', 'shu', 'qi'];

export const README_BY_MIND_SYSTEM_SLOT: Record<MindSystemSlot['key'], string> = {
  dao: '# 道\n\n价值、方向、长期判断。\n',
  fa: '# 法\n\n规则、边界、承诺。\n',
  shu: '# 术\n\n方法、流程、SOP、可复用套路。\n',
  qi: '# 器\n\n工具、资产、资料源、模板。\n',
};

const INSTRUCTION_BODY_BY_MIND_SYSTEM_SLOT: Record<MindSystemSlot['key'], string> = {
  dao: `
# 道 / Dao Instructions

Use this space for values, direction, and long-term judgment.

Agent rules:

- Save durable principles, worldview notes, and strategic decisions here.
- Prefer stable context over temporary status updates.
- Do not put tools, SOPs, or raw assets here unless they directly support a long-term judgment.
- When adding a note, make the underlying belief or decision explicit.
`,
  fa: `
# 法 / Fa Instructions

Use this space for rules, boundaries, protocols, and commitments.

Agent rules:

- Save operating rules, constraints, standards, agreements, and policies here.
- Prefer clear do / do-not wording.
- Link to supporting examples when useful, but keep the rule itself concise.
- Do not put one-off tactics or tool inventories here.
`,
  shu: `
# 术 / Shu Instructions

Use this space for methods, workflows, SOPs, and reusable tactics.

Agent rules:

- Save repeatable procedures, checklists, prompts, debugging playbooks, and execution patterns here.
- Write steps so they can be reused by a future agent or human.
- Include preconditions, failure modes, and verification checks when relevant.
- Do not put strategic principles or tool inventories here unless they are part of a workflow.
`,
  qi: `
# 器 / Qi Instructions

Use this space for tools, assets, templates, references, and resource inventories.

Agent rules:

- Save concrete tools, links, templates, config notes, datasets, and reusable assets here.
- Record how to access or operate an asset, not only that it exists.
- Keep resource notes scannable with names, paths, owners, and usage constraints when known.
- Do not put general principles or full SOPs here unless the asset requires them.
`,
};

export const INSTRUCTION_BY_MIND_SYSTEM_SLOT: Record<MindSystemSlot['key'], string> =
  mapMindSystemSlots(key => buildMindSystemInstruction(key, CURRENT_MIND_SYSTEM_SCAFFOLD_VERSION));

const LEGACY_INSTRUCTION_BY_MIND_SYSTEM_SLOT: Record<MindSystemSlot['key'], string[]> =
  mapMindSystemSlots(key => LEGACY_MIND_SYSTEM_SCAFFOLD_VERSIONS.map(version => buildMindSystemInstruction(key, version)));

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function mapMindSystemSlots<T>(buildValue: (key: MindSystemSlot['key']) => T): Record<MindSystemSlot['key'], T> {
  return Object.fromEntries(MIND_SYSTEM_SLOT_KEYS.map(key => [key, buildValue(key)])) as Record<MindSystemSlot['key'], T>;
}

function buildMindSystemInstruction(key: MindSystemSlot['key'], version: number): string {
  const slot = defaultMindSystemSlots().find(item => item.key === key);
  if (!slot) throw new Error(`Unknown Mind System slot: ${key}`);
  return `---
mindSpace:
  id: ${key}
  type: system
  source: builtin
  version: ${version}
  locale: zh
  order: ${slot.order}
---${INSTRUCTION_BODY_BY_MIND_SYSTEM_SLOT[key]}`;
}

export interface MindSystemScaffoldDescriptor {
  currentContent: string;
  knownDefaultContents: string[];
}

export function getDefaultMindSystemScaffoldContent(relativePath: string): string | null {
  return getMindSystemScaffoldDescriptor(relativePath)?.currentContent ?? null;
}

export function getMindSystemScaffoldDescriptor(relativePath: string): MindSystemScaffoldDescriptor | null {
  const normalized = normalizeRelativePath(relativePath);
  for (const slot of defaultMindSystemSlots()) {
    if (normalized === `${slot.path}/README.md`) {
      const currentContent = README_BY_MIND_SYSTEM_SLOT[slot.key];
      return {
        currentContent,
        knownDefaultContents: [currentContent],
      };
    }
    if (normalized === `${slot.path}/INSTRUCTION.md`) {
      const currentContent = INSTRUCTION_BY_MIND_SYSTEM_SLOT[slot.key];
      return {
        currentContent,
        knownDefaultContents: Array.from(new Set([
          currentContent,
          ...LEGACY_INSTRUCTION_BY_MIND_SYSTEM_SLOT[slot.key],
        ])),
      };
    }
  }
  return null;
}

export function isDefaultMindSystemScaffoldFile(mindRoot: string, relativePath: string): boolean {
  const descriptor = getMindSystemScaffoldDescriptor(relativePath);
  if (!descriptor) return false;
  try {
    return descriptor.knownDefaultContents.includes(fs.readFileSync(path.join(mindRoot, relativePath), 'utf-8'));
  } catch {
    return false;
  }
}

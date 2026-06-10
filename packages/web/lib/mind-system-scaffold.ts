import fs from 'fs';
import path from 'path';
import { defaultMindSystemConfig, type MindSystemSlot } from './mind-system';

export const README_BY_MIND_SYSTEM_SLOT: Record<MindSystemSlot['key'], string> = {
  dao: '# 道\n\n价值、方向、长期判断。\n',
  fa: '# 法\n\n规则、边界、承诺。\n',
  shu: '# 术\n\n方法、流程、SOP、可复用套路。\n',
  qi: '# 器\n\n工具、资产、资料源、模板。\n',
};

export const INSTRUCTION_BY_MIND_SYSTEM_SLOT: Record<MindSystemSlot['key'], string> = {
  dao: `# 道 / Dao Instructions

Use this space for values, direction, and long-term judgment.

Agent rules:

- Save durable principles, worldview notes, and strategic decisions here.
- Prefer stable context over temporary status updates.
- Do not put tools, SOPs, or raw assets here unless they directly support a long-term judgment.
- When adding a note, make the underlying belief or decision explicit.
`,
  fa: `# 法 / Fa Instructions

Use this space for rules, boundaries, protocols, and commitments.

Agent rules:

- Save operating rules, constraints, standards, agreements, and policies here.
- Prefer clear do / do-not wording.
- Link to supporting examples when useful, but keep the rule itself concise.
- Do not put one-off tactics or tool inventories here.
`,
  shu: `# 术 / Shu Instructions

Use this space for methods, workflows, SOPs, and reusable tactics.

Agent rules:

- Save repeatable procedures, checklists, prompts, debugging playbooks, and execution patterns here.
- Write steps so they can be reused by a future agent or human.
- Include preconditions, failure modes, and verification checks when relevant.
- Do not put strategic principles or tool inventories here unless they are part of a workflow.
`,
  qi: `# 器 / Qi Instructions

Use this space for tools, assets, templates, references, and resource inventories.

Agent rules:

- Save concrete tools, links, templates, config notes, datasets, and reusable assets here.
- Record how to access or operate an asset, not only that it exists.
- Keep resource notes scannable with names, paths, owners, and usage constraints when known.
- Do not put general principles or full SOPs here unless the asset requires them.
`,
};

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

export function getDefaultMindSystemScaffoldContent(relativePath: string): string | null {
  const normalized = normalizeRelativePath(relativePath);
  for (const slot of Object.values(defaultMindSystemConfig().slots)) {
    if (normalized === `${slot.path}/README.md`) return README_BY_MIND_SYSTEM_SLOT[slot.key];
    if (normalized === `${slot.path}/INSTRUCTION.md`) return INSTRUCTION_BY_MIND_SYSTEM_SLOT[slot.key];
  }
  return null;
}

export function isDefaultMindSystemScaffoldFile(mindRoot: string, relativePath: string): boolean {
  const expected = getDefaultMindSystemScaffoldContent(relativePath);
  if (expected === null) return false;
  try {
    return fs.readFileSync(path.join(mindRoot, relativePath), 'utf-8') === expected;
  } catch {
    return false;
  }
}

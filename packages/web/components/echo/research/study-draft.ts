import type { StudyProtocol } from '@geminilight/mindos/knowledge';
export type StudyLocale = 'en' | 'zh';
export const studyPhases = ['baseline', 'coaching', 'transfer', 'delayed'] as const;
export function blankCondition(id: string): StudyProtocol['conditions'][number] {
  return { id, label: '', instructions: '', expectedRuntime: { provider: '', model: '', tools: [], context: '' } };
}
export function blankStudyProtocol(locale: StudyLocale): StudyProtocol {
  return {
    title: '', hypothesis: '', consent: '', withdrawal: '', locale, capacity: 20, delayDays: 7,
    conditions: [blankCondition('condition-a'), blankCondition('condition-b')],
    tasks: studyPhases.map(phase => ({ phase, prompt: '', reference: '', budgetSeconds: 900 })),
    rubric: [{ id: 'criterion-a', label: '', description: '', maxScore: 3 }],
  };
}
export type StudyField = { path: string; label: string; step: number; max: number; multiline?: boolean };
export function studyFields(protocol: StudyProtocol, locale: StudyLocale): StudyField[] {
  const zh = locale === 'zh';
  const fields: StudyField[] = [
    { path: 'title', label: zh ? '研究名称' : 'Study title', step: 0, max: 200 },
    { path: 'hypothesis', label: zh ? '想检验的假设' : 'Hypothesis to test', step: 0, max: 4000, multiline: true },
    { path: 'consent', label: zh ? '参与前的知情说明' : 'Information before consent', step: 0, max: 6000, multiline: true },
    { path: 'withdrawal', label: zh ? '退出与数据删除说明' : 'Withdrawal and data deletion', step: 0, max: 4000, multiline: true },
  ];
  protocol.conditions.forEach((_, index) => {
    if (protocol.execution) fields.push({ path: `conditions.${index}.expectedRuntime.endpoint`, label: `${zh ? '条件' : 'Condition'} ${index + 1} · ${zh ? '完整聊天接口地址' : 'Exact chat endpoint'}`, step: 1, max: 1000 });
    const prefix = `${zh ? '条件' : 'Condition'} ${index + 1}`;
    for (const [key, label, max, multiline] of [
      ['label', zh ? '名称' : 'name', 200, false], ['instructions', zh ? '练习说明' : 'practice instructions', 6000, true],
      ['expectedRuntime.provider', zh ? '模型提供方' : 'model provider', 120, false], ['expectedRuntime.model', zh ? '模型名称或版本' : 'model name or version', 200, false],
      ['expectedRuntime.context', zh ? '拟提供给 Agent 的材料' : 'planned Agent context', 12000, true],
    ] as const) fields.push({ path: `conditions.${index}.${key}`, label: prefix + ' · ' + label, step: 1, max, multiline });
  });
  protocol.tasks.forEach((_, index) => {
    const phase = (zh ? ['初始判断', '获得帮助的练习', '新情境', '延迟新情境'] : ['Initial judgment', 'Practice with help', 'New situation', 'Delayed situation'])[index];
    fields.push({ path: `tasks.${index}.prompt`, label: phase + (zh ? ' · 题目' : ' · task'), step: 2, max: 6000, multiline: true });
    fields.push({ path: `tasks.${index}.reference`, label: phase + (zh ? ' · 评分参考' : ' · scoring reference'), step: 2, max: 6000, multiline: true });
  });
  protocol.rubric.forEach((_, index) => {
    const prefix = `${zh ? '评分维度' : 'Criterion'} ${index + 1}`;
    fields.push({ path: `rubric.${index}.label`, label: prefix + (zh ? ' · 名称' : ' · name'), step: 3, max: 200 });
    fields.push({ path: `rubric.${index}.description`, label: prefix + (zh ? ' · 评分依据' : ' · scoring anchors'), step: 3, max: 3000, multiline: true });
  });
  return fields;
}
export function draftValue(protocol: StudyProtocol, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, protocol);
}
export function changeDraft(protocol: StudyProtocol, path: string, value: unknown) {
  const next = structuredClone(protocol); const keys = path.split('.');
  const parent = keys.slice(0, -1).reduce<unknown>((item, key) => (item as Record<string, unknown>)[key], next) as Record<string, unknown>;
  parent[keys.at(-1)!] = value; return next;
}

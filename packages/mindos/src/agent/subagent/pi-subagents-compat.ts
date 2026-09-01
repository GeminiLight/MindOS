/**
 * Compatibility boundary for pi-subagents inputs that predate workflowScript.
 *
 * New MindOS callers must use `{ agent, task }`, a named workflow, or
 * workflowScript. Only the ledger wrapper imports this module so legacy
 * tasks/chain payloads cannot spread back into prompts, demos, or product UI.
 */

const LEGACY_TOP_LEVEL_EXECUTION_FIELDS = new Set([
  'agent',
  'task',
  'tasks',
  'chain',
  'parallel',
  'concurrency',
  'chainDir',
  'clarify',
  'mindosOrchestration',
  'orchestrator',
]);

const ORCHESTRATION_ONLY_EXECUTION_FIELDS = new Set([
  'tasks',
  'subtasks',
  'chain',
  'mindosOrchestration',
  'orchestrator',
  'parallel',
  'concurrency',
  'chainDir',
  'clarify',
  'workflowScript',
  'workflowScriptPath',
  'workflow',
  'globalConcurrencyLimit',
  'maxSubagentSpawnsPerRun',
  'maxSubagentSpawnDepth',
]);

const LEGACY_CHILD_METADATA_FIELDS = new Set([
  'id',
  'key',
  'dependencies',
  'dependsOn',
  'count',
  'label',
  'phase',
]);

// pi-subagents validates keys at 128 characters and caps one workflow run at 64 children.
export const PI_SUBAGENT_MAX_WORKFLOW_KEY_LENGTH = 128;
const MAX_LEGACY_WORKFLOW_CHILDREN = 64;
const LEGACY_DEFAULT_CONCURRENCY = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function positiveSafeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function workflowKey(value: unknown, fallback: string, used: Set<string>): string {
  const candidate = typeof value === 'string'
    ? value
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^[^A-Za-z0-9]+|[-._]+$/g, '')
      .slice(0, PI_SUBAGENT_MAX_WORKFLOW_KEY_LENGTH)
      .replace(/[-._]+$/g, '')
    : '';
  const base = candidate || fallback;
  let key = base;
  let suffix = 2;
  while (used.has(key)) {
    const marker = `-${suffix}`;
    key = `${base.slice(0, PI_SUBAGENT_MAX_WORKFLOW_KEY_LENGTH - marker.length)}${marker}`;
    suffix += 1;
  }
  used.add(key);
  return key;
}

function legacyWorkflowChild(item: unknown): Record<string, unknown> | null {
  if (!isRecord(item)) return null;
  const agent = typeof item.agent === 'string' ? item.agent.trim() : '';
  const task = typeof item.task === 'string' ? item.task : undefined;
  if (!agent || (item.task !== undefined && task === undefined)) return null;
  return Object.fromEntries(Object.entries({ ...item, agent }).filter(
    ([key, value]) => !LEGACY_CHILD_METADATA_FIELDS.has(key) && value !== undefined,
  ));
}

function legacyWorkflowOuterParams(params: Record<string, unknown>): Record<string, unknown> {
  const normalized = Object.fromEntries(Object.entries(params).filter(
    ([key, value]) => !LEGACY_TOP_LEVEL_EXECUTION_FIELDS.has(key) && value !== undefined,
  ));
  const concurrency = positiveSafeInteger(params.concurrency);
  if (normalized.async === undefined) normalized.async = false;
  if (normalized.globalConcurrencyLimit === undefined) {
    normalized.globalConcurrencyLimit = concurrency ?? LEGACY_DEFAULT_CONCURRENCY;
  }
  return normalized;
}

export function directChildParams(params: unknown): Record<string, unknown> {
  if (!isRecord(params)) return {};
  return Object.fromEntries(Object.entries(params).filter(
    ([key, value]) => !ORCHESTRATION_ONLY_EXECUTION_FIELDS.has(key) && value !== undefined,
  ));
}

function legacyParallelWorkflowScript(items: unknown[]): string | null {
  const used = new Set<string>();
  const children: Record<string, unknown>[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const child = legacyWorkflowChild(item);
    if (!child) return null;
    const count = isRecord(item) && item.count !== undefined ? positiveSafeInteger(item.count) : 1;
    if (!count || count > MAX_LEGACY_WORKFLOW_CHILDREN
      || children.length + count > MAX_LEGACY_WORKFLOW_CHILDREN) return null;
    for (let copy = 0; copy < count; copy += 1) {
      const fallback = `task-${index + 1}${count > 1 ? `-${copy + 1}` : ''}`;
      children.push({
        key: workflowKey(isRecord(item) ? item.id : undefined, fallback, used),
        ...child,
      });
    }
  }
  return children.length > 0 ? `return runs.all(${JSON.stringify(children)});` : null;
}

function legacyChainWorkflowScript(items: unknown[], originalTask: unknown): string | null {
  const used = new Set<string>();
  const lines = [`const originalTask = ${JSON.stringify(typeof originalTask === 'string' ? originalTask : '')};`, 'let previous = "";'];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const child = legacyWorkflowChild(item);
    if (!child) return null;
    const key = workflowKey(isRecord(item) ? item.id : undefined, `step-${index + 1}`, used);
    const variable = `step${index + 1}`;
    const { task, ...controls } = child;
    const taskExpression = typeof task === 'string'
      ? `${JSON.stringify(task)}.replaceAll("{task}", originalTask).replaceAll("{previous}", previous)`
      : 'previous || originalTask';
    lines.push(`const ${variable} = await runs.run(${JSON.stringify(key)}, { ...${JSON.stringify(controls)}, task: ${taskExpression} });`);
    lines.push(`previous = ${variable}.output ?? "";`);
  }
  if (items.length === 0) return null;
  lines.push(`return step${items.length};`);
  return lines.join('\n');
}

export function normalizeLegacySubagentExecutionParams(params: unknown): unknown {
  if (!isRecord(params) || params.action !== undefined || params.workflowScript !== undefined
    || params.workflowScriptPath !== undefined || params.workflow !== undefined) return params;
  // Clarification needs interactive UI semantics that workflowScript does not expose.
  if (params.clarify === true) return params;
  if (params.concurrency !== undefined && !positiveSafeInteger(params.concurrency)) return params;

  if (Array.isArray(params.tasks)) {
    const workflowScript = legacyParallelWorkflowScript(params.tasks);
    return workflowScript ? { ...legacyWorkflowOuterParams(params), workflowScript } : params;
  }
  if (Array.isArray(params.chain)) {
    const workflowScript = legacyChainWorkflowScript(params.chain, params.task);
    return workflowScript ? { ...legacyWorkflowOuterParams(params), workflowScript } : params;
  }
  return params;
}

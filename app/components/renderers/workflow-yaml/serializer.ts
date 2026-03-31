import YAML from 'js-yaml';
import type { WorkflowYaml } from './types';

/**
 * Serialize a WorkflowYaml object to a YAML string.
 * Strips undefined/empty optional fields to keep output clean.
 */
export function serializeWorkflowYaml(workflow: WorkflowYaml): string {
  const clean: Record<string, unknown> = {
    title: workflow.title,
  };
  if (workflow.description) clean.description = workflow.description;
  if (workflow.workDir) clean.workDir = workflow.workDir;
  if (workflow.skills?.length) clean.skills = workflow.skills;
  if (workflow.tools?.length) clean.tools = workflow.tools;

  clean.steps = workflow.steps.map((step) => {
    const s: Record<string, unknown> = {
      id: step.id,
      name: step.name,
    };
    if (step.description) s.description = step.description;
    if (step.agent) s.agent = step.agent;
    if (step.model) s.model = step.model;
    if (step.skill) s.skill = step.skill;
    if (step.skills?.length) s.skills = step.skills;
    if (step.tools?.length) s.tools = step.tools;
    if (step.context?.length) s.context = step.context;
    s.prompt = step.prompt;
    if (step.timeout) s.timeout = step.timeout;
    return s;
  });

  return YAML.dump(clean, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
}

/** Generate a URL-safe step ID from a name */
export function generateStepId(name: string, existingIds: string[]): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'step';
  let id = base;
  let i = 2;
  while (existingIds.includes(id)) {
    id = `${base}-${i}`;
    i++;
  }
  return id;
}

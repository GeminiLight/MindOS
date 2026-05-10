import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import { json, type MindosServerResponse } from '../response.js';

export const WORKFLOWS_DIR = '.mindos/workflows';

export type WorkflowHandlerServices = {
  mindRoot: string;
};

export interface WorkflowListItem {
  path: string;
  fileName: string;
  title: string;
  description?: string;
  stepCount: number;
  mtime: number;
  error?: string;
}

const BLANK_TEMPLATE = `title: {TITLE}
description: ""

steps:
  - id: step-1
    name: Step 1
    prompt: |
      Describe what this step should do.
`;

export function handleWorkflowsGet(
  services: WorkflowHandlerServices,
): MindosServerResponse<{ workflows: WorkflowListItem[] }> {
  return json({ workflows: listWorkflows(services.mindRoot) });
}

export function handleWorkflowsPost(
  body: unknown,
  services: WorkflowHandlerServices,
): MindosServerResponse<{ path: string } | { error: string }> {
  const name = body && typeof body === 'object' && typeof (body as { name?: unknown }).name === 'string'
    ? (body as { name: string }).name.trim()
    : '';
  if (!name) {
    return json({ error: 'name is required' }, { status: 400 });
  }

  const title = normalizeWorkflowTitle(name);
  const safeName = sanitizeWorkflowFileBase(title);
  if (!safeName) {
    return json({ error: 'name must contain at least one valid filename character' }, { status: 400 });
  }

  const fileName = `${safeName}.flow.yaml`;
  try {
    const dir = resolveExistingSafe(services.mindRoot, WORKFLOWS_DIR);
    mkdirSync(dir, { recursive: true });
    const fullPath = resolveExistingSafe(services.mindRoot, `${WORKFLOWS_DIR}/${fileName}`);
    if (existsSync(fullPath)) {
      return json({ error: 'Workflow already exists' }, { status: 409 });
    }

    const templateName = body && typeof body === 'object' && typeof (body as { template?: unknown }).template === 'string'
      ? (body as { template: string }).template
      : 'blank';
    const content = resolveWorkflowTemplate(services.mindRoot, templateName, title);
    writeFileSync(fullPath, content, 'utf-8');
    return json({ path: `${WORKFLOWS_DIR}/${fileName}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/access denied|outside root|absolute paths/i.test(message)) return json({ error: 'Access denied' }, { status: 403 });
    return json({ error: message }, { status: 500 });
  }
}

function listWorkflows(mindRoot: string): WorkflowListItem[] {
  let dir: string;
  try {
    dir = resolveExistingSafe(mindRoot, WORKFLOWS_DIR);
  } catch {
    return [];
  }
  if (!existsSync(dir)) return [];

  const items: WorkflowListItem[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.flow\.(yaml|yml)$/i.test(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    const mtime = statSync(fullPath).mtimeMs;
    try {
      const content = readFileSync(fullPath, 'utf-8');
      const parsed = parseWorkflowYamlSummary(content, entry.name);
      items.push({
        path: `${WORKFLOWS_DIR}/${entry.name}`,
        fileName: entry.name,
        mtime,
        ...parsed,
      });
    } catch (error) {
      items.push({
        path: `${WORKFLOWS_DIR}/${entry.name}`,
        fileName: entry.name,
        title: titleFromFileName(entry.name),
        stepCount: 0,
        mtime,
        error: error instanceof Error ? error.message : 'Parse error',
      });
    }
  }

  return items.sort((a, b) => b.mtime - a.mtime);
}

function parseWorkflowYamlSummary(content: string, fileName: string): { title: string; description?: string; stepCount: number } {
  const title = scalarValue(content.match(/^title:\s*(.*)$/m)?.[1]) || titleFromFileName(fileName);
  const description = scalarValue(content.match(/^description:\s*(.*)$/m)?.[1]) || undefined;
  const stepsStart = content.search(/^steps:\s*$/m);
  const stepsBlock = stepsStart >= 0 ? content.slice(stepsStart) : '';
  const stepCount = (stepsBlock.match(/^\s*-\s+/gm) ?? []).length;
  return { title, description, stepCount };
}

function resolveWorkflowTemplate(mindRoot: string, templateName: string, title: string): string {
  if (templateName !== 'blank') {
    try {
      const dir = resolveExistingSafe(mindRoot, WORKFLOWS_DIR);
      const templateFile = readdirSync(dir).find((fileName) =>
        fileName.toLowerCase().includes(templateName.toLowerCase()) && /\.workflow\.(yaml|yml)$/i.test(fileName)
      );
      if (templateFile) {
        const templatePath = resolveExistingSafe(mindRoot, `${WORKFLOWS_DIR}/${templateFile}`);
        return readFileSync(templatePath, 'utf-8').replace(/^title:.*$/m, `title: ${yamlSingleQuoted(title)}`);
      }
    } catch {
      // Fall through to blank template.
    }
  }

  return BLANK_TEMPLATE.replace('{TITLE}', yamlSingleQuoted(title));
}

function scalarValue(raw: string | undefined): string {
  return (raw ?? '').trim().replace(/^['"]|['"]$/g, '');
}

function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.flow\.(yaml|yml)$/i, '');
}

function normalizeWorkflowTitle(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, 200);
}

function sanitizeWorkflowFileBase(title: string): string {
  return title
    .replace(/[/\\:*?"<>|\x00-\x1F]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.\s]+|[-.\s]+$/g, '')
    .slice(0, 120)
    .trim();
}

function yamlSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

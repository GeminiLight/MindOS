import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import YAML from 'js-yaml';
import { getMindRoot } from '@/lib/fs';

const WORKFLOWS_DIR = '.mindos/workflows';

function getWorkflowsDir(): string {
  return path.join(getMindRoot(), WORKFLOWS_DIR);
}

interface WorkflowListItem {
  path: string;
  fileName: string;
  title: string;
  description?: string;
  stepCount: number;
  mtime: number;
  error?: string;
}

function listWorkflows(): WorkflowListItem[] {
  const dir = getWorkflowsDir();
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const items: WorkflowListItem[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.workflow\.(yaml|yml)$/i.test(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const relativePath = path.join(WORKFLOWS_DIR, entry.name);
    const stat = fs.statSync(fullPath);

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const parsed = YAML.load(content, { schema: YAML.JSON_SCHEMA }) as Record<string, unknown> | null;

      if (!parsed || typeof parsed !== 'object') {
        items.push({
          path: relativePath,
          fileName: entry.name,
          title: entry.name.replace(/\.workflow\.(yaml|yml)$/i, ''),
          stepCount: 0,
          mtime: stat.mtimeMs,
          error: 'Invalid YAML',
        });
        continue;
      }

      const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
      items.push({
        path: relativePath,
        fileName: entry.name,
        title: typeof parsed.title === 'string' ? parsed.title : entry.name.replace(/\.workflow\.(yaml|yml)$/i, ''),
        description: typeof parsed.description === 'string' ? parsed.description : undefined,
        stepCount: steps.length,
        mtime: stat.mtimeMs,
      });
    } catch (err) {
      items.push({
        path: relativePath,
        fileName: entry.name,
        title: entry.name.replace(/\.workflow\.(yaml|yml)$/i, ''),
        stepCount: 0,
        mtime: stat.mtimeMs,
        error: err instanceof Error ? err.message : 'Parse error',
      });
    }
  }

  // Sort by mtime descending (most recent first)
  items.sort((a, b) => b.mtime - a.mtime);
  return items;
}

const BLANK_TEMPLATE = `title: {TITLE}
description: ""

steps:
  - id: step-1
    name: Step 1
    prompt: |
      Describe what this step should do.
`;

export async function GET() {
  try {
    const workflows = listWorkflows();
    return NextResponse.json({ workflows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list workflows' },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    // Sanitize filename
    const safeName = name.replace(/[/\\:*?"<>|]/g, '-');
    const fileName = `${safeName}.workflow.yaml`;
    const dir = getWorkflowsDir();

    // Create Workflows dir if needed
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const fullPath = path.join(dir, fileName);
    if (fs.existsSync(fullPath)) {
      return NextResponse.json({ error: 'Workflow already exists' }, { status: 409 });
    }

    // Generate content from template or blank
    const template = typeof body.template === 'string' ? body.template : 'blank';
    let content: string;

    if (template !== 'blank') {
      // Try to read template from templates dir
      const templateDir = path.join(getMindRoot(), WORKFLOWS_DIR);
      const templateFile = fs.readdirSync(templateDir).find(f =>
        f.toLowerCase().includes(template.toLowerCase()) && /\.workflow\.(yaml|yml)$/i.test(f)
      );
      if (templateFile) {
        content = fs.readFileSync(path.join(templateDir, templateFile), 'utf-8');
        // Replace title with user's name
        content = content.replace(/^title:.*$/m, `title: ${name}`);
      } else {
        content = BLANK_TEMPLATE.replace('{TITLE}', name);
      }
    } else {
      content = BLANK_TEMPLATE.replace('{TITLE}', name);
    }

    fs.writeFileSync(fullPath, content, 'utf-8');

    const relativePath = path.join(WORKFLOWS_DIR, fileName);
    return NextResponse.json({ path: relativePath });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create workflow' },
      { status: 500 },
    );
  }
}

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { json, type MindosServerResponse } from '../response.js';

const BUILTIN_TEMPLATES = new Set(['en', 'zh', 'empty']);

export type InitPostPayload = {
  template?: string;
};

export type InitHandlerServices = {
  mindRoot: string;
  templateRoots?: string[];
  runtimeRoot?: string;
  projectRoot?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
};

export function handleInitPost(
  body: InitPostPayload | unknown,
  services: InitHandlerServices,
): MindosServerResponse<{ ok: true; template: string } | { error: string }> {
  try {
    const template = body && typeof body === 'object' && typeof (body as InitPostPayload).template === 'string'
      ? (body as InitPostPayload).template
      : undefined;

    if (!template || !BUILTIN_TEMPLATES.has(template)) {
      return json({ error: `Invalid template: ${String(template)}` }, { status: 400 });
    }

    const templateDir = findTemplateDir(template, services);
    if (!templateDir) {
      return json({ error: `Template "${template}" not found at ${getTemplateRootCandidates(services).join(', ')}` }, { status: 404 });
    }

    if (!existsSync(services.mindRoot)) {
      mkdirSync(services.mindRoot, { recursive: true });
    }

    copyRecursiveSkipExisting(templateDir, services.mindRoot);
    return json({ ok: true, template });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

function findTemplateDir(template: string, services: InitHandlerServices): string | undefined {
  return getTemplateRootCandidates(services)
    .map((root) => join(root, template))
    .find((candidate) => existsSync(candidate));
}

function getTemplateRootCandidates(services: InitHandlerServices): string[] {
  if (services.templateRoots && services.templateRoots.length > 0) {
    return [...new Set(services.templateRoots)];
  }

  const env = services.env ?? process.env;
  const roots = [
    services.projectRoot ? join(services.projectRoot, 'templates') : undefined,
    env.MINDOS_PROJECT_ROOT ? join(env.MINDOS_PROJECT_ROOT, 'templates') : undefined,
    services.runtimeRoot ? join(services.runtimeRoot, 'templates') : undefined,
    join(findWorkspaceRoot(services.cwd ?? process.cwd()) ?? '', 'templates'),
    resolve(services.cwd ?? process.cwd(), '..', 'templates'),
    resolve(services.cwd ?? process.cwd(), 'templates'),
  ].filter((value): value is string => Boolean(value));

  return [...new Set(roots)];
}

function copyRecursiveSkipExisting(src: string, dest: string): void {
  const stats = statSync(src);
  if (stats.isDirectory()) {
    if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src)) {
      copyRecursiveSkipExisting(join(src, entry), join(dest, entry));
    }
    return;
  }

  if (existsSync(dest)) return;
  const parent = dirname(dest);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  copyFileSync(src, dest);
}

function findWorkspaceRoot(start: string): string | undefined {
  let current = resolve(start);
  for (let i = 0; i < 8; i += 1) {
    if (
      existsSync(resolve(current, 'pnpm-workspace.yaml')) ||
      existsSync(resolve(current, 'packages', 'mindos', 'package.json'))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

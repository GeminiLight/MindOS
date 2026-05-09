import path from 'node:path';
import { json, publicCacheHeaders, type MindosServerResponse } from '../response.js';

export type BootstrapHandlerServices = {
  collectAllFiles(): string[];
  readTextFile(path: string): string;
};

export type BootstrapPayload = {
  instruction?: string;
  index?: string;
  config_json?: string;
  user_skill_rules?: string;
  file_index: string;
  target_readme?: string;
  target_instruction?: string;
  target_config_json?: string;
};

export function handleBootstrapGet(
  query: URLSearchParams,
  services: BootstrapHandlerServices,
): MindosServerResponse<BootstrapPayload | { error: string }> {
  const targetDir = query.get('target_dir') ?? undefined;
  if (targetDir && (targetDir.includes('..') || path.isAbsolute(targetDir))) {
    return json({ error: 'invalid target_dir' }, { status: 400 });
  }

  const payload: BootstrapPayload = {
    instruction: tryRead(services, 'INSTRUCTION.md'),
    index: tryRead(services, 'README.md'),
    config_json: tryRead(services, 'CONFIG.json'),
    user_skill_rules: tryRead(services, '.mindos/user-preferences.md'),
    file_index: buildBootstrapFileIndex(services.collectAllFiles()),
  };

  if (targetDir) {
    payload.target_readme = tryRead(services, path.join(targetDir, 'README.md'));
    payload.target_instruction = tryRead(services, path.join(targetDir, 'INSTRUCTION.md'));
    payload.target_config_json = tryRead(services, path.join(targetDir, 'CONFIG.json'));
  }

  return json(payload, {
    headers: publicCacheHeaders(300, weakJsonEtag(payload)),
  });
}

export function buildBootstrapFileIndex(
  files: string[],
  options: { maxDepth?: number; maxFilesPerDir?: number } = {},
): string {
  const maxDepth = options.maxDepth ?? 2;
  const maxFilesPerDir = options.maxFilesPerDir ?? 15;
  const root: BootstrapTreeNode[] = [];

  for (const filePath of [...files].sort((a, b) => a.localeCompare(b))) {
    addFile(root, filePath.split('/').filter(Boolean));
  }

  if (root.length === 0) return '(empty knowledge base)';

  const lines: string[] = [];
  walk(root, 0);
  return lines.join('\n');

  function walk(nodes: BootstrapTreeNode[], depth: number) {
    const indent = '  '.repeat(depth);
    const dirs = nodes.filter((node) => node.type === 'directory');
    const fileNodes = nodes.filter((node) => node.type === 'file');

    for (const dir of dirs) {
      const total = countFiles(dir.children ?? []);
      const label = total === 1 ? '1 file' : `${total} files`;
      lines.push(`${indent}${dir.name}/ (${label})`);
      if (depth < maxDepth) {
        walk(dir.children ?? [], depth + 1);
      }
    }

    const shown = fileNodes.slice(0, maxFilesPerDir);
    for (const file of shown) {
      lines.push(`${indent}${file.name}`);
    }
    const remaining = fileNodes.length - shown.length;
    if (remaining > 0) {
      lines.push(`${indent}... (${remaining} more)`);
    }
  }
}

type BootstrapTreeNode = {
  name: string;
  type: 'file' | 'directory';
  children?: BootstrapTreeNode[];
};

function addFile(nodes: BootstrapTreeNode[], segments: string[]) {
  const [head, ...tail] = segments;
  if (!head) return;
  if (tail.length === 0) {
    nodes.push({ name: head, type: 'file' });
    return;
  }

  let dir = nodes.find((node) => node.type === 'directory' && node.name === head);
  if (!dir) {
    dir = { name: head, type: 'directory', children: [] };
    nodes.push(dir);
  }
  addFile(dir.children ?? [], tail);
}

function countFiles(nodes: BootstrapTreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.type === 'file') count++;
    else count += countFiles(node.children ?? []);
  }
  return count;
}

function tryRead(services: BootstrapHandlerServices, filePath: string): string | undefined {
  try {
    return services.readTextFile(filePath);
  } catch {
    return undefined;
  }
}

function weakJsonEtag(payload: BootstrapPayload): string {
  let hash = 0;
  const serialized = JSON.stringify(payload);
  for (let i = 0; i < serialized.length; i++) {
    hash = ((hash << 5) - hash + serialized.charCodeAt(i)) | 0;
  }
  return `W/"${Math.abs(hash).toString(16)}"`;
}

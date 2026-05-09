import { gitLog, gitShowFile, isGitRepo, type GitLogEntry } from '../../knowledge/git/index.js';
import { queryValue, type MindosRequestQuery } from '../context.js';
import { json, type MindosServerResponse } from '../response.js';

export type GitHandlerServices = {
  mindRoot?: string;
  isGitRepo?: () => Promise<boolean>;
  gitLog?: (path: string, limit: number) => Promise<GitLogEntry[]>;
  gitShowFile?: (path: string, commit: string) => Promise<string>;
};

export async function handleGit(
  query: MindosRequestQuery | undefined,
  services: GitHandlerServices,
): Promise<MindosServerResponse<{ isRepo: boolean } | { entries: GitLogEntry[] } | { content: string } | { error: string }>> {
  const op = queryValue(query, 'op') ?? 'is_repo';

  if (op === 'is_repo') {
    return json({ isRepo: await runIsGitRepo(services) });
  }

  if (op === 'history') {
    const filePath = queryValue(query, 'path');
    if (!filePath) return json({ error: 'missing path' }, { status: 400 });
    const limit = parseLimit(queryValue(query, 'limit'));
    const entries = await runGitLog(services, filePath, limit);
    return Array.isArray(entries) ? json({ entries }) : entries;
  }

  if (op === 'show') {
    const filePath = queryValue(query, 'path');
    const commit = queryValue(query, 'commit');
    if (!filePath) return json({ error: 'missing path' }, { status: 400 });
    if (!commit) return json({ error: 'missing commit' }, { status: 400 });
    const content = await runGitShowFile(services, filePath, commit);
    return typeof content === 'string' ? json({ content }) : content;
  }

  return json({ error: `unknown op: ${op}` }, { status: 400 });
}

function parseLimit(value: string | undefined): number {
  const parsed = value ? Number.parseInt(value, 10) : 10;
  if (!Number.isFinite(parsed)) return 10;
  return Math.max(1, Math.min(parsed, 100));
}

async function runIsGitRepo(services: GitHandlerServices): Promise<boolean> {
  if (services.isGitRepo) return services.isGitRepo();
  if (!services.mindRoot) return false;
  const result = await isGitRepo(services.mindRoot);
  return result.ok ? result.value : false;
}

async function runGitLog(
  services: GitHandlerServices,
  filePath: string,
  limit: number,
): Promise<GitLogEntry[] | MindosServerResponse<{ error: string }>> {
  if (services.gitLog) return services.gitLog(filePath, limit);
  if (!services.mindRoot) return json({ error: 'mindRoot required' }, { status: 500 });
  const result = await gitLog(services.mindRoot, filePath, limit);
  return result.ok ? result.value : json({ error: result.error.message }, { status: 500 });
}

async function runGitShowFile(
  services: GitHandlerServices,
  filePath: string,
  commit: string,
): Promise<string | MindosServerResponse<{ error: string }>> {
  if (services.gitShowFile) return services.gitShowFile(filePath, commit);
  if (!services.mindRoot) return json({ error: 'mindRoot required' }, { status: 500 });
  const result = await gitShowFile(services.mindRoot, filePath, commit);
  return result.ok ? result.value : json({ error: result.error.message }, { status: 500 });
}

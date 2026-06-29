import { apiFetch } from '@/lib/api';

export async function openMindPathInFileManager(path?: string): Promise<void> {
  const params = new URLSearchParams({ op: 'open_in_file_manager' });
  if (path) params.set('path', path);

  await apiFetch<{ ok: true }>(`/api/file?${params.toString()}`, {
    method: 'GET',
    cache: 'no-store',
    timeout: 10_000,
  });
}

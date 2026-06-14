export type CommunityVersionState = 'update-available' | 'up-to-date' | 'local-newer' | 'unknown';

function parseVersionSegments(version?: string): number[] | null {
  const normalized = version?.trim().replace(/^v/i, '');
  if (!normalized) return null;
  const parts = normalized.split('.');
  if (parts.some((part) => !/^\d+$/.test(part))) return null;
  return parts.map((part) => Number(part));
}

export function compareCommunityVersions(localVersion?: string, remoteVersion?: string): CommunityVersionState {
  const local = parseVersionSegments(localVersion);
  const remote = parseVersionSegments(remoteVersion);
  if (!local || !remote) return 'unknown';

  const length = Math.max(local.length, remote.length);
  for (let index = 0; index < length; index += 1) {
    const localPart = local[index] ?? 0;
    const remotePart = remote[index] ?? 0;
    if (remotePart > localPart) return 'update-available';
    if (remotePart < localPart) return 'local-newer';
  }
  return 'up-to-date';
}

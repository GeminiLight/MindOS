export type CommunityVersionState = 'update-available' | 'up-to-date' | 'local-newer' | 'unknown';

function parseVersionSegments(version?: string): number[] | null {
  const normalized = version?.trim().replace(/^v/i, '');
  if (!normalized) return null;
  const parts = normalized.split('.');
  if (parts.some((part) => !/^\d+$/.test(part))) return null;
  return parts.map((part) => Number(part));
}

export function compareCommunityVersionStrings(a?: string, b?: string): number | null {
  const left = parseVersionSegments(a);
  const right = parseVersionSegments(b);
  if (!left || !right) return null;

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }
  return 0;
}

export function isCommunityVersionAtMost(version: string | undefined, ceiling: string | undefined): boolean {
  const comparison = compareCommunityVersionStrings(version, ceiling);
  return comparison !== null && comparison <= 0;
}

export function compareCommunityVersions(localVersion?: string, remoteVersion?: string): CommunityVersionState {
  const comparison = compareCommunityVersionStrings(remoteVersion, localVersion);
  if (comparison === null) return 'unknown';
  if (comparison > 0) return 'update-available';
  if (comparison < 0) return 'local-newer';
  return 'up-to-date';
}

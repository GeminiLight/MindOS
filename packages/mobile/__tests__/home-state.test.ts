import { describe, expect, it } from 'vitest';
import { getHomeEmptyState } from '@/lib/home-state';

describe('home-state', () => {
  it('does not show an empty state when there are recent files', () => {
    expect(getHomeEmptyState({
      fileCount: 3,
      spaceCount: 1,
      recentCount: 2,
      hasError: false,
    })).toBeNull();
  });

  it('distinguishes Home load errors from an empty mind', () => {
    expect(getHomeEmptyState({
      fileCount: 0,
      spaceCount: 0,
      recentCount: 0,
      hasError: true,
    })).toMatchObject({
      icon: 'cloud-offline-outline',
      title: 'Home data unavailable',
    });
  });

  it('distinguishes spaces without notes from a totally empty mind', () => {
    expect(getHomeEmptyState({
      fileCount: 0,
      spaceCount: 2,
      recentCount: 0,
      hasError: false,
    })).toMatchObject({
      icon: 'layers-outline',
      title: 'Spaces are ready',
    });
  });

  it('shows a neutral empty note state for a completely empty mind', () => {
    expect(getHomeEmptyState({
      fileCount: 0,
      spaceCount: 0,
      recentCount: 0,
      hasError: false,
    })).toMatchObject({
      icon: 'archive-outline',
      title: 'No notes yet',
    });
  });

  it('handles files that are available but have no recent activity entry', () => {
    expect(getHomeEmptyState({
      fileCount: 2,
      spaceCount: 1,
      recentCount: 0,
      hasError: false,
    })).toMatchObject({
      icon: 'time-outline',
      title: 'No recent activity yet',
    });
  });
});

export interface HomeEmptyStateInput {
  fileCount: number;
  spaceCount: number;
  recentCount: number;
  hasError: boolean;
}

export interface HomeEmptyState {
  icon: string;
  title: string;
  message: string;
  actionLabel: string;
}

export function getHomeEmptyState({
  fileCount,
  spaceCount,
  recentCount,
  hasError,
}: HomeEmptyStateInput): HomeEmptyState | null {
  if (hasError) {
    return {
      icon: 'cloud-offline-outline',
      title: 'Home data unavailable',
      message: 'Quick Capture still works locally. Retry Home data, or open Files directly.',
      actionLabel: 'Open Files',
    };
  }

  if (recentCount > 0) return null;

  if (fileCount > 0) {
    return {
      icon: 'time-outline',
      title: 'No recent activity yet',
      message: 'Your notes are available in Files. Recently edited notes will appear here.',
      actionLabel: 'Open Files',
    };
  }

  if (spaceCount > 0) {
    return {
      icon: 'layers-outline',
      title: 'Spaces are ready',
      message: 'Create or capture your first note inside a Space to start building context.',
      actionLabel: 'Open Files',
    };
  }

  return {
    icon: 'archive-outline',
    title: 'No notes yet',
    message: 'Start with Quick Capture above, or create a full note in Files.',
    actionLabel: 'Open Files',
  };
}

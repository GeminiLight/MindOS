export const RECENT_FILES_WORKFLOW_PROBE_FIXTURE = {
  rows: [
    {
      path: 'Inbox/mindos-recent-alpha.md',
      basename: 'MindOS Recent Alpha',
      content: '# MindOS Recent Alpha\n\nSeeded for the Recent Files workflow probe.\n',
    },
    {
      path: 'Projects/mindos-recent-beta.md',
      basename: 'MindOS Recent Beta',
      content: '# MindOS Recent Beta\n\nSeeded for the Recent Files workflow probe.\n',
    },
  ],
} as const;

export function buildRecentFilesWorkflowProbeDataJson(): Record<string, unknown> {
  return {
    recentFiles: RECENT_FILES_WORKFLOW_PROBE_FIXTURE.rows.map((row) => ({
      basename: row.basename,
      path: row.path,
    })),
    omittedPaths: [],
    omittedTags: [],
    updateOn: 'file-open',
    omitBookmarks: false,
    maxLength: 50,
  };
}

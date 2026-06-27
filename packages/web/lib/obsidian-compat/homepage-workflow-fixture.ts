export const HOMEPAGE_WORKFLOW_PROBE_FIXTURE = {
  commandId: 'open-homepage',
  commandName: 'Open homepage',
  homepageName: 'Main Homepage',
  targetPath: 'Home/mindos-homepage.md',
  targetLink: 'Home/mindos-homepage',
  content: '# MindOS Homepage\n\nSeeded by the Homepage workflow probe.\n',
  expectedContent: 'Seeded by the Homepage workflow probe.',
} as const;

export function buildHomepageWorkflowProbeDataJson(): Record<string, unknown> {
  return {
    version: 4,
    separateMobile: false,
    homepages: {
      [HOMEPAGE_WORKFLOW_PROBE_FIXTURE.homepageName]: {
        value: HOMEPAGE_WORKFLOW_PROBE_FIXTURE.targetLink,
        kind: 'File',
        openOnStartup: false,
        openMode: 'Keep open notes',
        manualOpenMode: 'Keep open notes',
        view: 'Default view',
        revertView: false,
        openWhenEmpty: false,
        refreshDataview: false,
        autoCreate: false,
        autoScroll: false,
        pin: false,
        commands: [],
        alwaysApply: false,
        hideReleaseNotes: false,
      },
    },
  };
}

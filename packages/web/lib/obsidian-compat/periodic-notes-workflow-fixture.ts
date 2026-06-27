export const PERIODIC_NOTES_WORKFLOW_PROBE_FIXTURE = {
  periodicity: 'daily',
  commandId: 'open-daily-note',
  commandName: 'Open daily note',
  folder: 'Journal/Daily',
  format: '[mindos-periodic-daily]',
  templatePath: 'Templates/mindos-periodic-daily-template.md',
  targetPath: 'Journal/Daily/mindos-periodic-daily.md',
  templateContent: [
    '# {{title}}',
    '',
    'Seeded by the Periodic Notes workflow probe.',
    'Date token: {{date}}',
    'Tomorrow token: {{tomorrow}}',
    '',
  ].join('\n'),
  expectedContent: 'Seeded by the Periodic Notes workflow probe.',
} as const;

const disabledPeriod = {
  enabled: false,
  format: '',
  folder: '',
  template: '',
};

export function buildPeriodicNotesWorkflowProbeDataJson(): Record<string, unknown> {
  return {
    showGettingStartedBanner: false,
    hasMigratedDailyNoteSettings: false,
    hasMigratedWeeklyNoteSettings: false,
    daily: {
      enabled: true,
      format: PERIODIC_NOTES_WORKFLOW_PROBE_FIXTURE.format,
      folder: PERIODIC_NOTES_WORKFLOW_PROBE_FIXTURE.folder,
      template: PERIODIC_NOTES_WORKFLOW_PROBE_FIXTURE.templatePath,
    },
    weekly: { ...disabledPeriod },
    monthly: { ...disabledPeriod },
    quarterly: { ...disabledPeriod },
    yearly: { ...disabledPeriod },
  };
}

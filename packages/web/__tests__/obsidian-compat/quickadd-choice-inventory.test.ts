import { describe, expect, it } from 'vitest';
import { parseImportedQuickAddChoiceInventoryJson } from '@/lib/obsidian-compat/quickadd-choice-inventory';

describe('QuickAdd choice inventory import preview', () => {
  it('summarizes static command-enabled Capture and Template choices as a safe subset', () => {
    const inventory = parseImportedQuickAddChoiceInventoryJson('quickadd', JSON.stringify({
      choices: [
        {
          id: 'capture',
          name: 'Inbox Capture',
          type: 'Capture',
          command: true,
          onePageInput: 'never',
          captureTo: 'Inbox/capture.md',
          captureToActiveFile: false,
          captureToCanvasNodeId: '',
          useSelectionAsCaptureValue: false,
          format: { enabled: true, format: 'Captured text' },
          createFileIfItDoesntExist: { enabled: true, createWithTemplate: false },
          insertAfter: { enabled: false },
          insertBefore: { enabled: false },
          newLineCapture: { enabled: false },
          templater: { afterCapture: 'none' },
        },
        {
          id: 'template',
          name: 'Daily Note',
          type: 'Template',
          command: true,
          templatePath: 'Templates/daily.md',
          folder: {
            enabled: true,
            folders: ['Daily'],
            chooseWhenCreatingNote: false,
            createInSameFolderAsActiveFile: false,
            chooseFromSubfolders: false,
          },
          fileNameFormat: {
            enabled: true,
            format: 'today',
          },
        },
      ],
    }));

    expect(inventory).toMatchObject({
      schemaVersion: 1,
      source: 'quickadd-data-json',
      pluginId: 'quickadd',
      safeSubsetChoices: [
        'Capture: Inbox Capture -> Inbox/capture.md',
        'Template: Daily Note -> Daily/today.md from Templates/daily.md',
      ],
      reviewChoices: [],
      ignoredChoices: [],
      warnings: [],
    });
    expect(inventory?.choices).toEqual([
      expect.objectContaining({
        id: 'capture',
        kind: 'capture',
        support: 'safe-subset',
        targetPath: 'Inbox/capture.md',
      }),
      expect.objectContaining({
        id: 'template',
        kind: 'template',
        support: 'safe-subset',
        templatePath: 'Templates/daily.md',
        targetPathPreview: 'Daily/today.md',
      }),
    ]);
  });

  it('keeps command-enabled dynamic and unsupported choices in review instead of ignoring them', () => {
    const inventory = parseImportedQuickAddChoiceInventoryJson('quickadd', JSON.stringify({
      choices: [
        {
          id: 'macro',
          name: 'Run Macro',
          type: 'Macro',
          command: true,
        },
        {
          id: 'dynamic-template',
          name: 'Dynamic Template',
          type: 'Template',
          command: true,
          templatePath: 'Templates/daily.md',
          folder: {
            enabled: true,
            folders: ['Daily'],
            chooseWhenCreatingNote: false,
            createInSameFolderAsActiveFile: false,
            chooseFromSubfolders: false,
          },
          fileNameFormat: {
            enabled: true,
            format: '{{DATE}}',
          },
        },
        {
          id: 'active-capture',
          name: 'Active Capture',
          type: 'Capture',
          command: true,
          captureTo: 'Inbox/capture.md',
          captureToActiveFile: true,
        },
        {
          id: 'hidden-capture',
          name: 'Hidden Capture',
          type: 'Capture',
          command: false,
          captureTo: 'Inbox/hidden.md',
        },
      ],
    }));

    expect(inventory?.safeSubsetChoices).toEqual([]);
    expect(inventory?.reviewChoices).toEqual([
      'Macro: Run Macro (requires review)',
      'Template: Dynamic Template from Templates/daily.md',
      'Capture: Active Capture -> Inbox/capture.md',
    ]);
    expect(inventory?.ignoredChoices).toEqual([
      'Capture: Hidden Capture (not command-enabled)',
    ]);
    expect(inventory?.warnings).toEqual(expect.arrayContaining([
      'Template choice "Dynamic Template" has dynamic folder or filename settings that need review after import.',
      'Capture choice "Active Capture" requires review: target depends on the active file.',
    ]));
  });

  it('reports malformed data.json without throwing', () => {
    const inventory = parseImportedQuickAddChoiceInventoryJson('quickadd', '{not json');

    expect(inventory).toMatchObject({
      choices: [],
      safeSubsetChoices: [],
      reviewChoices: [],
      ignoredChoices: [],
      warnings: ['QuickAdd data.json could not be parsed.'],
    });
  });

  it('returns null when data.json is not a QuickAdd choices object', () => {
    expect(parseImportedQuickAddChoiceInventoryJson('quickadd', JSON.stringify({ version: '2.13.1' }))).toBeNull();
    expect(parseImportedQuickAddChoiceInventoryJson('quickadd', JSON.stringify([]))).toBeNull();
  });
});

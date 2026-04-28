import { describe, expect, it } from 'vitest';
import { manifest as agentInspectorManifest } from '@/components/renderers/agent-inspector/manifest';
import { manifest as changeLogManifest } from '@/components/renderers/change-log/manifest';
import { manifest as configPanelManifest } from '@/components/renderers/config/manifest';
import { manifest as csvManifest } from '@/components/renderers/csv/manifest';
import { manifest as todoManifest } from '@/components/renderers/todo/manifest';

describe('renderer surface classification', () => {
  it('marks CSV as app-builtin feature (not plugin surface)', () => {
    expect(csvManifest.id).toBe('csv');
    expect(csvManifest.appBuiltinFeature).toBe(true);
    expect(csvManifest.core).toBe(true);
  });

  it('marks TODO as app-builtin feature (not plugin surface)', () => {
    expect(todoManifest.id).toBe('todo');
    expect(todoManifest.appBuiltinFeature).toBe(true);
    expect(todoManifest.core).toBe(true);
  });

  it('marks Agent Inspector as app-builtin feature (not plugin surface)', () => {
    expect(agentInspectorManifest.id).toBe('agent-inspector');
    expect(agentInspectorManifest.appBuiltinFeature).toBe(true);
    expect(agentInspectorManifest.core).toBe(true);
  });

  it('marks Config Panel as app-builtin feature (not plugin surface)', () => {
    expect(configPanelManifest.id).toBe('config-panel');
    expect(configPanelManifest.appBuiltinFeature).toBe(true);
    expect(configPanelManifest.core).toBe(true);
  });

  it('marks Change Log as app-builtin feature (not plugin surface)', () => {
    expect(changeLogManifest.id).toBe('change-log');
    expect(changeLogManifest.appBuiltinFeature).toBe(true);
    expect(changeLogManifest.core).toBe(true);
  });

  it('change-log renderer matches .mindos/change-log.json', () => {
    expect(changeLogManifest.match({ filePath: '.mindos/change-log.json', extension: 'json' })).toBe(true);
    expect(changeLogManifest.match({ filePath: 'notes/change-log.json', extension: 'json' })).toBe(false);
    expect(changeLogManifest.match({ filePath: '.mindos/other.json', extension: 'json' })).toBe(false);
  });
});


import { describe, expect, it } from 'vitest';
import {
  assessMindosHumanSignal,
  intelligenceCapabilityBoundary,
  routeMindosHumanSignal,
} from './intelligence.js';

describe('MindOS intelligence facade', () => {
  it('declares intelligence as the pure algorithm layer rather than knowledge storage', () => {
    expect(intelligenceCapabilityBoundary).toMatchObject({
      owner: '@geminilight/mindos',
      loadMode: 'core',
      defaultRuntime: true,
      capabilities: ['cognition'],
      extensionSlots: ['memory', 'growth'],
      activation: 'internal-or-explicit',
    });
  });

  it('exposes cognition human modeling through the intelligence facade', () => {
    expect(routeMindosHumanSignal({ kind: 'asset', content: 'Prompt template library.' }).target).toBe('qi');
    expect(assessMindosHumanSignal({
      kind: 'boundary',
      content: 'Never silently overwrite user notes.',
      userConfirmed: true,
    }).action).toBe('promote');
  });
});

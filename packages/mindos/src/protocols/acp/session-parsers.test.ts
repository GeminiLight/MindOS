import { expect, it } from 'vitest';
import { parseAvailableCommands, parseConfigOptions } from './session-parsers.js';
it('preserves custom options, descriptions, grouped values and Agent order', () => {
  expect(parseConfigOptions([{ id: 'context_window', type: 'select', name: 'Context window', description: 'Budget for this session', category: 'model_config', currentValue: 'large', options: [{ group: 'sizes', name: 'Sizes', options: [{ value: 'large', name: 'Large', description: 'More context' }] }] }])).toEqual([{
    configId: 'context_window', type: 'select', label: 'Context window', description: 'Budget for this session', category: 'model_config', currentValue: 'large',
    options: [{ id: 'large', label: 'Large', description: 'More context', group: 'Sizes' }],
  }]);
});
it('ignores unknown configuration types and unsafe or malformed identifiers', () => {
  expect(parseConfigOptions([{ id: 'future', type: 'slider' }, { id: '__proto__', type: 'select' }, { id: {}, type: 'select' }])).toEqual([]);
  expect(parseConfigOptions(null)).toBeUndefined();
});
it('keeps command input hints so users know which arguments a native command expects', () => {
  expect(parseAvailableCommands([{ name: 'review', description: 'Review changes', input: { hint: 'branch or commit' } }])).toEqual([{ id: 'review', name: 'review', description: 'Review changes', inputHint: 'branch or commit' }]);
});
it('preserves an explicit empty configuration update to clear stale controls', () => {
  expect(parseConfigOptions([])).toEqual([]);
});

it('rejects malformed select values and keeps normalized command hints', () => {
  expect(parseConfigOptions([{ id: 'size', options: [{ value: {}, name: 'Bad' }] }])?.[0].options).toEqual([]);
  expect(parseAvailableCommands(parseAvailableCommands([{ name: 'review', input: { hint: 'branch' } }]))[0].inputHint).toBe('branch');
});

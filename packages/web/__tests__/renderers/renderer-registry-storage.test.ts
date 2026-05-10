/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isRendererEnabled, loadDisabledState, setRendererEnabled } from '@/lib/renderers/registry';

describe('renderer registry storage', () => {
  beforeEach(() => {
    localStorage.clear();
    loadDisabledState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    loadDisabledState();
  });

  it('ignores corrupted disabled-renderer storage', () => {
    localStorage.setItem('mindos-disabled-renderers', '{bad json');

    expect(() => loadDisabledState()).not.toThrow();
    expect(isRendererEnabled('any-renderer')).toBe(true);
  });

  it('loads only non-empty string renderer ids', () => {
    localStorage.setItem('mindos-disabled-renderers', JSON.stringify(['summary', '', 42, null]));
    loadDisabledState();

    expect(isRendererEnabled('summary')).toBe(false);
    expect(isRendererEnabled('42')).toBe(true);
  });

  it('keeps in-memory state when localStorage writes fail', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(() => setRendererEnabled('quota-test-renderer', false)).not.toThrow();
    expect(isRendererEnabled('quota-test-renderer')).toBe(false);
  });
});

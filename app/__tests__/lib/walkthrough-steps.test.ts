import { describe, it, expect } from 'vitest';
import { walkthroughSteps } from '@/components/walkthrough/steps';

describe('walkthrough/steps', () => {
  it('defines exactly 5 steps', () => {
    expect(walkthroughSteps).toHaveLength(5);
  });

  it('each step has anchor and position', () => {
    for (const step of walkthroughSteps) {
      expect(step.anchor).toBeTruthy();
      expect(['right', 'bottom']).toContain(step.position);
    }
  });

  it('has unique anchors', () => {
    const anchors = walkthroughSteps.map(s => s.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it('anchors match expected data-walkthrough values', () => {
    const expected = ['activity-bar', 'files-panel', 'ask-button', 'search-button', 'settings-button'];
    expect(walkthroughSteps.map(s => s.anchor)).toEqual(expected);
  });
});

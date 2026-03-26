import { describe, it, expect } from 'vitest';
import { walkthroughSteps } from '@/components/walkthrough/steps';

describe('walkthrough/steps', () => {
  it('defines exactly 4 steps', () => {
    expect(walkthroughSteps).toHaveLength(4);
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

  it('anchors match the value-driven walkthrough sequence', () => {
    const expected = ['files-panel', 'ask-button', 'agents-panel', 'echo-panel'];
    expect(walkthroughSteps.map(s => s.anchor)).toEqual(expected);
  });
});

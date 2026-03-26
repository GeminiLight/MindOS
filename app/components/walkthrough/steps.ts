/** Walkthrough step anchors — these data-walkthrough attributes are added to target components */
export type WalkthroughAnchor =
  | 'files-panel'
  | 'ask-button'
  | 'agents-panel'
  | 'echo-panel';

export interface WalkthroughStep {
  anchor: WalkthroughAnchor;
  /** Preferred tooltip position relative to anchor */
  position: 'right' | 'bottom';
}

/**
 * 4-step value-driven walkthrough aligned with the Dual-Layer Wedge strategy:
 *   0. Project Memory (foundation)
 *   1. AI That Already Knows You (wedge)
 *   2. Multi-Agent Sharing (differentiation)
 *   3. Echo — Cognitive Compound Interest (retention seed)
 */
export const walkthroughSteps: WalkthroughStep[] = [
  { anchor: 'files-panel', position: 'right' },
  { anchor: 'ask-button', position: 'right' },
  { anchor: 'agents-panel', position: 'right' },
  { anchor: 'echo-panel', position: 'right' },
];

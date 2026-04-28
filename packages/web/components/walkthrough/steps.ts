/** Walkthrough step anchors — these data-walkthrough attributes are added to target components */
export type WalkthroughAnchor =
  | 'files-panel'
  | 'ask-button'
  | 'agents-panel';

export interface WalkthroughStep {
  anchor: WalkthroughAnchor;
  /** Preferred tooltip position relative to anchor */
  position: 'right' | 'bottom';
}

/**
 * 3-step value-driven walkthrough:
 *   0. Project Memory (foundation)
 *   1. AI That Already Knows You (wedge)
 *   2. Multi-Agent Sharing (differentiation)
 */
export const walkthroughSteps: WalkthroughStep[] = [
  { anchor: 'files-panel', position: 'right' },
  { anchor: 'ask-button', position: 'bottom' },
  { anchor: 'agents-panel', position: 'right' },
];

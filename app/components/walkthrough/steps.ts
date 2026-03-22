/** Walkthrough step anchors — these data-walkthrough attributes are added to target components */
export type WalkthroughAnchor =
  | 'activity-bar'
  | 'files-panel'
  | 'ask-button'
  | 'search-button'
  | 'settings-button';

export interface WalkthroughStep {
  anchor: WalkthroughAnchor;
  /** Preferred tooltip position relative to anchor */
  position: 'right' | 'bottom';
}

export const walkthroughSteps: WalkthroughStep[] = [
  { anchor: 'activity-bar', position: 'right' },
  { anchor: 'files-panel', position: 'right' },
  { anchor: 'ask-button', position: 'right' },
  { anchor: 'search-button', position: 'right' },
  { anchor: 'settings-button', position: 'right' },
];

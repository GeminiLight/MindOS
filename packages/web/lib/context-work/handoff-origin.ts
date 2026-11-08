import type { ContextPosition } from './continuity';

/** A receipt for one prepared handoff, never an instruction to include more files. */
export type HandoffOrigin = {
  rootId: string;
  title: string;
  folder: string;
  position: Omit<ContextPosition, 'updatedAt'>;
  items: Array<{ id: string; label: string; path: string }>;
};

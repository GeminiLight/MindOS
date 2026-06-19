import { MAIN_CONTENT } from '@/lib/config/panel-sizes';

export const MAIN_BODY_CONTENT_WIDTH_EVENT = 'mindos:content-width-change';

export interface ResolveMainBodyLayoutInput {
  viewportWidth: number;
  leftOffset: number;
  rightReservedWidth: number;
  contentWidthRatio?: number;
  gutterMin?: number;
}

export interface MainBodyLayout {
  unreservedWidth: number;
  availableWidth: number;
  preferredContentWidth: number;
  contentMaxWidth: number;
  gutterWidth: number;
}

function finitePixels(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function parseContentWidthRatio(value: string | null | undefined): number {
  const raw = value?.trim();
  if (!raw) return MAIN_CONTENT.DEFAULT_WIDTH_RATIO;

  if (raw.endsWith('%')) {
    const percent = Number.parseFloat(raw);
    if (Number.isFinite(percent)) {
      return clamp(percent / 100, MAIN_CONTENT.MIN_WIDTH_RATIO, MAIN_CONTENT.MAX_WIDTH_RATIO);
    }
  }

  if (raw.endsWith('px')) {
    const pixels = Number.parseInt(raw, 10);
    if (Number.isFinite(pixels)) {
      if (pixels >= 960) return MAIN_CONTENT.MAX_WIDTH_RATIO;
      if (pixels >= 780) return MAIN_CONTENT.DEFAULT_WIDTH_RATIO;
      return 0.65;
    }
  }

  const numeric = Number.parseFloat(raw);
  if (Number.isFinite(numeric)) {
    const ratio = numeric > 1 ? numeric / 100 : numeric;
    return clamp(ratio, MAIN_CONTENT.MIN_WIDTH_RATIO, MAIN_CONTENT.MAX_WIDTH_RATIO);
  }

  return MAIN_CONTENT.DEFAULT_WIDTH_RATIO;
}

/**
 * Resolves the shared main-body content width.
 *
 * The preferred content width is based on the main area before right-side docks
 * reserve space. When a dock opens, internal gutters shrink symmetrically down
 * to the minimum gutter before the body itself narrows.
 */
export function resolveMainBodyLayout(input: ResolveMainBodyLayoutInput): MainBodyLayout {
  const viewportWidth = finitePixels(input.viewportWidth);
  const leftOffset = finitePixels(input.leftOffset);
  const rightReservedWidth = finitePixels(input.rightReservedWidth);
  const gutterMin = finitePixels(input.gutterMin ?? MAIN_CONTENT.GUTTER_MIN);
  const contentWidthRatio = clamp(
    input.contentWidthRatio ?? MAIN_CONTENT.DEFAULT_WIDTH_RATIO,
    MAIN_CONTENT.MIN_WIDTH_RATIO,
    MAIN_CONTENT.MAX_WIDTH_RATIO,
  );

  const unreservedWidth = Math.max(0, viewportWidth - leftOffset);
  const availableWidth = Math.max(0, unreservedWidth - rightReservedWidth);
  const preferredContentWidth = unreservedWidth * contentWidthRatio;
  const maxContentWidthByGutter = Math.max(0, availableWidth - gutterMin * 2);
  const contentMaxWidth = Math.min(preferredContentWidth, maxContentWidthByGutter);
  const gutterWidth = Math.max(0, (availableWidth - contentMaxWidth) / 2);

  return {
    unreservedWidth,
    availableWidth,
    preferredContentWidth,
    contentMaxWidth,
    gutterWidth,
  };
}

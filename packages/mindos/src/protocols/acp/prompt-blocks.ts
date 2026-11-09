import type { AcpPromptCapabilities } from './types.js';

/** Exactly what a MindOS prompt can contain; narrower than `AcpContentBlock`. */
export type AcpPromptBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

/** An image the user attached to a turn, already materialized as base64. */
export type AcpPromptImage = {
  data: string;
  mimeType: string;
};

/**
 * One prompt should not ship an unbounded number of screenshots; agents charge
 * per image and some reject oversized requests outright.
 */
export const ACP_PROMPT_MAX_IMAGES = 10;

/**
 * Build the ACP prompt content. Images are only attached when the agent
 * declared `promptCapabilities.image` during initialize — sending them to an
 * agent that did not ask for them makes the whole prompt fail, which is worse
 * than the path-only fallback the text already carries.
 */
export function buildAcpPromptBlocks(
  text: string,
  images: readonly AcpPromptImage[] | undefined,
  promptCapabilities: AcpPromptCapabilities | undefined,
): AcpPromptBlock[] {
  const blocks: AcpPromptBlock[] = [{ type: 'text', text }];
  if (!promptCapabilities?.image || !images?.length) return blocks;

  for (const image of images) {
    if (!image?.data || !image.mimeType) continue;
    blocks.push({ type: 'image', data: image.data, mimeType: image.mimeType });
    if (blocks.length > ACP_PROMPT_MAX_IMAGES) break;
  }
  return blocks;
}

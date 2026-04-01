/**
 * Shared CJK character detection utilities.
 *
 * CJK Unicode ranges covered:
 * - \u4e00-\u9fff  Chinese Han characters (CJK Unified Ideographs)
 * - \u3040-\u309f  Japanese Hiragana
 * - \u30a0-\u30ff  Japanese Katakana
 * - \uac00-\ud7af  Korean Hangul syllables
 */

/** Test whether a single character is CJK. Stateless (no /g flag). */
export const CJK_CHAR_REGEX = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/;

/** Count CJK characters in a string. */
export function countCjkChars(text: string): number {
  const matches = text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g);
  return matches ? matches.length : 0;
}

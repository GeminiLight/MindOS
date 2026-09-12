import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';

export type MarkdownStyleVariant = 'document' | 'bubble';

export type MarkdownStyleMap = Record<string, TextStyle | ViewStyle | ImageStyle>;

import { darkColors, type ThemeColors } from './palette';

const cache = new WeakMap<ThemeColors, Record<MarkdownStyleVariant, MarkdownStyleMap>>();
function createMarkdownStyles(colors: ThemeColors) {
  const documentMarkdownStyles: MarkdownStyleMap = {
    body: { color: colors.text, fontSize: 15, lineHeight: 24 },
    heading1: { color: colors.text, fontSize: 24, fontWeight: '700' as const, marginTop: 24, marginBottom: 8 },
    heading2: { color: colors.text, fontSize: 20, fontWeight: '700' as const, marginTop: 20, marginBottom: 8 },
    heading3: { color: colors.text, fontSize: 17, fontWeight: '600' as const, marginTop: 16, marginBottom: 6 },
    strong: { color: colors.text, fontWeight: '600' as const },
    em: { fontStyle: 'italic' as const },
    link: { color: colors.amber },
    blockquote: { borderLeftWidth: 3, borderLeftColor: colors.amber, paddingLeft: 12, marginLeft: 0, opacity: 0.8 },
    code_inline: { backgroundColor: colors.surface, color: colors.amber, paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4, fontFamily: 'monospace', fontSize: 13 },
    code_block: { backgroundColor: colors.surface, padding: 12, borderRadius: 8, fontFamily: 'monospace', fontSize: 13, color: colors.text },
    fence: { backgroundColor: colors.surface, padding: 12, borderRadius: 8, fontFamily: 'monospace', fontSize: 13, color: colors.text },
    list_item: { marginBottom: 4 },
    bullet_list: { marginLeft: 8 },
    ordered_list: { marginLeft: 8 },
    hr: { borderColor: colors.border, marginVertical: 16 },
    table: { borderColor: colors.border },
    thead: { backgroundColor: colors.surface },
    th: { color: colors.text, fontWeight: '600' as const, padding: 8 },
    td: { color: colors.text, padding: 8, borderColor: colors.border },
  };

  const bubbleMarkdownStyles: MarkdownStyleMap = {
    body: { color: colors.text, fontSize: 14, lineHeight: 20 },
    strong: { color: colors.text, fontWeight: '600' as const },
    em: { fontStyle: 'italic' as const },
    code_inline: { backgroundColor: colors.surfaceMuted, color: colors.amber, paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4, fontFamily: 'monospace', fontSize: 12 },
    code_block: { backgroundColor: colors.background, padding: 10, borderRadius: 6, fontFamily: 'monospace', fontSize: 12, color: colors.text },
    fence: { backgroundColor: colors.background, padding: 10, borderRadius: 6, fontFamily: 'monospace', fontSize: 12, color: colors.text },
    link: { color: colors.amber },
    list_item: { marginBottom: 4 },
    bullet_list: { marginLeft: 8 },
    blockquote: { borderLeftWidth: 3, borderLeftColor: colors.amber, paddingLeft: 10, opacity: 0.8 },
  };

  return { document: documentMarkdownStyles, bubble: bubbleMarkdownStyles };
}
export const markdownStylesByVariant = createMarkdownStyles(darkColors);
cache.set(darkColors, markdownStylesByVariant);
export function getMarkdownStyles(variant: MarkdownStyleVariant, colors = darkColors): MarkdownStyleMap {
  if (!cache.has(colors)) cache.set(colors, createMarkdownStyles(colors));
  return cache.get(colors)![variant];
}

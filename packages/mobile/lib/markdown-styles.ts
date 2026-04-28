import type { StyleSheet } from 'react-native';

export type MarkdownStyleVariant = 'document' | 'bubble';

export type MarkdownStyleMap = StyleSheet.NamedStyles<any>;

const documentMarkdownStyles: MarkdownStyleMap = {
  body: { color: '#d6d3d1', fontSize: 15, lineHeight: 24 },
  heading1: { color: '#fafaf9', fontSize: 24, fontWeight: '700' as const, marginTop: 24, marginBottom: 8 },
  heading2: { color: '#fafaf9', fontSize: 20, fontWeight: '700' as const, marginTop: 20, marginBottom: 8 },
  heading3: { color: '#fafaf9', fontSize: 17, fontWeight: '600' as const, marginTop: 16, marginBottom: 6 },
  strong: { color: '#fafaf9', fontWeight: '600' as const },
  em: { fontStyle: 'italic' as const },
  link: { color: '#c8873a' },
  blockquote: { borderLeftWidth: 3, borderLeftColor: '#c8873a', paddingLeft: 12, marginLeft: 0, opacity: 0.8 },
  code_inline: { backgroundColor: '#292524', color: '#fbbf24', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4, fontFamily: 'monospace', fontSize: 13 },
  code_block: { backgroundColor: '#292524', padding: 12, borderRadius: 8, fontFamily: 'monospace', fontSize: 13, color: '#d6d3d1' },
  fence: { backgroundColor: '#292524', padding: 12, borderRadius: 8, fontFamily: 'monospace', fontSize: 13, color: '#d6d3d1' },
  list_item: { marginBottom: 4 },
  bullet_list: { marginLeft: 8 },
  ordered_list: { marginLeft: 8 },
  hr: { borderColor: '#44403c', marginVertical: 16 },
  table: { borderColor: '#44403c' },
  thead: { backgroundColor: '#292524' },
  th: { color: '#fafaf9', fontWeight: '600' as const, padding: 8 },
  td: { color: '#d6d3d1', padding: 8, borderColor: '#44403c' },
};

const bubbleMarkdownStyles: MarkdownStyleMap = {
  body: { color: '#d6d3d1', fontSize: 14, lineHeight: 20 },
  strong: { color: '#fafaf9', fontWeight: '600' as const },
  em: { fontStyle: 'italic' as const },
  code_inline: { backgroundColor: 'rgba(0, 0, 0, 0.3)', color: '#fbbf24', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4, fontFamily: 'monospace', fontSize: 12 },
  code_block: { backgroundColor: '#1a1917', padding: 10, borderRadius: 6, fontFamily: 'monospace', fontSize: 12, color: '#d6d3d1' },
  fence: { backgroundColor: '#1a1917', padding: 10, borderRadius: 6, fontFamily: 'monospace', fontSize: 12, color: '#d6d3d1' },
  link: { color: '#c8873a' },
  list_item: { marginBottom: 4 },
  bullet_list: { marginLeft: 8 },
  blockquote: { borderLeftWidth: 3, borderLeftColor: '#c8873a', paddingLeft: 10, opacity: 0.8 },
};

export const markdownStylesByVariant: Record<MarkdownStyleVariant, MarkdownStyleMap> = {
  document: documentMarkdownStyles,
  bubble: bubbleMarkdownStyles,
};

export const getMarkdownStyles = (variant: MarkdownStyleVariant): MarkdownStyleMap => markdownStylesByVariant[variant];

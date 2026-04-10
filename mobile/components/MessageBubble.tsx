/**
 * MessageBubble — Renders a single chat message with Markdown and tool calls.
 */

import { View, Text as RNText, StyleSheet, FlatList } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { Ionicons } from '@expo/vector-icons';
import type { Message, ToolCallPart } from '@/lib/types';

interface MessageBubbleProps {
  message: Message;
  index: number;
}

export default function MessageBubble({ message, index }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <View style={[styles.bubbleContainer, isUser && styles.bubbleContainerUser]}>
      <View style={[styles.bubble, isUser && styles.bubbleUser]}>
        {/* Main content */}
        {message.content && (
          <Markdown style={markdownStyles}>{message.content}</Markdown>
        )}

        {/* Tool calls if any */}
        {message.parts?.some((p) => p.type === 'tool-call') && (
          <View style={styles.toolsSection}>
            <RNText style={styles.toolsLabel}>Tools</RNText>
            <FlatList
              data={message.parts.filter((p) => p.type === 'tool-call')}
              keyExtractor={(_, i) => `${index}-tool-${i}`}
              scrollEnabled={false}
              renderItem={({ item }) => {
                const tc = item as ToolCallPart;
                return (
                  <View
                    style={[
                      styles.toolCard,
                      tc.state === 'error' && styles.toolCardError,
                    ]}
                  >
                    <View style={styles.toolHeader}>
                      <Ionicons
                        name="settings-outline"
                        size={14}
                        color={tc.state === 'error' ? '#ef4444' : '#a8a29e'}
                      />
                      <RNText style={styles.toolName}>{tc.toolName}</RNText>
                      <RNText style={styles.toolState}>
                        {tc.state === 'done' && '✓'}
                        {tc.state === 'error' && '✗'}
                        {tc.state === 'pending' && '◌'}
                      </RNText>
                    </View>
                    {tc.output && (
                      <RNText style={styles.toolOutput} numberOfLines={3}>
                        {tc.output}
                      </RNText>
                    )}
                  </View>
                );
              }}
            />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bubbleContainer: {
    flexDirection: 'row',
    marginVertical: 6,
    paddingHorizontal: 16,
    justifyContent: 'flex-start',
  },
  bubbleContainerUser: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '85%',
    backgroundColor: '#292524',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#44403c',
  },
  bubbleUser: {
    backgroundColor: '#c8873a',
    borderColor: '#c8873a',
  },
  toolsSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#44403c',
    gap: 8,
  },
  toolsLabel: {
    fontSize: 11,
    color: '#78716c',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  toolCard: {
    backgroundColor: 'rgba(200, 135, 58, 0.08)',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: 'rgba(200, 135, 58, 0.2)',
  },
  toolCardError: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  toolHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  toolName: {
    flex: 1,
    fontSize: 12,
    color: '#d6d3d1',
    fontWeight: '500',
  },
  toolState: {
    fontSize: 11,
    color: '#a8a29e',
  },
  toolOutput: {
    fontSize: 11,
    color: '#a8a29e',
    marginTop: 4,
    fontFamily: 'monospace',
  },
});

const markdownStyles = {
  body: { color: '#d6d3d1', fontSize: 14, lineHeight: 20 },
  strong: { color: '#fafaf9', fontWeight: '600' as const },
  em: { fontStyle: 'italic' as const },
  code_inline: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    color: '#fbbf24',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
    fontFamily: 'monospace',
    fontSize: 12,
  },
  link: { color: '#c8873a' },
  list_item: { marginBottom: 4 },
  bullet_list: { marginLeft: 8 },
};

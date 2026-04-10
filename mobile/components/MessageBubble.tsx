/**
 * MessageBubble — Chat message with Markdown, tool calls, reasoning, images, timestamps.
 */

import { useState } from 'react';
import {
  View,
  Text as RNText,
  Image,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Markdown from 'react-native-markdown-display';
import { Ionicons } from '@expo/vector-icons';
import { getMarkdownStyles } from '@/lib/markdown-styles';
import type { Message, ToolCallPart, ReasoningPart, ImagePart } from '@/lib/types';

interface MessageBubbleProps {
  message: Message;
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const toolCalls = message.parts?.filter((p) => p.type === 'tool-call') as ToolCallPart[] | undefined;
  const reasoning = message.parts?.filter((p) => p.type === 'reasoning') as ReasoningPart[] | undefined;

  const handleLongPress = () => {
    if (!message.content) return;
    Clipboard.setStringAsync(message.content)
      .then(() => {
        Alert.alert('Copied', 'Message copied to clipboard');
      })
      .catch(() => {
        Alert.alert('Error', 'Failed to copy to clipboard');
      });
  };

  return (
    <Pressable
      onLongPress={handleLongPress}
      style={[styles.bubbleContainer, isUser && styles.bubbleContainerUser]}
    >
      <View style={[styles.bubble, isUser && styles.bubbleUser]}>
        {/* Reasoning (collapsible) */}
        {reasoning && reasoning.length > 0 && (
          <ReasoningBlock parts={reasoning} />
        )}

        {/* Attached files */}
        {message.attachedFiles && message.attachedFiles.length > 0 && (
          <View style={styles.attachedSection}>
            {message.attachedFiles.map((path) => (
              <View key={path} style={styles.attachedChip}>
                <Ionicons name="document-outline" size={12} color={isUser ? '#fff' : '#c8873a'} />
                <RNText style={[styles.attachedText, isUser && styles.attachedTextUser]} numberOfLines={1}>
                  {path.split('/').pop() || path}
                </RNText>
              </View>
            ))}
          </View>
        )}

        {/* Main content */}
        {message.content ? (
          isUser ? (
            <RNText style={styles.userText}>{message.content}</RNText>
          ) : (
            <Markdown style={getMarkdownStyles('bubble')}>{message.content}</Markdown>
          )
        ) : null}

        {/* Images */}
        {message.images && message.images.length > 0 && (
          <View style={styles.imagesRow}>
            {message.images.map((img, i) => (
              <Image
                key={i}
                source={{ uri: `data:${img.mimeType};base64,${img.data}` }}
                style={styles.image}
                resizeMode="contain"
              />
            ))}
          </View>
        )}

        {/* Tool calls (expandable) */}
        {toolCalls && toolCalls.length > 0 && (
          <View style={styles.toolsSection}>
            <RNText style={styles.toolsLabel}>
              Tools ({toolCalls.length})
            </RNText>
            {toolCalls.map((tc, i) => (
              <ToolCallCard key={tc.toolCallId || i} tc={tc} />
            ))}
          </View>
        )}

        {/* Timestamp */}
        {message.timestamp ? (
          <RNText style={[styles.timestamp, isUser && styles.timestampUser]}>
            {formatTime(message.timestamp)}
          </RNText>
        ) : null}
      </View>
    </Pressable>
  );
}

// --- Reasoning Block (collapsible) ---

function ReasoningBlock({ parts }: { parts: ReasoningPart[] }) {
  const [expanded, setExpanded] = useState(false);
  const text = parts.map((p) => p.text).join('');
  if (!text) return null;

  return (
    <Pressable onPress={() => setExpanded(!expanded)} style={styles.reasoningBlock}>
      <View style={styles.reasoningHeader}>
        <Ionicons
          name={expanded ? 'chevron-down' : 'chevron-forward'}
          size={12}
          color="#78716c"
        />
        <RNText style={styles.reasoningLabel}>Thinking</RNText>
      </View>
      {expanded && (
        <RNText style={styles.reasoningText} selectable>
          {text}
        </RNText>
      )}
    </Pressable>
  );
}

// --- Tool Call Card (expandable output) ---

function ToolCallCard({ tc }: { tc: ToolCallPart }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Pressable
      onPress={() => tc.output && setExpanded(!expanded)}
      style={[styles.toolCard, tc.state === 'error' && styles.toolCardError]}
    >
      <View style={styles.toolHeader}>
        {tc.state === 'running' ? (
          <ActivityIndicator size={12} color="#c8873a" />
        ) : (
          <Ionicons
            name={tc.state === 'error' ? 'close-circle-outline' : 'checkmark-circle-outline'}
            size={14}
            color={tc.state === 'error' ? '#ef4444' : '#22c55e'}
          />
        )}
        <RNText style={styles.toolName} numberOfLines={1}>{tc.toolName}</RNText>
        {tc.output ? (
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={12}
            color="#78716c"
          />
        ) : null}
      </View>
      {tc.output ? (
        <RNText
          style={styles.toolOutput}
          numberOfLines={expanded ? undefined : 3}
          selectable={expanded}
        >
          {tc.output}
        </RNText>
      ) : null}
    </Pressable>
  );
}

// --- Time formatter ---

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const hours = d.getHours().toString().padStart(2, '0');
  const mins = d.getMinutes().toString().padStart(2, '0');
  const time = `${hours}:${mins}`;

  // Same day → just time
  if (d.toDateString() === now.toDateString()) return time;
  // Yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  // This year
  const month = d.toLocaleString('en', { month: 'short' });
  if (d.getFullYear() === now.getFullYear()) return `${month} ${d.getDate()} ${time}`;
  return `${month} ${d.getDate()}, ${d.getFullYear()} ${time}`;
}

// --- Styles ---

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
  userText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
  },
  timestamp: {
    fontSize: 10,
    color: '#78716c',
    marginTop: 6,
  },
  attachedSection: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  attachedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '100%',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  attachedText: {
    maxWidth: 160,
    fontSize: 11,
    color: '#d6d3d1',
  },
  attachedTextUser: {
    color: '#fff',
  },
  timestampUser: {
    color: 'rgba(255,255,255,0.6)',
  },

  // Reasoning
  reasoningBlock: {
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#44403c',
  },
  reasoningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reasoningLabel: {
    fontSize: 11,
    color: '#78716c',
    fontWeight: '600',
    fontStyle: 'italic',
  },
  reasoningText: {
    fontSize: 12,
    color: '#78716c',
    fontStyle: 'italic',
    lineHeight: 18,
    marginTop: 6,
  },

  // Images
  imagesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  image: {
    width: 200,
    height: 150,
    borderRadius: 8,
    backgroundColor: '#1a1917',
  },

  // Tool calls
  toolsSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#44403c',
    gap: 6,
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
  toolOutput: {
    fontSize: 11,
    color: '#a8a29e',
    marginTop: 4,
    fontFamily: 'monospace',
  },
});


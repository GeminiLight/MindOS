import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ChatStatusFooterProps {
  isStreaming: boolean;
  hasAssistantContent: boolean;
  error: string;
  canRetry: boolean;
  onRetry: () => void;
}

export default function ChatStatusFooter({
  isStreaming,
  hasAssistantContent,
  error,
  canRetry,
  onRetry,
}: ChatStatusFooterProps) {
  return (
    <>
      {isStreaming && !hasAssistantContent ? (
        <View style={styles.thinkingBox}>
          <ActivityIndicator color="#c8873a" size="small" />
          <Text style={styles.thinkingText}>Thinking...</Text>
        </View>
      ) : null}
      {error ? (
        <View style={styles.errorBox}>
          <Ionicons name="warning-outline" size={14} color="#fca5a5" />
          <Text style={styles.errorText}>{error}</Text>
          {canRetry ? (
            <Pressable onPress={onRetry} style={styles.retryBtn} hitSlop={8}>
              <Ionicons name="refresh-outline" size={14} color="#c8873a" />
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  thinkingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(200, 135, 58, 0.08)',
    borderRadius: 8,
  },
  thinkingText: { fontSize: 12, color: '#c8873a' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  errorText: { fontSize: 12, color: '#fca5a5', flex: 1 },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(200, 135, 58, 0.15)',
  },
  retryText: { fontSize: 12, color: '#c8873a', fontWeight: '600' },
});
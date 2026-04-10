/**
 * Chat tab screen — main AI conversation interface.
 */

import { useEffect, useState } from 'react';
import {
  View,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Text,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useChat } from '@/hooks/useChat';
import ChatInput from '@/components/ChatInput';
import MessageBubble from '@/components/MessageBubble';
import type { AskMode } from '@/lib/types';

export default function ChatScreen() {
  const [mode, setMode] = useState<AskMode>('chat');
  const [sessionId] = useState(() => `session-${Date.now()}`);

  const { messages, isStreaming, error, send, cancel, clear } = useChat({
    sessionId,
    mode,
  });

  const [inputText, setInputText] = useState('');

  const handleSend = (message: string) => {
    send(message);
  };

  if (!messages.length && !isStreaming && !error) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.emptyCenter}>
          <Text style={styles.emptyIcon}>◆</Text>
          <Text style={styles.emptyTitle}>Ask MindOS</Text>
          <Text style={styles.emptySubtitle}>
            Ask anything about your knowledge base
          </Text>
          <Text style={styles.emptyHint}>
            Try:{'\n'}
            "What did I write about X?"{'\n'}
            "Summarize my notes"
          </Text>
        </View>

        <ChatInput
          value={inputText}
          onChangeText={setInputText}
          onSend={handleSend}
          mode={mode}
          onModeChange={setMode}
          canSend={!isStreaming}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <FlatList
        data={messages}
        keyExtractor={(_, index) => String(index)}
        renderItem={({ item, index }) => (
          <MessageBubble message={item} index={index} />
        )}
        onEndReachedThreshold={0.5}
        scrollEventThrottle={16}
        ListFooterComponent={
          error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : isStreaming ? (
            <View style={styles.thinkingBox}>
              <ActivityIndicator color="#c8873a" size="small" />
              <Text style={styles.thinkingText}>Thinking...</Text>
            </View>
          ) : null
        }
      />

      <ChatInput
        value={inputText}
        onChangeText={setInputText}
        onSend={handleSend}
        isLoading={isStreaming}
        mode={mode}
        onModeChange={setMode}
        canSend={!isStreaming}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1917',
  },
  emptyCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    fontSize: 32,
    color: '#c8873a',
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fafaf9',
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#a8a29e',
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: 12,
    color: '#78716c',
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 12,
  },
  thinkingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginVertical: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(200, 135, 58, 0.08)',
    borderRadius: 8,
  },
  thinkingText: {
    fontSize: 12,
    color: '#c8873a',
  },
  errorBox: {
    marginHorizontal: 16,
    marginVertical: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  errorText: {
    fontSize: 12,
    color: '#fca5a5',
  },
});

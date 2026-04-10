/**
 * Chat tab — AI conversation with session management.
 */
import { useCallback, useRef, useState } from 'react';
import {
  View,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Text,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useChat } from '@/hooks/useChat';
import ChatInput from '@/components/ChatInput';
import MessageBubble from '@/components/MessageBubble';
import type { AskMode } from '@/lib/types';

export default function ChatScreen() {
  const [mode, setMode] = useState<AskMode>('chat');
  const [sessionId, setSessionId] = useState(() => `s-${Date.now()}`);
  const listRef = useRef<FlatList>(null);

  const { messages, isStreaming, error, send, cancel, clear } = useChat({
    sessionId,
    mode,
  });

  const [inputText, setInputText] = useState('');

  const handleSend = useCallback((message: string) => {
    send(message);
    // Scroll to bottom after a tick
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  }, [send]);

  const handleNewChat = useCallback(() => {
    clear();
    setSessionId(`s-${Date.now()}`);
    setInputText('');
  }, [clear]);

  // --- Empty state ---
  if (!messages.length && !isStreaming && !error) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={90}
        >
          <View style={styles.emptyCenter}>
            <Text style={styles.emptyIcon}>◆</Text>
            <Text style={styles.emptyTitle}>Ask MindOS</Text>
            <Text style={styles.emptySubtitle}>
              Ask anything about your knowledge base
            </Text>

            <View style={styles.suggestionsBox}>
              {SUGGESTIONS.map((s) => (
                <Pressable
                  key={s}
                  style={styles.suggestionChip}
                  onPress={() => { setInputText(s); }}
                >
                  <Text style={styles.suggestionText} numberOfLines={1}>{s}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <ChatInput
            value={inputText}
            onChangeText={setInputText}
            onSend={handleSend}
            onCancel={cancel}
            mode={mode}
            onModeChange={setMode}
            canSend={!isStreaming}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // --- Conversation view ---
  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        {/* Header with New Chat button */}
        <View style={styles.chatHeader}>
          <Text style={styles.chatHeaderTitle}>
            {messages.length > 0
              ? truncate(messages[0].content, 30)
              : 'New Chat'}
          </Text>
          <Pressable onPress={handleNewChat} style={styles.newChatBtn}>
            <Ionicons name="add-circle-outline" size={22} color="#c8873a" />
          </Pressable>
        </View>

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(_, index) => String(index)}
          renderItem={({ item, index }) => (
            <MessageBubble message={item} index={index} />
          )}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListFooterComponent={
            <>
              {isStreaming && !messages[messages.length - 1]?.content && (
                <View style={styles.thinkingBox}>
                  <ActivityIndicator color="#c8873a" size="small" />
                  <Text style={styles.thinkingText}>Thinking...</Text>
                </View>
              )}
              {error ? (
                <View style={styles.errorBox}>
                  <Ionicons name="warning-outline" size={14} color="#fca5a5" />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}
            </>
          }
        />

        <ChatInput
          value={inputText}
          onChangeText={setInputText}
          onSend={handleSend}
          onCancel={cancel}
          isLoading={isStreaming}
          mode={mode}
          onModeChange={setMode}
          canSend={!isStreaming}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const SUGGESTIONS = [
  'Summarize my recent notes',
  'What did I write about this week?',
  'Find my TODO items',
  'Help me brainstorm',
];

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + '...';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1917' },
  flex: { flex: 1 },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#292524',
  },
  chatHeaderTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#d6d3d1',
    flex: 1,
  },
  newChatBtn: {
    padding: 4,
  },
  messageList: {
    paddingVertical: 8,
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
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#a8a29e',
    textAlign: 'center',
  },
  suggestionsBox: {
    marginTop: 24,
    gap: 8,
    width: '100%',
  },
  suggestionChip: {
    backgroundColor: '#292524',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#44403c',
  },
  suggestionText: {
    fontSize: 14,
    color: '#d6d3d1',
  },
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
  thinkingText: {
    fontSize: 12,
    color: '#c8873a',
  },
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
  errorText: {
    fontSize: 12,
    color: '#fca5a5',
    flex: 1,
  },
});

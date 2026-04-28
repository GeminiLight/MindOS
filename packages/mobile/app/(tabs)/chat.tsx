/**
 * Chat tab — AI conversation with multi-session management.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useChatSessions } from '@/hooks/useChatSessions';
import { useChatWithSession } from '@/hooks/useChatWithSession';
import ChatInput from '@/components/ChatInput';
import MessageBubble from '@/components/MessageBubble';
import FileAttachmentPicker from '@/components/FileAttachmentPicker';
import SessionListDrawer from '@/components/chat/SessionListDrawer';
import ChatHeader from '@/components/chat/ChatHeader';
import ChatEmptyState from '@/components/chat/ChatEmptyState';
import ChatStatusFooter from '@/components/chat/ChatStatusFooter';
import ScrollToBottomButton from '@/components/chat/ScrollToBottomButton';
import type { AskMode, Message } from '@/lib/types';

const SUGGESTIONS = [
  'Summarize my recent notes',
  'What did I write about this week?',
  'Find my TODO items',
  'Help me brainstorm',
];

export default function ChatScreen() {
  const [mode, setMode] = useState<AskMode>('chat');
  const [inputText, setInputText] = useState('');
  const [selectedAttachments, setSelectedAttachments] = useState<string[]>([]);
  const [showAttachmentPicker, setShowAttachmentPicker] = useState(false);
  const [showSessionList, setShowSessionList] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [currentMessages, setCurrentMessages] = useState<Message[]>([]);
  const listRef = useRef<FlatList>(null);
  const contentHeightRef = useRef(0);
  const scrollOffsetRef = useRef(0);
  const layoutHeightRef = useRef(0);

  const sessionsState = useChatSessions();
  const {
    sessions,
    activeSessionId,
    loaded: sessionsLoaded,
    createSession,
    deleteSession,
    renameSession,
    setActiveSession,
    getSessionMessages,
    saveSessionMessages,
  } = sessionsState;

  useEffect(() => {
    if (!sessionsLoaded || !activeSessionId) return;
    getSessionMessages(activeSessionId).then(setCurrentMessages);
  }, [activeSessionId, getSessionMessages, sessionsLoaded]);

  const handleMessagesChange = useCallback((messages: Message[]) => {
    if (!activeSessionId) return;
    void saveSessionMessages(activeSessionId, messages);
  }, [activeSessionId, saveSessionMessages]);

  const chatState = useChatWithSession({
    sessionId: activeSessionId ?? '',
    initialMessages: currentMessages,
    mode,
    onMessagesChange: handleMessagesChange,
  });
  const { messages, isStreaming, error, lastFailedMessage, send, retry, cancel } = chatState;

  const resetComposer = useCallback(() => {
    setInputText('');
    setSelectedAttachments([]);
  }, []);

  const handleNewChat = useCallback(async () => {
    const createFreshChat = async () => {
      await createSession();
      setCurrentMessages([]);
      resetComposer();
    };

    if (!messages.length) {
      await createFreshChat();
      return;
    }

    Alert.alert(
      'New Chat',
      'Start a new conversation? Current chat will be saved.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'New Chat', onPress: () => { void createFreshChat(); } },
      ],
    );
  }, [createSession, messages.length, resetComposer]);

  const handleSelectSession = useCallback(async (sessionId: string) => {
    await setActiveSession(sessionId);
    resetComposer();
  }, [resetComposer, setActiveSession]);

  const handleSend = useCallback((message: string) => {
    const started = send(message, selectedAttachments);
    if (!started) return;
    setSelectedAttachments([]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  }, [selectedAttachments, send]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    scrollOffsetRef.current = contentOffset.y;
    contentHeightRef.current = contentSize.height;
    layoutHeightRef.current = layoutMeasurement.height;
    setShowScrollBtn(contentSize.height - contentOffset.y - layoutMeasurement.height > 150);
  }, []);

  const headerTitle = sessions.find((session) => session.id === activeSessionId)?.title || 'New Chat';
  const isEmptyState = !messages.length && !isStreaming && !error;
  const hasAssistantContent = Boolean(messages[messages.length - 1]?.content);

  if (!sessionsLoaded) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <ActivityIndicator color="#c8873a" style={styles.loader} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <ChatHeader
          title={headerTitle}
          onOpenSessions={() => setShowSessionList(true)}
          onNewChat={() => { void handleNewChat(); }}
        />

        {isEmptyState ? (
          <ChatEmptyState
            suggestions={SUGGESTIONS}
            onPickSuggestion={setInputText}
          />
        ) : (
          <>
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(item, index) => item.id ?? `${item.role}-${item.timestamp ?? index}`}
              renderItem={({ item }) => <MessageBubble message={item} />}
              contentContainerStyle={styles.messageList}
              keyboardDismissMode="on-drag"
              onScroll={handleScroll}
              scrollEventThrottle={100}
              onContentSizeChange={() => {
                const distanceFromBottom = contentHeightRef.current - scrollOffsetRef.current - layoutHeightRef.current;
                if (distanceFromBottom < 150 || isStreaming) {
                  listRef.current?.scrollToEnd({ animated: false });
                }
              }}
              ListFooterComponent={
                <ChatStatusFooter
                  isStreaming={isStreaming}
                  hasAssistantContent={hasAssistantContent}
                  error={error}
                  canRetry={Boolean(lastFailedMessage)}
                  onRetry={retry}
                />
              }
            />
            <ScrollToBottomButton
              visible={showScrollBtn}
              onPress={() => listRef.current?.scrollToEnd({ animated: true })}
            />
          </>
        )}

        <ChatInput
          value={inputText}
          onChangeText={setInputText}
          onSend={handleSend}
          onCancel={cancel}
          isLoading={isStreaming}
          mode={mode}
          onModeChange={setMode}
          canSend={!isStreaming}
          attachedPaths={selectedAttachments}
          onOpenAttachmentPicker={() => setShowAttachmentPicker(true)}
          onRemoveAttachment={(path) => setSelectedAttachments((prev) => prev.filter((item) => item !== path))}
        />
      </KeyboardAvoidingView>

      <FileAttachmentPicker
        visible={showAttachmentPicker}
        selectedPaths={selectedAttachments}
        onChangeSelectedPaths={setSelectedAttachments}
        onClose={() => setShowAttachmentPicker(false)}
      />

      <SessionListDrawer
        visible={showSessionList}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelect={handleSelectSession}
        onNewChat={() => { void handleNewChat(); }}
        onRename={renameSession}
        onDelete={deleteSession}
        onClose={() => setShowSessionList(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1917' },
  flex: { flex: 1 },
  loader: { marginTop: 40 },
  messageList: { paddingVertical: 8 },
});

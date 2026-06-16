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
import RuntimePickerSheet from '@/components/chat/RuntimePickerSheet';
import { useAgentRuntimes } from '@/hooks/useAgentRuntimes';
import {
  buildRuntimeComposerPresentation,
  coerceSelectedRuntime,
  runtimeKey,
} from '@/lib/agent-runtime-companion';
import { colors } from '@/lib/theme';
import type { AgentRuntimeIdentity, AskMode, Message } from '@/lib/types';

export default function ChatScreen() {
  const [mode, setMode] = useState<AskMode>('chat');
  const [inputText, setInputText] = useState('');
  const [selectedAttachments, setSelectedAttachments] = useState<string[]>([]);
  const [showAttachmentPicker, setShowAttachmentPicker] = useState(false);
  const [showSessionList, setShowSessionList] = useState(false);
  const [showRuntimeSheet, setShowRuntimeSheet] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [currentMessages, setCurrentMessages] = useState<Message[]>([]);
  const [currentMessagesLoaded, setCurrentMessagesLoaded] = useState(false);
  const [selectedRuntime, setSelectedRuntime] = useState<AgentRuntimeIdentity | null>(null);
  const agentRuntimeState = useAgentRuntimes();
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
    let cancelled = false;
    if (!sessionsLoaded || !activeSessionId) {
      setCurrentMessages([]);
      setCurrentMessagesLoaded(false);
      return () => { cancelled = true; };
    }

    setCurrentMessagesLoaded(false);
    getSessionMessages(activeSessionId)
      .then((loadedMessages) => {
        if (cancelled) return;
        setCurrentMessages(loadedMessages);
        setCurrentMessagesLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setCurrentMessages([]);
        setCurrentMessagesLoaded(true);
      });
    return () => { cancelled = true; };
  }, [activeSessionId, getSessionMessages, sessionsLoaded]);

  const handleMessagesChange = useCallback((messages: Message[]) => {
    if (!activeSessionId || !currentMessagesLoaded) return;
    void saveSessionMessages(activeSessionId, messages);
  }, [activeSessionId, currentMessagesLoaded, saveSessionMessages]);

  const chatState = useChatWithSession({
    sessionId: activeSessionId ?? '',
    initialMessages: currentMessages,
    initialMessagesLoaded: currentMessagesLoaded,
    mode,
    selectedRuntime,
    onMessagesChange: handleMessagesChange,
  });
  const { messages, isStreaming, error, lastFailedMessage, send, retry, cancel } = chatState;

  useEffect(() => {
    setSelectedRuntime((current) => {
      const next = coerceSelectedRuntime(current, agentRuntimeState.response);
      return runtimeKey(current) === runtimeKey(next) ? current : next;
    });
  }, [agentRuntimeState.response]);

  const resetComposer = useCallback(() => {
    setInputText('');
    setSelectedAttachments([]);
  }, []);

  const handleNewChat = useCallback(async () => {
    const createFreshChat = async () => {
      setCurrentMessagesLoaded(false);
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
  const selectedRuntimeKey = runtimeKey(selectedRuntime);
  const selectedRuntimeOption = agentRuntimeState.options.find((option) => option.id === selectedRuntimeKey)
    ?? agentRuntimeState.options[0];
  const composerPresentation = buildRuntimeComposerPresentation(selectedRuntimeOption, mode);

  if (!sessionsLoaded || !currentMessagesLoaded) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <ActivityIndicator color={colors.amber} style={styles.loader} />
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
          runtimeLabel={selectedRuntimeOption?.name ?? 'MindOS Agent'}
          runtimeStatusLabel={
            agentRuntimeState.loading ? 'Checking' : selectedRuntimeOption?.statusLabel ?? 'Ready'
          }
          runtimeReady={selectedRuntimeOption?.selectable ?? false}
          onOpenSessions={() => setShowSessionList(true)}
          onOpenRuntime={() => setShowRuntimeSheet(true)}
          onNewChat={() => { void handleNewChat(); }}
        />

        {isEmptyState ? (
          <ChatEmptyState
            title={composerPresentation.emptyTitle}
            subtitle={composerPresentation.emptySubtitle}
            suggestions={composerPresentation.suggestions}
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
          agentModeEnabled={composerPresentation.agentModeEnabled}
          placeholder={composerPresentation.placeholder}
          modeHint={composerPresentation.modeHint}
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

      <RuntimePickerSheet
        visible={showRuntimeSheet}
        options={agentRuntimeState.options}
        selectedRuntime={selectedRuntime}
        loading={agentRuntimeState.loading}
        refreshing={agentRuntimeState.refreshing}
        error={agentRuntimeState.error}
        lastCheckedAt={agentRuntimeState.lastCheckedAt}
        switchDisabled={isStreaming}
        onRefresh={agentRuntimeState.refresh}
        onSelect={(option) => {
          if (isStreaming || !option.selectable) return;
          setSelectedRuntime(option.selectedRuntime);
          setShowRuntimeSheet(false);
        }}
        onClose={() => setShowRuntimeSheet(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  loader: { marginTop: 40 },
  messageList: { paddingVertical: 8 },
});

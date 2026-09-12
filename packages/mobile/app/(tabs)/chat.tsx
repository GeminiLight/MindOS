import { useThemedStyles, type ThemeColors } from '@/lib/theme';
/**
 * Chat tab — AI conversation with multi-session management.
 */
import ChatInput from '@/components/ChatInput';
import FileAttachmentPicker from '@/components/FileAttachmentPicker';
import MessageBubble from '@/components/MessageBubble';
import OfflineBanner from '@/components/OfflineBanner';
import ChatEmptyState from '@/components/chat/ChatEmptyState';
import ChatHeader from '@/components/chat/ChatHeader';
import ChatStatusFooter from '@/components/chat/ChatStatusFooter';
import RuntimePickerSheet from '@/components/chat/RuntimePickerSheet';
import ScrollToBottomButton from '@/components/chat/ScrollToBottomButton';
import SessionListDrawer from '@/components/chat/SessionListDrawer';
import { InlineBanner } from '@/components/ui/MobileScaffold';
import { useAgentRuntimes } from '@/hooks/useAgentRuntimes';
import { useChatSessions } from '@/hooks/useChatSessions';
import { useChatWithSession } from '@/hooks/useChatWithSession';
import {
  buildRuntimeComposerPresentation,
  coerceSelectedRuntime,
  runtimeKey,
} from '@/lib/agent-runtime-companion';
import { useConnectionStore } from '@/lib/connection-store';
import type { AgentRuntimeIdentity, ComposerIntent, Message } from '@/lib/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  StyleSheet,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ChatScreen() {
  const { colors, styles } = useThemedStyles(createViewTheme);
  const connected = useConnectionStore(s => s.status === 'connected');
  const insets = useSafeAreaInsets();
  const [loadedSessionId, setLoadedSessionId] = useState<string | null>(null);
  const [storageError, setStorageError] = useState('');
  const [loadRetry, setLoadRetry] = useState(0);
  const [composerIntent, setComposerIntent] = useState<ComposerIntent>('chat');
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
    setStorageError('');
    getSessionMessages(activeSessionId)
      .then((loadedMessages) => {
        if (cancelled) return;
        setLoadedSessionId(activeSessionId);
        setCurrentMessages(loadedMessages);
        setCurrentMessagesLoaded(true);
      })
      .catch(() => { if (!cancelled) setStorageError('Could not read this conversation. Retry to protect your saved messages.'); });
    return () => { cancelled = true; };
  }, [activeSessionId, getSessionMessages, sessionsLoaded, loadRetry]);

  const handleMessagesChange = useCallback((messages: Message[], sessionId?: string) => {
    if (!sessionId) return;
    return saveSessionMessages(sessionId, messages);
  }, [saveSessionMessages]);

  const chatState = useChatWithSession({
    sessionId: activeSessionId ?? '',
    initialMessages: currentMessages,
    initialMessagesLoaded: currentMessagesLoaded && loadedSessionId === activeSessionId,
    selectedRuntime,
    composerIntent,
    onMessagesChange: handleMessagesChange,
  });
  const { messages, isStreaming, error, lastFailedMessage, send, retry, cancel, flush, saveError } = chatState;

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
      try { await flush(); cancel(); await createSession(); setCurrentMessages([]); resetComposer(); }
      catch { setStorageError('Could not save the conversation. Please retry before switching.'); }
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
  }, [createSession, messages.length, resetComposer, flush, cancel]);

  const handleSelectSession = useCallback(async (sessionId: string) => {
    try { await flush(); cancel(); await setActiveSession(sessionId); resetComposer(); }
    catch { setStorageError('Could not save the conversation. Please retry before switching.'); }
  }, [resetComposer, setActiveSession, flush, cancel]);

  const handleSend = useCallback((message: string) => {
    const started = send(message, selectedAttachments);
    if (!started) return false;
    setSelectedAttachments([]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    return true;
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
  const composerPresentation = buildRuntimeComposerPresentation(selectedRuntimeOption, composerIntent);

  if (!sessionsLoaded || !currentMessagesLoaded) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <OfflineBanner />
        {storageError || sessionsState.error ? <InlineBanner tone="error" title="Conversation unavailable" message={storageError || sessionsState.error || ''} actionLabel="Retry" onAction={() => { sessionsState.reload(); setLoadRetry(n => n + 1); }} /> : <ActivityIndicator color={colors.amber} style={styles.loader} />}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <OfflineBanner />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top}
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

        {storageError || saveError ? <InlineBanner tone="error" title="Messages need saving" message={storageError || saveError || ''} actionLabel="Retry save" onAction={() => { void flush().then(() => setStorageError('')).catch(() => { }); }} /> : null}
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
                if (distanceFromBottom < 150) {
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
          composerIntent={composerIntent}
          onComposerIntentChange={setComposerIntent}
          hostActionsEnabled={composerPresentation.hostActionsEnabled}
          placeholder={composerPresentation.placeholder}
          modeHint={composerPresentation.modeHint}
          canSend={!isStreaming && connected && Boolean(selectedRuntimeOption?.selectable)}
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
        onRename={(id, title) => { void renameSession(id, title).catch(() => setStorageError('Could not rename the conversation. Retry.')); }}
        onDelete={id => { void (async () => { if (id === activeSessionId) { await flush(); cancel(); } await deleteSession(id); })().catch(() => setStorageError('Could not delete the conversation. Retry.')); }}
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

function createViewTheme(colors: ThemeColors) {
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    loader: { marginTop: 40 },
    messageList: { paddingVertical: 8 },
  });
  return { styles };
}

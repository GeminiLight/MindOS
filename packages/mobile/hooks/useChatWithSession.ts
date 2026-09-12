/** Chat transport and persistence share the same explicit session owner. */
import { useCallback, useRef, useState, useEffect } from 'react';
import { AppState } from 'react-native';
import { useConnectionStore } from '@/lib/connection-store';
import { streamChat, MessageBuilder } from '@/lib/sse-client';
import { mindosClient } from '@/lib/api-client';
import { preserveAgentRunTimelineParts } from '@/lib/agent-run-timeline';
import { useAgentRunTimeline } from '@/hooks/useAgentRunTimeline';
import type { Message, AgentRuntimeIdentity, ComposerIntent } from '@/lib/types';

export interface UseChatWithSessionOptions {
  sessionId: string;
  initialMessages: Message[];
  initialMessagesLoaded?: boolean;
  selectedRuntime?: AgentRuntimeIdentity | null;
  composerIntent?: ComposerIntent;
  onMessagesChange: (messages: Message[], sessionId?: string) => void | Promise<void>;
}
const messageId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export function useChatWithSession({ sessionId, initialMessages, initialMessagesLoaded = true,
  selectedRuntime = null, composerIntent = 'chat', onMessagesChange }: UseChatWithSessionOptions) {
  const baseUrl = useConnectionStore(s => s.serverUrl);
  const connectionStatus = useConnectionStore(s => s.status);
  const [messages, setMessagesState] = useState<Message[]>(initialMessages);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [lastFailedMessage, setLastFailedMessage] = useState('');
  const [lastFailedAttachments, setLastFailedAttachments] = useState<string[]>([]);
  const messagesRef = useRef(initialMessages);
  const streamRef = useRef<{ cancel: (() => void) | null; builder: MessageBuilder; generation: number } | null>(null);
  const generationRef = useRef(0);
  const ownerRef = useRef({ id: sessionId, save: onMessagesChange });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<Promise<void>>(Promise.resolve());
  const changedRef = useRef(false);
  const aliveRef = useRef(true);
  const rootRunIdRef = useRef<string | undefined>(undefined);
  const setMessages = useCallback((update: Message[] | ((previous: Message[]) => Message[])) => {
    const next = typeof update === 'function' ? update(messagesRef.current) : update;
    if (next === messagesRef.current) return;
    messagesRef.current = next; changedRef.current = true; setMessagesState(next);
  }, []);

  const flush = useCallback((): Promise<void> => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (!changedRef.current || !ownerRef.current.id) return pendingSaveRef.current;
    const { id, save } = ownerRef.current;
    const snapshot = JSON.parse(JSON.stringify(messagesRef.current)) as Message[];
    changedRef.current = false;
    const pending = pendingSaveRef.current.catch(() => { }).then(() => save(snapshot, id)).then(() => {
      if (aliveRef.current) setSaveError('');
    }).catch((e) => {
      if (ownerRef.current.id === id) changedRef.current = true;
      if (aliveRef.current) setSaveError('Chat could not be saved on this device. Keep this conversation open and retry.');
      throw e;
    });
    pendingSaveRef.current = pending;
    // Fire-and-forget lifecycle callers still expose failure through saveError.
    void pending.catch(() => { });
    return pending;
  }, []);

  const finish = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    streamRef.current = null;
    const final = stream.builder.finalize();
    setMessages(prev => {
      if (!prev.length) return prev;
      const next = [...prev];
      next[next.length - 1] = { ...preserveAgentRunTimelineParts(next[next.length - 1], final), id: next[next.length - 1].id };
      return next;
    });
    setIsStreaming(false);
    void flush();
  }, [flush, setMessages]);

  useEffect(() => {
    aliveRef.current = true;
    ownerRef.current = { id: sessionId, save: onMessagesChange };
    messagesRef.current = initialMessagesLoaded ? initialMessages : [];
    changedRef.current = false;
    rootRunIdRef.current = undefined;
    setMessagesState(messagesRef.current); setIsStreaming(false); setError('');
    setLastFailedMessage(''); setLastFailedAttachments([]);
    return () => {
      void flush();
      generationRef.current += 1;
      streamRef.current?.cancel?.(); streamRef.current = null;
    };
    // The writer is scoped to the session that loaded these messages, including cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, initialMessages, initialMessagesLoaded, baseUrl, flush]);
  useEffect(() => () => { aliveRef.current = false; }, []);
  useEffect(() => {
    if (!initialMessagesLoaded || !changedRef.current) return;
    if (!isStreaming) { void flush(); return; }
    if (!timerRef.current) timerRef.current = setTimeout(() => { void flush(); }, 500);
  }, [messages, isStreaming, initialMessagesLoaded, flush]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') void flush();
    });
    return () => subscription.remove();
  }, [flush]);

  useAgentRunTimeline({
    chatSessionId: sessionId, enabled: initialMessagesLoaded, isStreaming,
    messages, setMessages, rootRunId: rootRunIdRef.current
  });

  const send = useCallback((text: string, attachedFiles?: string[], history?: Message[]) => {
    if (!text.trim() || !baseUrl || !sessionId || !initialMessagesLoaded || streamRef.current || connectionStatus !== 'connected') return false;
    setError(''); setLastFailedMessage(''); setLastFailedAttachments([]);
    const nextHistory = [...(history ?? messagesRef.current), {
      id: messageId(), role: 'user' as const, content: text, timestamp: Date.now(), attachedFiles,
    }];
    setMessages([...nextHistory, { id: messageId(), role: 'assistant', content: '', timestamp: Date.now() }]);
    void flush();
    const stream = { cancel: null as (() => void) | null, builder: new MessageBuilder(), generation: ++generationRef.current };
    streamRef.current = stream; rootRunIdRef.current = undefined; setIsStreaming(true);
    const isCurrent = () => streamRef.current === stream && generationRef.current === stream.generation;
    const fail = (message: string) => {
      if (!isCurrent()) return;
      setError(message); setLastFailedMessage(text); setLastFailedAttachments(attachedFiles ?? []); finish();
    };
    stream.cancel = streamChat(baseUrl, {
      messages: nextHistory, sessionId, chatSessionId: sessionId, attachedFiles,
      permissionMode: composerIntent === 'chat' ? 'read' : 'ask',
      ...(selectedRuntime ? { selectedRuntime } : {}),
    }, {
      onEvent: event => {
        if (!isCurrent()) return;
        const builder = stream.builder;
        switch (event.type) {
          case 'agent_run_context': rootRunIdRef.current = event.runId; break;
          case 'text_delta': builder.addTextDelta(event.delta ?? ''); break;
          case 'thinking_delta': builder.addThinkingDelta(event.delta ?? ''); break;
          case 'tool_start': builder.addToolStart(event.toolCallId ?? '', event.toolName ?? '', event.args); break;
          case 'tool_delta': builder.addToolDelta(event.toolCallId ?? '', event.delta ?? ''); break;
          case 'tool_end': builder.addToolEnd(event.toolCallId ?? '', event.output ?? '', event.isError ?? false); break;
          case 'runtime_permission_request': builder.addRuntimePermissionRequest(event); break;
          case 'runtime_permission_resolved': builder.addRuntimePermissionResolved(event); break;
          case 'error': fail(event.message ?? 'The response was interrupted.'); return;
          case 'done': finish(); return;
        }
        setMessages(prev => {
          if (!prev.length) return prev;
          const next = [...prev]; const last = next.length - 1;
          next[last] = { ...preserveAgentRunTimelineParts(next[last], builder.build()), id: next[last].id };
          return next;
        });
      }, onError: e => fail(e.message), onComplete: () => { if (isCurrent()) finish(); },
    }, { authToken: mindosClient.authToken });
    return true;
  }, [baseUrl, sessionId, initialMessagesLoaded, connectionStatus, composerIntent, selectedRuntime, setMessages, flush, finish]);
  const retry = useCallback(() => {
    if (lastFailedMessage) send(lastFailedMessage, lastFailedAttachments, messagesRef.current.slice(0, -2));
  }, [lastFailedMessage, lastFailedAttachments, send]);
  const cancel = useCallback(() => { streamRef.current?.cancel?.(); finish(); }, [finish]);
  const clearMessages = useCallback(() => { cancel(); setMessages([]); setError(''); void flush(); }, [cancel, setMessages, flush]);
  return {
    messages, isStreaming, error, saveError, lastFailedMessage, lastFailedAttachments,
    ready: initialMessagesLoaded, send, retry, cancel, clearMessages, flush
  };
}

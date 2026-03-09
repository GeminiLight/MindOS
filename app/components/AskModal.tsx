'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Sparkles, Send, Loader2, AtSign, Paperclip, FileText, Table, StopCircle, AlertCircle, RotateCcw, History, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useLocale } from '@/lib/LocaleContext';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface LocalAttachment {
  name: string;
  content: string;
}

interface ChatSession {
  id: string;
  currentFile?: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function extractPdfText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const dataBase64 = uint8ToBase64(new Uint8Array(buffer));

  const res = await fetch('/api/extract-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, dataBase64 }),
  });

  let payload: { text?: string; extracted?: boolean; error?: string } = {};
  try {
    payload = await res.json();
  } catch {
    // ignore JSON parse error, handled by fallback below
  }

  if (!res.ok) {
    throw new Error(payload.error || `PDF extraction failed (${res.status})`);
  }

  return payload.extracted ? (payload.text || '') : '';
}

const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.json', '.yaml', '.yml', '.xml', '.html', '.htm', '.pdf',
]);

const MAX_SESSIONS = 30;

function createSession(currentFile?: string): ChatSession {
  const ts = Date.now();
  return {
    id: `${ts}-${Math.random().toString(36).slice(2, 8)}`,
    currentFile,
    createdAt: ts,
    updatedAt: ts,
    messages: [],
  };
}

function sessionTitle(s: ChatSession): string {
  const firstUser = s.messages.find((m) => m.role === 'user');
  if (!firstUser) return '(empty session)';
  const line = firstUser.content.replace(/\s+/g, ' ').trim();
  return line.length > 42 ? `${line.slice(0, 42)}...` : line;
}

async function fetchSessions(): Promise<ChatSession[]> {
  try {
    const res = await fetch('/api/ask-sessions', { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json() as ChatSession[];
    if (!Array.isArray(data)) return [];
    return data.slice(0, MAX_SESSIONS);
  } catch {
    return [];
  }
}

async function upsertSession(session: ChatSession): Promise<void> {
  try {
    await fetch('/api/ask-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
    });
  } catch {
    // ignore persistence errors
  }
}

async function removeSession(id: string): Promise<void> {
  try {
    await fetch('/api/ask-sessions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  } catch {
    // ignore persistence errors
  }
}

function getExt(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx).toLowerCase() : '';
}

interface AskModalProps {
  open: boolean;
  onClose: () => void;
  currentFile?: string;
}

function FileChip({ path, onRemove }: { path: string; onRemove: () => void }) {
  const name = path.split('/').pop() ?? path;
  const isCsv = name.endsWith('.csv');
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border border-border bg-muted text-foreground max-w-[200px]">
      {isCsv ? <Table size={11} className="text-emerald-400 shrink-0" /> : <FileText size={11} className="text-zinc-400 shrink-0" />}
      <span className="truncate" title={path}>{name}</span>
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-foreground ml-0.5 shrink-0"
      >
        <X size={10} />
      </button>
    </span>
  );
}

function AssistantMessage({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none text-foreground
      prose-p:my-1 prose-p:leading-relaxed
      prose-headings:font-semibold prose-headings:my-2
      prose-ul:my-1 prose-li:my-0.5
      prose-ol:my-1
      prose-code:text-[0.8em] prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
      prose-pre:bg-muted prose-pre:text-foreground prose-pre:text-xs
      prose-blockquote:border-l-amber-400 prose-blockquote:text-muted-foreground
      prose-a:text-amber-500 prose-a:no-underline hover:prose-a:underline
      prose-strong:text-foreground prose-strong:font-semibold
      prose-table:text-xs prose-th:py-1 prose-td:py-1
    ">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
      {isStreaming && <span className="inline-block w-1.5 h-3.5 bg-amber-400 ml-0.5 align-middle animate-pulse rounded-sm" />}
    </div>
  );
}

export default function AskModal({ open, onClose, currentFile }: AskModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { t } = useLocale();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState<'connecting' | 'thinking' | 'streaming'>('connecting');
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [maxSteps, setMaxSteps] = useState(20);
  const [localAttachments, setLocalAttachments] = useState<LocalAttachment[]>([]);
  const [uploadError, setUploadError] = useState('');
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  // @-mention state
  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionResults, setMentionResults] = useState<string[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);

  // Load file list once
  useEffect(() => {
    fetch('/api/files').then(r => r.json()).then(setAllFiles).catch(() => {});
  }, []);

  // Focus and reset on open
  useEffect(() => {
    let cancelled = false;

    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);

      void (async () => {
        const sorted = (await fetchSessions()).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS);
        if (cancelled) return;
        setSessions(sorted);

        const matched = currentFile
          ? sorted.find((sess) => sess.currentFile === currentFile)
          : sorted[0];
        if (matched) {
          setActiveSessionId(matched.id);
          setMessages(matched.messages);
        } else {
          const fresh = createSession(currentFile);
          setActiveSessionId(fresh.id);
          setMessages([]);
          const next = [fresh, ...sorted].slice(0, MAX_SESSIONS);
          setSessions(next);
          await upsertSession(fresh);
        }
      })();

      setInput('');
      setAttachedFiles(currentFile ? [currentFile] : []);
      setLocalAttachments([]);
      setUploadError('');
      setMentionQuery(null);
      setShowHistory(false);
    } else {
      // Abort any in-flight request when modal closes
      abortRef.current?.abort();
    }

    return () => {
      cancelled = true;
    };
  }, [open, currentFile]);

  useEffect(() => {
    if (!open || !activeSessionId) return;
    let sessionToPersist: ChatSession | null = null;
    setSessions((prev) => {
      const now = Date.now();
      const existing = prev.find((s) => s.id === activeSessionId);
      sessionToPersist = existing
        ? { ...existing, currentFile, updatedAt: now, messages }
        : { id: activeSessionId, currentFile, createdAt: now, updatedAt: now, messages };

      const rest = prev.filter((s) => s.id !== activeSessionId);
      const next = [sessionToPersist!, ...rest].sort((a, b) => b.updatedAt - a.updatedAt);
      return next.slice(0, MAX_SESSIONS);
    });

    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      if (sessionToPersist) void upsertSession(sessionToPersist);
    }, 600);

    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [open, messages, activeSessionId, currentFile]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Esc to close (or dismiss mention)
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (mentionQuery !== null) { setMentionQuery(null); return; }
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, mentionQuery]);

  // Parse @-mention from input
  const handleInputChange = useCallback((val: string) => {
    setInput(val);
    const atIdx = val.lastIndexOf('@');
    if (atIdx === -1) { setMentionQuery(null); return; }
    const before = val[atIdx - 1];
    if (atIdx > 0 && before !== ' ') { setMentionQuery(null); return; }
    const query = val.slice(atIdx + 1).toLowerCase();
    setMentionQuery(query);
    setMentionResults(allFiles.filter(f => f.toLowerCase().includes(query)).slice(0, 8));
    setMentionIndex(0);
  }, [allFiles]);

  const selectMention = useCallback((filePath: string) => {
    const atIdx = input.lastIndexOf('@');
    setInput(input.slice(0, atIdx));
    setMentionQuery(null);
    if (!attachedFiles.includes(filePath)) {
      setAttachedFiles(prev => [...prev, filePath]);
    }
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [input, attachedFiles]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (mentionQuery === null) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMentionIndex(i => Math.min(i + 1, mentionResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMentionIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (mentionResults.length > 0) {
        e.preventDefault();
        selectMention(mentionResults[mentionIndex]);
      }
    }
  }, [mentionQuery, mentionResults, mentionIndex, selectMention]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handlePickLocalFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const picked = Array.from(files).slice(0, 8);
    const accepted: File[] = [];
    const rejected: string[] = [];

    for (const f of picked) {
      const ext = getExt(f.name);
      if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
        rejected.push(f.name);
        continue;
      }
      accepted.push(f);
    }

    if (rejected.length > 0) {
      setUploadError(`Unsupported file type: ${rejected.join(', ')}`);
    } else {
      setUploadError('');
    }

    const loaded = await Promise.all(accepted.map(async (f) => {
      const ext = getExt(f.name);
      if (ext === '.pdf') {
        try {
          const extracted = await extractPdfText(f);
          return {
            name: f.name,
            content: extracted || `[PDF: ${f.name}] Could not extract readable text (possibly scanned/image PDF).`,
          };
        } catch {
          return {
            name: f.name,
            content: `[PDF: ${f.name}] Failed to extract text from this PDF.`,
          };
        }
      }
      return {
        name: f.name,
        content: await f.text(),
      };
    }));

    setLocalAttachments(prev => {
      const merged = [...prev];
      for (const item of loaded) {
        if (!merged.some(m => m.name === item.name && m.content === item.content)) merged.push(item);
      }
      return merged;
    });
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (mentionQuery !== null) return;
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: Message = { role: 'user', content: text };
    const requestMessages = [...messages, userMsg];
    setMessages([...requestMessages, { role: 'assistant', content: '' }]);
    setInput('');
    setAttachedFiles(currentFile ? [currentFile] : []);
    setIsLoading(true);
    setLoadingPhase('connecting');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: requestMessages,
          currentFile,
          attachedFiles,
          uploadedFiles: localAttachments,
          maxSteps,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        // Try to extract error message from JSON response
        let errorMsg = `Request failed (${res.status})`;
        try {
          const errBody = await res.json();
          if (errBody.error) errorMsg = errBody.error;
        } catch {}
        throw new Error(errorMsg);
      }

      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      setLoadingPhase('thinking');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk) setLoadingPhase('streaming');
        assistantContent += chunk;
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: assistantContent };
          return updated;
        });
      }

      // Empty stream usually means an API key or provider error was swallowed
      if (!assistantContent.trim()) {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: 'assistant',
            content: `__error__${t.ask.errorNoResponse}`,
          };
          return updated;
        });
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setMessages(prev => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant' && !updated[lastIdx].content.trim()) {
            updated[lastIdx] = { role: 'assistant', content: `__error__${t.ask.stopped}` };
          }
          return updated;
        });
      } else {
        const errMsg = err instanceof Error ? err.message : 'Something went wrong';
        setMessages(prev => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant' && !updated[lastIdx].content.trim()) {
            updated[lastIdx] = { role: 'assistant', content: `__error__${errMsg}` };
            return updated;
          }
          return [...updated, {
            role: 'assistant',
            content: `__error__${errMsg}`,
          }];
        });
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [input, messages, isLoading, currentFile, attachedFiles, localAttachments, mentionQuery, maxSteps, t.ask.errorNoResponse, t.ask.stopped]);

  const handleResetSession = useCallback(() => {
    if (isLoading) return;
    const fresh = createSession(currentFile);
    setActiveSessionId(fresh.id);
    setMessages([]);
    setInput('');
    setAttachedFiles(currentFile ? [currentFile] : []);
    setLocalAttachments([]);
    setUploadError('');
    setMentionQuery(null);
    setMentionResults([]);
    setMentionIndex(0);
    setShowHistory(false);

    setSessions((prev) => {
      const next = [fresh, ...prev].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS);
      void upsertSession(fresh);
      return next;
    });

    setTimeout(() => inputRef.current?.focus(), 0);
  }, [isLoading, currentFile]);

  const handleLoadSession = useCallback((id: string) => {
    const target = sessions.find((s) => s.id === id);
    if (!target) return;
    setActiveSessionId(target.id);
    setMessages(target.messages);
    setShowHistory(false);
    setInput('');
    setAttachedFiles(currentFile ? [currentFile] : []);
    setLocalAttachments([]);
    setUploadError('');
    setMentionQuery(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [sessions, currentFile]);

  const handleDeleteSession = useCallback((id: string) => {
    void removeSession(id);

    const remaining = sessions.filter((s) => s.id !== id);
    setSessions(remaining);

    if (activeSessionId === id) {
      const fresh = createSession(currentFile);
      setActiveSessionId(fresh.id);
      setMessages([]);
      const next = [fresh, ...remaining].slice(0, MAX_SESSIONS);
      setSessions(next);
      void upsertSession(fresh);
    }
  }, [activeSessionId, currentFile, sessions]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.ask.title}
        className="w-full max-w-2xl mx-4 bg-card border border-border rounded-xl shadow-2xl flex flex-col max-h-[75vh]"
      >

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Sparkles size={15} style={{ color: 'var(--amber)' }} />
            <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{t.ask.title}</span>
            {currentFile && (
              <span className="text-xs text-muted-foreground font-normal truncate max-w-[200px]">
                — {currentFile.split('/').pop()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Session history"
            >
              <History size={14} />
            </button>
            <button
              type="button"
              onClick={handleResetSession}
              disabled={isLoading}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
              title="New session"
            >
              <RotateCcw size={14} />
            </button>
            <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
              <X size={15} />
            </button>
          </div>
        </div>

        {showHistory && (
          <div className="border-b border-border px-4 py-2.5 max-h-[190px] overflow-y-auto">
            <div className="text-[11px] text-muted-foreground mb-2">Session History</div>
            <div className="flex flex-col gap-1.5">
              {sessions.length === 0 && (
                <div className="text-xs text-muted-foreground/70">No saved sessions.</div>
              )}
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleLoadSession(s.id)}
                    className={`flex-1 text-left px-2 py-1.5 rounded text-xs transition-colors ${activeSessionId === s.id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                  >
                    <div className="truncate">{sessionTitle(s)}</div>
                    <div className="text-[10px] opacity-60">{new Date(s.updatedAt).toLocaleString()}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteSession(s.id)}
                    className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-muted"
                    title="Delete session"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
          {messages.length === 0 && (
            <div className="mt-6 space-y-3">
              <p className="text-center text-sm text-muted-foreground/60">
                {t.ask.emptyPrompt}
              </p>
              <div className="flex flex-col gap-2 px-2">
                {t.ask.suggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setInput(s)}
                    className="text-left text-xs px-3 py-2 rounded-lg border border-border bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'assistant' && (
                <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: 'var(--amber-dim)' }}>
                  <Sparkles size={12} style={{ color: 'var(--amber)' }} />
                </div>
              )}
              {m.role === 'user' ? (
                <div
                  className="max-w-[85%] px-3 py-2 rounded-xl rounded-br-sm text-sm leading-relaxed whitespace-pre-wrap"
                  style={{ background: 'var(--amber)', color: '#131210' }}
                >
                  {m.content}
                </div>
              ) : m.content.startsWith('__error__') ? (
                <div className="max-w-[85%] px-3 py-2.5 rounded-xl rounded-bl-sm border border-red-500/20 bg-red-500/8 text-sm">
                  <div className="flex items-start gap-2 text-red-400">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span className="leading-relaxed">{m.content.slice(9)}</span>
                  </div>
                </div>
              ) : (
                <div className="max-w-[85%] px-3 py-2 rounded-xl rounded-bl-sm bg-muted text-foreground text-sm">
                  {m.content
                    ? <AssistantMessage
                        content={m.content}
                        isStreaming={isLoading && i === messages.length - 1}
                      />
                    : isLoading && i === messages.length - 1
                      ? <div className="flex items-center gap-2 py-1">
                          <Loader2 size={14} className="animate-spin" style={{ color: 'var(--amber)' }} />
                          <span className="text-xs text-muted-foreground animate-pulse">
                            {loadingPhase === 'connecting'
                              ? t.ask.connecting
                              : loadingPhase === 'thinking'
                                ? t.ask.thinking
                                : t.ask.generating}
                          </span>
                        </div>
                      : null
                  }
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-border shrink-0">
          {/* Attached file chips */}
          {attachedFiles.length > 0 && (
            <div className="px-4 pt-2.5 pb-1">
              <div className="text-[11px] text-muted-foreground/70 mb-1.5">Knowledge Base Context</div>
              <div className="flex flex-wrap gap-1.5">
              {attachedFiles.map(f => (
                <FileChip
                  key={f}
                  path={f}
                  onRemove={() => setAttachedFiles(prev => prev.filter(x => x !== f))}
                />
              ))}
              </div>
            </div>
          )}

          {localAttachments.length > 0 && (
            <div className="px-4 pb-1">
              <div className="text-[11px] text-muted-foreground/70 mb-1.5">Uploaded Files</div>
              <div className="flex flex-wrap gap-1.5">
                {localAttachments.map((f, idx) => (
                  <span key={`${f.name}-${idx}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border border-border bg-muted text-foreground max-w-[220px]">
                    <Paperclip size={11} className="text-zinc-400 shrink-0" />
                    <span className="truncate" title={f.name}>{f.name}</span>
                    <button
                      type="button"
                      onClick={() => setLocalAttachments(prev => prev.filter((_, i) => i !== idx))}
                      className="text-muted-foreground hover:text-foreground ml-0.5 shrink-0"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {uploadError && (
            <div className="px-4 pb-1 text-xs text-red-400">{uploadError}</div>
          )}

          {/* @-mention dropdown */}
          {mentionQuery !== null && mentionResults.length > 0 && (
            <div className="mx-4 mb-1 border border-border rounded-lg bg-card shadow-lg overflow-hidden">
              {mentionResults.map((f, idx) => {
                const name = f.split('/').pop() ?? f;
                const isCsv = name.endsWith('.csv');
                return (
                  <button
                    key={f}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); selectMention(f); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${idx === mentionIndex ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                  >
                    {isCsv
                      ? <Table size={13} className="text-emerald-400 shrink-0" />
                      : <FileText size={13} className="text-zinc-400 shrink-0" />
                    }
                    <span className="truncate flex-1">{name}</span>
                    <span className="text-[10px] text-muted-foreground/50 truncate max-w-[140px] shrink-0">{f.split('/').slice(0, -1).join('/')}</span>
                  </button>
                );
              })}
              <div className="px-3 py-1.5 border-t border-border flex gap-3 text-[10px] text-muted-foreground/50">
                <span>↑↓ navigate</span><span>↵ select</span><span>ESC dismiss</span>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex items-center gap-2 px-3 py-3">
            {/* Attachment picker button */}
            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
              title="Attach local file"
            >
              <Paperclip size={15} />
            </button>

            <input
              ref={uploadInputRef}
              type="file"
              className="hidden"
              multiple
              accept=".txt,.md,.markdown,.csv,.json,.yaml,.yml,.xml,.html,.htm,.pdf,text/plain,text/markdown,text/csv,application/json,application/pdf"
              onChange={async (e) => {
                const inputEl = e.currentTarget;
                const files = inputEl.files;
                await handlePickLocalFiles(files);
                inputEl.value = '';
              }}
            />

            {/* @-mention button */}
            <button
              type="button"
              onClick={() => {
                const el = inputRef.current;
                if (!el) return;
                const pos = el.selectionStart ?? input.length;
                const newVal = input.slice(0, pos) + '@' + input.slice(pos);
                handleInputChange(newVal);
                setTimeout(() => { el.focus(); el.setSelectionRange(pos + 1, pos + 1); }, 0);
              }}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
              title="@ mention file"
            >
              <AtSign size={15} />
            </button>

            <input
              ref={inputRef}
              value={input}
              onChange={e => handleInputChange(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={t.ask.placeholder}
              disabled={isLoading}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-50"
            />

            {isLoading ? (
              <button
                type="button"
                onClick={handleStop}
                className="p-1.5 rounded-md transition-colors shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted"
                title={t.ask.stopTitle}
              >
                <StopCircle size={15} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="p-1.5 rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shrink-0"
                style={{ background: 'var(--amber)', color: '#131210' }}
              >
                <Send size={14} />
              </button>
            )}
          </form>
        </div>

        {/* Footer hint */}
        <div className="px-4 pb-2 flex items-center gap-3 text-xs text-muted-foreground/50 shrink-0">
          <span><kbd className="font-mono">↵</kbd> {t.ask.send}</span>
          <span><kbd className="font-mono">@</kbd> {t.ask.attachFile}</span>
          <span className="inline-flex items-center gap-1">
            <span>Agent steps</span>
            <select
              value={maxSteps}
              onChange={(e) => setMaxSteps(Number(e.target.value))}
              disabled={isLoading}
              className="bg-transparent border border-border rounded px-1.5 py-0.5 text-[11px] text-foreground"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={30}>30</option>
            </select>
          </span>
          <span><kbd className="font-mono">ESC</kbd> {t.search.close}</span>
        </div>
      </div>
    </div>
  );
}

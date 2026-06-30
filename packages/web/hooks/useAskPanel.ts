'use client';

import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { RIGHT_ASK_DEFAULT_WIDTH, RIGHT_ASK_MIN_WIDTH, RIGHT_ASK_MAX_WIDTH } from '@/components/RightAskPanel';
import { useAskModal, type AcpAgentSelection, type AskAgentRuntimeSelection } from './useAskModal';
import {
  ASK_ADD_CONTEXT_EVENT,
  normalizeAskContextDetail,
  type AskAddContextDetail,
  type AskContextRequest,
} from '@/lib/ask-context-events';

export interface AskPanelState {
  askPanelOpen: boolean;
  askPanelWidth: number;
  askMaximized: boolean;
  askMode: 'panel' | 'popup';
  desktopAskPopupOpen: boolean;
  askInitialMessage: string;
  askOpenSource: 'user' | 'guide' | 'guide-next';
  askAcpAgent: AcpAgentSelection | null;
  askAgentRuntime: AskAgentRuntimeSelection | null;
  askNewSession: boolean;
  askOpenRequestId: number;
  askContextRequest: AskContextRequest | null;
  toggleAskPanel: () => void;
  closeAskPanel: () => void;
  closeDesktopAskPopup: () => void;
  handleAskWidthChange: (w: number) => void;
  handleAskWidthCommit: (w: number) => void;
  handleAskModeSwitch: () => void;
  toggleAskMaximized: (restoreWidth?: number) => void;
}

/**
 * Manages right-side Ask AI panel state: open/close, width, panel/popup mode, initial message.
 * Extracted from SidebarLayout to reduce its state complexity.
 */
export function useAskPanel(): AskPanelState {
  const pathname = usePathname();
  const fullPageChat = pathname === '/chat' || pathname.startsWith('/chat/');
  const [askPanelOpen, setAskPanelOpen] = useState(false);
  const [askPanelWidth, setAskPanelWidth] = useState(RIGHT_ASK_DEFAULT_WIDTH);
  const [askMode, setAskMode] = useState<'panel' | 'popup'>('panel');
  const [desktopAskPopupOpen, setDesktopAskPopupOpen] = useState(false);
  const [askInitialMessage, setAskInitialMessage] = useState('');
  const [askMaximized, setAskMaximized] = useState(false);
  const askMaximizedRef = useRef(false);
  useLayoutEffect(() => {
    askMaximizedRef.current = askMaximized;
  }, [askMaximized]);
  const [askOpenSource, setAskOpenSource] = useState<'user' | 'guide' | 'guide-next'>('user');
  const [askAcpAgent, setAskAcpAgent] = useState<AcpAgentSelection | null>(null);
  const [askAgentRuntime, setAskAgentRuntime] = useState<AskAgentRuntimeSelection | null>(null);
  const [askNewSession, setAskNewSession] = useState(false);
  const [askOpenRequestId, setAskOpenRequestId] = useState(0);
  const [askContextRequest, setAskContextRequest] = useState<AskContextRequest | null>(null);
  const lastNonFocusWidthRef = useRef(RIGHT_ASK_DEFAULT_WIDTH);
  const askModeRef = useRef(askMode);
  const contextRequestIdRef = useRef(0);

  const askModal = useAskModal();

  useLayoutEffect(() => {
    askModeRef.current = askMode;
  }, [askMode]);

  useEffect(() => {
    if (!fullPageChat) return;
    setAskPanelOpen(false);
    setDesktopAskPopupOpen(false);
    if (askMaximizedRef.current) {
      setAskMaximized(false);
      setAskPanelWidth(lastNonFocusWidthRef.current);
    }
  }, [fullPageChat]);

  useEffect(() => {
    const onAddContext = (event: Event) => {
      if (fullPageChat) return;
      const normalized = normalizeAskContextDetail((event as CustomEvent<AskAddContextDetail>).detail);
      if (!normalized) return;

      setAskInitialMessage('');
      setAskOpenSource('user');
      setAskAcpAgent(null);
      setAskAgentRuntime(null);
      setAskNewSession(false);
      setAskOpenRequestId((value) => value + 1);
      setAskContextRequest({
        id: ++contextRequestIdRef.current,
        ...normalized,
      });

      if (askModeRef.current === 'popup') {
        setDesktopAskPopupOpen(true);
      } else {
        setAskPanelOpen(true);
      }

      if (askMaximizedRef.current) {
        setAskMaximized(false);
        setAskPanelWidth(lastNonFocusWidthRef.current);
      }
    };
    window.addEventListener(ASK_ADD_CONTEXT_EVENT, onAddContext);
    return () => window.removeEventListener(ASK_ADD_CONTEXT_EVENT, onAddContext);
  }, [fullPageChat]);

  // Load persisted width + mode
  useEffect(() => {
    try {
      const stored = localStorage.getItem('right-ask-panel-width');
      if (stored) {
        const w = parseInt(stored, 10);
        if (w >= RIGHT_ASK_MIN_WIDTH && w <= RIGHT_ASK_MAX_WIDTH) {
          setAskPanelWidth(w);
          lastNonFocusWidthRef.current = w;
        } else if (w > RIGHT_ASK_MAX_WIDTH) {
          // Stored value exceeds new max (e.g., after config change) — clamp
          setAskPanelWidth(RIGHT_ASK_DEFAULT_WIDTH);
          lastNonFocusWidthRef.current = RIGHT_ASK_DEFAULT_WIDTH;
        }
      }
      const mode = localStorage.getItem('ask-mode');
      if (mode === 'popup') setAskMode('popup');
    } catch {}

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'ask-mode' && (e.newValue === 'panel' || e.newValue === 'popup')) {
        setAskMode(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);

    // Listen for "dock to panel" from home page/full-page chat fullscreen.
    // While on /chat/* the panel remains visually suppressed by SidebarLayout,
    // but keeping askPanelOpen=true lets the next content route open docked
    // without a lost event during navigation.
    const onOpenPanel = () => {
      setAskPanelOpen(true);
      if (askMaximizedRef.current) {
        setAskMaximized(false);
        setAskPanelWidth(lastNonFocusWidthRef.current);
      }
    };
    window.addEventListener('mindos:open-ask-panel', onOpenPanel);

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('mindos:open-ask-panel', onOpenPanel);
    };
  }, [fullPageChat]);

  // Bridge useAskModal store → right Ask panel or popup
  useEffect(() => {
    if (askModal.open) {
      if (fullPageChat) {
        askModal.close();
        return;
      }
      setAskInitialMessage(askModal.initialMessage);
      setAskOpenSource(askModal.source);
      setAskAcpAgent(askModal.acpAgent);
      setAskAgentRuntime(askModal.agentRuntime);
      setAskNewSession(askModal.newSession);
      setAskOpenRequestId(askModal.requestId);
      if (askMode === 'popup') {
        setDesktopAskPopupOpen(true);
      } else {
        setAskPanelOpen(true);
      }
      askModal.close();
    }
  }, [askModal.open, askModal.initialMessage, askModal.source, askModal.acpAgent, askModal.agentRuntime, askModal.newSession, askModal.requestId, askModal.close, askMode, fullPageChat]);

  const toggleAskPanel = useCallback(() => {
    if (fullPageChat) return;
    if (askMode === 'popup') {
      setDesktopAskPopupOpen(v => {
        if (!v) {
          setAskInitialMessage('');
          setAskOpenSource('user');
          setAskAcpAgent(null);
          setAskAgentRuntime(null);
          setAskNewSession(false);
          setAskOpenRequestId((value) => value + 1);
        }
        return !v;
      });
    } else {
      setAskPanelOpen(v => {
        if (!v) {
          setAskInitialMessage('');
          setAskOpenSource('user');
          setAskAcpAgent(null);
          setAskAgentRuntime(null);
          setAskNewSession(false);
          setAskOpenRequestId((value) => value + 1);
        }
        return !v;
      });
    }
  }, [askMode, fullPageChat]);

  const closeAskPanel = useCallback(() => {
    setAskPanelOpen(false);
    if (askMaximized) {
      setAskPanelWidth(lastNonFocusWidthRef.current);
      setAskMaximized(false);
    }
  }, [askMaximized]);

  const toggleAskMaximized = useCallback((restoreWidth?: number) => {
    setAskMaximized(prev => {
      if (!prev) {
        lastNonFocusWidthRef.current = typeof restoreWidth === 'number' && Number.isFinite(restoreWidth)
          ? Math.max(RIGHT_ASK_MIN_WIDTH, Math.min(RIGHT_ASK_MAX_WIDTH, Math.round(restoreWidth)))
          : askPanelWidth;
      } else {
        setAskPanelWidth(lastNonFocusWidthRef.current);
      }
      return !prev;
    });
  }, [askPanelWidth]);
  const closeDesktopAskPopup = useCallback(() => setDesktopAskPopupOpen(false), []);

  const handleAskWidthChange = useCallback((w: number) => {
    setAskPanelWidth(Math.max(RIGHT_ASK_MIN_WIDTH, Math.min(RIGHT_ASK_MAX_WIDTH, Math.round(w))));
  }, []);
  const handleAskWidthCommit = useCallback((w: number) => {
    const safeWidth = Math.max(RIGHT_ASK_MIN_WIDTH, Math.min(RIGHT_ASK_MAX_WIDTH, Math.round(w)));
    if (!askMaximizedRef.current) {
      lastNonFocusWidthRef.current = safeWidth;
      setAskPanelWidth(safeWidth);
      try { localStorage.setItem('right-ask-panel-width', String(safeWidth)); } catch {}
    }
  }, []);

  const handleAskModeSwitch = useCallback(() => {
    if (fullPageChat) return;
    setAskMode(prev => {
      const next = prev === 'panel' ? 'popup' : 'panel';
      try {
        localStorage.setItem('ask-mode', next);
        window.dispatchEvent(new StorageEvent('storage', { key: 'ask-mode', newValue: next }));
      } catch {}
      if (next === 'popup') {
        setAskPanelOpen(false);
        setDesktopAskPopupOpen(true);
      } else {
        setDesktopAskPopupOpen(false);
        setAskPanelOpen(true);
      }
      return next;
    });
  }, [fullPageChat]);

  return {
    askPanelOpen, askPanelWidth, askMaximized, askMode, desktopAskPopupOpen,
    askInitialMessage, askOpenSource, askAcpAgent, askAgentRuntime, askNewSession, askOpenRequestId, askContextRequest,
    toggleAskPanel, closeAskPanel, closeDesktopAskPopup,
    handleAskWidthChange, handleAskWidthCommit, handleAskModeSwitch, toggleAskMaximized,
  };
}

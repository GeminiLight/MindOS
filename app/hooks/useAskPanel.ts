'use client';

import { useState, useEffect, useCallback } from 'react';
import { RIGHT_ASK_DEFAULT_WIDTH, RIGHT_ASK_MIN_WIDTH, RIGHT_ASK_MAX_WIDTH } from '@/components/RightAskPanel';
import { useAskModal, type AcpAgentSelection } from './useAskModal';

export interface AskPanelState {
  askPanelOpen: boolean;
  askPanelWidth: number;
  askMaximized: boolean;
  askMode: 'panel' | 'popup';
  desktopAskPopupOpen: boolean;
  askInitialMessage: string;
  askOpenSource: 'user' | 'guide' | 'guide-next';
  askAcpAgent: AcpAgentSelection | null;
  toggleAskPanel: () => void;
  closeAskPanel: () => void;
  closeDesktopAskPopup: () => void;
  handleAskWidthChange: (w: number) => void;
  handleAskWidthCommit: (w: number) => void;
  handleAskModeSwitch: () => void;
  toggleAskMaximized: () => void;
}

/**
 * Manages right-side Ask AI panel state: open/close, width, panel/popup mode, initial message.
 * Extracted from SidebarLayout to reduce its state complexity.
 */
export function useAskPanel(): AskPanelState {
  const [askPanelOpen, setAskPanelOpen] = useState(false);
  const [askPanelWidth, setAskPanelWidth] = useState(RIGHT_ASK_DEFAULT_WIDTH);
  const [askMode, setAskMode] = useState<'panel' | 'popup'>('panel');
  const [desktopAskPopupOpen, setDesktopAskPopupOpen] = useState(false);
  const [askInitialMessage, setAskInitialMessage] = useState('');
  const [askMaximized, setAskMaximized] = useState(false);
  const [askOpenSource, setAskOpenSource] = useState<'user' | 'guide' | 'guide-next'>('user');
  const [askAcpAgent, setAskAcpAgent] = useState<AcpAgentSelection | null>(null);

  const askModal = useAskModal();

  // Load persisted width + mode
  useEffect(() => {
    try {
      const stored = localStorage.getItem('right-ask-panel-width');
      if (stored) {
        const w = parseInt(stored, 10);
        if (w >= RIGHT_ASK_MIN_WIDTH && w <= RIGHT_ASK_MAX_WIDTH) setAskPanelWidth(w);
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
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Bridge useAskModal store → right Ask panel or popup
  useEffect(() => {
    if (askModal.open) {
      setAskInitialMessage(askModal.initialMessage);
      setAskOpenSource(askModal.source);
      setAskAcpAgent(askModal.acpAgent);
      if (askMode === 'popup') {
        setDesktopAskPopupOpen(true);
      } else {
        setAskPanelOpen(true);
      }
      askModal.close();
    }
  }, [askModal.open, askModal.initialMessage, askModal.source, askModal.acpAgent, askModal.close, askMode]);

  const toggleAskPanel = useCallback(() => {
    if (askMode === 'popup') {
      setDesktopAskPopupOpen(v => {
        if (!v) { setAskInitialMessage(''); setAskOpenSource('user'); setAskAcpAgent(null); }
        return !v;
      });
    } else {
      setAskPanelOpen(v => {
        if (!v) { setAskInitialMessage(''); setAskOpenSource('user'); setAskAcpAgent(null); }
        return !v;
      });
    }
  }, [askMode]);

  const closeAskPanel = useCallback(() => { setAskPanelOpen(false); setAskMaximized(false); }, []);
  const toggleAskMaximized = useCallback(() => setAskMaximized(v => !v), []);
  const closeDesktopAskPopup = useCallback(() => setDesktopAskPopupOpen(false), []);

  const handleAskWidthChange = useCallback((w: number) => setAskPanelWidth(w), []);
  const handleAskWidthCommit = useCallback((w: number) => {
    try { localStorage.setItem('right-ask-panel-width', String(w)); } catch {}
  }, []);

  const handleAskModeSwitch = useCallback(() => {
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
  }, []);

  return {
    askPanelOpen, askPanelWidth, askMaximized, askMode, desktopAskPopupOpen,
    askInitialMessage, askOpenSource, askAcpAgent,
    toggleAskPanel, closeAskPanel, closeDesktopAskPopup,
    handleAskWidthChange, handleAskWidthCommit, handleAskModeSwitch, toggleAskMaximized,
  };
}

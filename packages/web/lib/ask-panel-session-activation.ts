'use client';

export const ASK_PANEL_SESSION_ACTIVATE_EVENT = 'mindos:ask-panel-session-activate';

export interface AskPanelSessionActivateDetail {
  sessionId: string;
  source: 'titlebar-tab';
}

export function requestAskPanelSessionActivation(sessionId: string): boolean {
  if (typeof window === 'undefined') return false;
  const normalized = sessionId.trim();
  if (!normalized) return false;

  const event = new CustomEvent<AskPanelSessionActivateDetail>(ASK_PANEL_SESSION_ACTIVATE_EVENT, {
    cancelable: true,
    detail: {
      sessionId: normalized,
      source: 'titlebar-tab',
    },
  });

  return !window.dispatchEvent(event);
}

export function getAskPanelSessionActivationDetail(event: Event): AskPanelSessionActivateDetail | null {
  if (event.type !== ASK_PANEL_SESSION_ACTIVATE_EVENT) return null;
  const detail = (event as CustomEvent<Partial<AskPanelSessionActivateDetail>>).detail;
  const sessionId = typeof detail?.sessionId === 'string' ? detail.sessionId.trim() : '';
  if (!sessionId) return null;
  return {
    sessionId,
    source: 'titlebar-tab',
  };
}

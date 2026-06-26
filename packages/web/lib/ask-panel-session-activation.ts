'use client';

export const ASK_PANEL_SESSION_ACTIVATE_EVENT = 'mindos:ask-panel-session-activate';

export type AskPanelSessionActivateSource = 'titlebar-tab' | 'titlebar-new' | 'studio-project';

export interface AskPanelSessionLoadDetail {
  action: 'load';
  sessionId: string;
  source: Extract<AskPanelSessionActivateSource, 'titlebar-tab' | 'studio-project'>;
}

export interface AskPanelNewSessionDetail {
  action: 'new';
  projectId?: string;
  title?: string;
  source: Extract<AskPanelSessionActivateSource, 'titlebar-new' | 'studio-project'>;
}

export type AskPanelSessionActivateDetail = AskPanelSessionLoadDetail | AskPanelNewSessionDetail;

export function requestAskPanelSessionActivation(
  sessionId: string,
  source: AskPanelSessionLoadDetail['source'] = 'titlebar-tab',
): boolean {
  if (typeof window === 'undefined') return false;
  const normalized = sessionId.trim();
  if (!normalized) return false;

  const event = new CustomEvent<AskPanelSessionActivateDetail>(ASK_PANEL_SESSION_ACTIVATE_EVENT, {
    cancelable: true,
    detail: {
      action: 'load',
      sessionId: normalized,
      source,
    },
  });

  return !window.dispatchEvent(event);
}

export function requestAskPanelNewSessionActivation({
  projectId,
  title,
  source = 'titlebar-new',
}: {
  projectId?: string;
  title?: string;
  source?: AskPanelNewSessionDetail['source'];
} = {}): boolean {
  if (typeof window === 'undefined') return false;
  const normalizedProjectId = projectId?.trim();
  const normalizedTitle = title?.trim();
  const event = new CustomEvent<AskPanelSessionActivateDetail>(ASK_PANEL_SESSION_ACTIVATE_EVENT, {
    cancelable: true,
    detail: {
      action: 'new',
      ...(normalizedProjectId ? { projectId: normalizedProjectId } : {}),
      ...(normalizedTitle ? { title: normalizedTitle } : {}),
      source,
    },
  });

  return !window.dispatchEvent(event);
}

export function getAskPanelSessionActivationDetail(event: Event): AskPanelSessionActivateDetail | null {
  if (event.type !== ASK_PANEL_SESSION_ACTIVATE_EVENT) return null;
  const detail = (event as CustomEvent<Record<string, unknown>>).detail;
  if (detail?.action === 'new') {
    const projectId = typeof detail.projectId === 'string' ? detail.projectId.trim() : '';
    const title = typeof detail.title === 'string' ? detail.title.trim() : '';
    const source = detail.source === 'studio-project' ? 'studio-project' : 'titlebar-new';
    return {
      action: 'new',
      ...(projectId ? { projectId } : {}),
      ...(title ? { title } : {}),
      source,
    };
  }

  const sessionId = typeof detail?.sessionId === 'string' ? detail.sessionId.trim() : '';
  if (!sessionId) return null;
  return {
    action: 'load',
    sessionId,
    source: detail?.source === 'studio-project' ? 'studio-project' : 'titlebar-tab',
  };
}

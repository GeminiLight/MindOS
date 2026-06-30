export type HomeSessionViewMode = 'project' | 'recent';
export type HomeSessionSectionId = 'pinned' | 'projects' | 'chats';

const HOME_SESSION_VIEW_STORAGE_KEY = 'mindos.home.sessionViewMode';
const HOME_SESSION_PROJECT_COLLAPSE_STORAGE_KEY = 'mindos.home.collapsedSessionProjectGroups';
const HOME_SESSION_SECTION_COLLAPSE_STORAGE_KEY = 'mindos.home.collapsedSessionSections';

export function loadHomeSessionViewMode(): HomeSessionViewMode {
  if (typeof window === 'undefined') return 'project';
  try {
    const value = window.localStorage.getItem(HOME_SESSION_VIEW_STORAGE_KEY);
    return value === 'recent' ? 'recent' : 'project';
  } catch {
    return 'project';
  }
}

export function persistHomeSessionViewMode(value: HomeSessionViewMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HOME_SESSION_VIEW_STORAGE_KEY, value);
  } catch {
    // Local storage may be unavailable in privacy modes; the in-memory view still works.
  }
}

export function loadCollapsedSessionProjectGroups(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(HOME_SESSION_PROJECT_COLLAPSE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}

export function persistCollapsedSessionProjectGroups(value: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HOME_SESSION_PROJECT_COLLAPSE_STORAGE_KEY, JSON.stringify(Array.from(value)));
  } catch {
    // Local storage may be unavailable in privacy modes; the in-memory collapse state still works.
  }
}

export function loadCollapsedHomeSessionSections(): Set<HomeSessionSectionId> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(HOME_SESSION_SECTION_COLLAPSE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((item): item is HomeSessionSectionId => item === 'pinned' || item === 'projects' || item === 'chats')
        : [],
    );
  } catch {
    return new Set();
  }
}

export function persistCollapsedHomeSessionSections(value: Set<HomeSessionSectionId>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HOME_SESSION_SECTION_COLLAPSE_STORAGE_KEY, JSON.stringify(Array.from(value)));
  } catch {
    // Local storage may be unavailable in privacy modes; the in-memory collapse state still works.
  }
}

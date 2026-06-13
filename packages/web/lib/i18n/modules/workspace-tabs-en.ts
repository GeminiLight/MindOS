// Workspace tab strip (titlebar row) + /chat route (spec-titlebar-row Phase 2)

export const workspaceTabsEn = {
  workspaceTabs: {
    newChat: 'New chat',
    closeTab: 'Close tab',
    moreTabs: (n: number) => `${n} more tab${n !== 1 ? 's' : ''}`,
    overflowMenuTitle: 'Hidden tabs',
    tabLimitReached: 'Tab limit reached (50). Close a tab to open another.',
    docTab: 'Document',
    chatTab: 'Chat session',
    sessionNotFoundTitle: 'This conversation no longer exists',
    sessionNotFoundHint: 'It may have been deleted, or evicted by the 30-session history limit.',
    closeThisTab: 'Close this tab',
    backToHome: 'Back to home',
  },
};

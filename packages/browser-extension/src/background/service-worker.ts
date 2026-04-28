/* ── Service Worker — Context menu + keyboard shortcut handler ── */

/** Create context menu on install */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'clip-to-mindos',
    title: 'Save to MindOS',
    contexts: ['page', 'selection'],
  });
});

/** Handle context menu click */
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'clip-to-mindos' || !tab?.id) return;
  // Open popup programmatically — Manifest V3 doesn't allow this directly,
  // so we send a message to the content script to trigger the popup.
  chrome.action.openPopup().catch(() => {
    // Fallback: some browsers don't support openPopup()
    // The user can click the extension icon instead
  });
});

/** Handle keyboard shortcut */
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'clip-page') return;
  chrome.action.openPopup().catch(() => {});
});

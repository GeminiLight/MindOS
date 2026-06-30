/* ── Service Worker — Context menu, shortcut, and MindOS Browser Bridge ── */

import { isConfigured, loadConfig } from '../lib/storage';
import {
  MINDOS_CONTENT_BRIDGE_SOURCE,
  bridgeOpenUrlFromPayload,
  isAllowedMindosPageUrl,
  isMindosExtensionBridgeRequest,
  isMindosPageBridgeRequest,
  type MindosBridgeResponse,
  type MindosExtensionBridgeRequest,
} from '../lib/bridge-protocol';

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isMindosExtensionBridgeRequest(message)) return false;

  void handleBridgeRequest(message, sender)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'MindOS browser bridge failed',
      } satisfies MindosBridgeResponse);
    });

  return true;
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  const bridgeMessage: MindosExtensionBridgeRequest | null = isMindosExtensionBridgeRequest(message)
    ? message
    : isMindosPageBridgeRequest(message)
      ? {
          source: MINDOS_CONTENT_BRIDGE_SOURCE,
          id: message.id,
          type: message.type,
          payload: message.payload,
        }
      : null;
  if (!bridgeMessage) return false;

  void handleBridgeRequest(bridgeMessage, sender)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'MindOS browser bridge failed',
      } satisfies MindosBridgeResponse);
    });

  return true;
});

async function handleBridgeRequest(
  message: MindosExtensionBridgeRequest,
  sender: chrome.runtime.MessageSender,
): Promise<MindosBridgeResponse> {
  if (!isAllowedMindosPageUrl(sender.url)) {
    return { ok: false, error: 'MindOS browser bridge only accepts local MindOS pages' };
  }

  switch (message.type) {
    case 'bridge.ping':
    case 'bridge.getStatus':
      return { ok: true, data: await bridgeStatus() };

    case 'bridge.openUrlForUserCapture': {
      const url = bridgeOpenUrlFromPayload(message.payload);
      if (!url) return { ok: false, error: 'Only http:// and https:// URLs can be opened' };
      const tab = await chrome.tabs.create({ url, active: true });
      return {
        ok: true,
        data: {
          opened: true,
          tabId: tab.id,
          url: tab.url ?? url,
          instruction: 'Sign in if needed, wait for the page to load, then use the MindOS extension to save it.',
        },
      };
    }

    default:
      return { ok: false, error: 'Unsupported MindOS browser bridge request' };
  }
}

async function bridgeStatus() {
  const manifest = chrome.runtime.getManifest();
  const config = await loadConfig();
  return {
    installed: true,
    name: manifest.name,
    version: manifest.version,
    configured: isConfigured(config),
    mindosUrl: config.mindosUrl || null,
    transport: 'extension',
  };
}

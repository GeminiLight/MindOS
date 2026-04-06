/* ── Popup Controller — Orchestrates Setup / Clip / Save flows ── */

import TurndownService from 'turndown';
import { loadConfig, saveConfig, isConfigured } from '../lib/storage';
import { testConnection, saveToInbox } from '../lib/api';
import { toClipDocument } from '../lib/markdown';
import type { ClipperConfig, PageContent } from '../lib/types';

/* ── DOM refs ── */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const viewSetup = $<HTMLDivElement>('view-setup');
const viewClip = $<HTMLDivElement>('view-clip');
const viewSuccess = $<HTMLDivElement>('view-success');
const viewLoading = $<HTMLDivElement>('view-loading');

// Setup
const setupUrl = $<HTMLInputElement>('setup-url');
const setupToken = $<HTMLInputElement>('setup-token');
const setupError = $<HTMLDivElement>('setup-error');
const btnConnect = $<HTMLButtonElement>('btn-connect');

// Clip
const clipTitle = $<HTMLInputElement>('clip-title');
const clipSite = $<HTMLSpanElement>('clip-site');
const clipWords = $<HTMLSpanElement>('clip-words');
const clipError = $<HTMLDivElement>('clip-error');
const btnSave = $<HTMLButtonElement>('btn-save');
const btnSettings = $<HTMLButtonElement>('btn-settings');

// Success
const successDetail = $<HTMLParagraphElement>('success-detail');
const btnDone = $<HTMLButtonElement>('btn-done');
const btnClipAnother = $<HTMLButtonElement>('btn-clip-another');

/* ── State ── */

let config: ClipperConfig;
let extractedContent: PageContent | null = null;

/* ── View switching ── */

function showView(view: HTMLElement) {
  [viewSetup, viewClip, viewSuccess, viewLoading].forEach(v => v.hidden = true);
  view.hidden = false;
}

/* ── Button loading state ── */

function setButtonLoading(btn: HTMLButtonElement, loading: boolean) {
  const text = btn.querySelector('.btn-text') as HTMLElement;
  const spinner = btn.querySelector('.btn-loading') as HTMLElement;
  if (text) text.hidden = loading;
  if (spinner) spinner.hidden = !loading;
  btn.disabled = loading;
}

/* ── Turndown instance ── */

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
});

// Preserve code blocks
turndown.addRule('pre-code', {
  filter: (node) => node.nodeName === 'PRE' && !!node.querySelector('code'),
  replacement: (_content, node) => {
    const code = (node as Element).querySelector('code');
    const lang = code?.className?.match(/language-(\w+)/)?.[1] || '';
    const text = code?.textContent || '';
    return `\n\`\`\`${lang}\n${text}\n\`\`\`\n`;
  },
});

/* ── Extract content from active tab ── */

async function extractContent(): Promise<PageContent> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');

  // Content scripts can't run on chrome://, edge://, about:, or extension pages
  const url = tab.url ?? '';
  if (url.startsWith('chrome') || url.startsWith('edge') || url.startsWith('about:') || url.startsWith('moz-extension')) {
    throw new Error('Cannot clip browser internal pages');
  }

  // Inject content script on demand (not always-on — saves memory on every page)
  let results: chrome.scripting.InjectionResult[];
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/extractor.js'],
    });
  } catch {
    throw new Error('Cannot read this page — try refreshing first');
  }

  const result = results?.[0]?.result;
  if (!result || typeof result !== 'object') {
    throw new Error('Content extraction returned empty result');
  }

  return result as PageContent;
}

/* ── Init ── */

async function init() {
  config = await loadConfig();

  if (!isConfigured(config)) {
    showView(viewSetup);
    setupUrl.value = config.mindosUrl;
    return;
  }

  // Configured — extract content
  showView(viewLoading);

  let extractionError = '';

  try {
    [extractedContent] = await Promise.all([
      extractContent(),
    ]);
  } catch (err) {
    // Content extraction failed — show clip view with error
    extractionError = err instanceof Error ? err.message : 'Cannot read this page';
    extractedContent = null;
  }

  showClipView(extractionError);
}

function showClipView(errorMsg?: string) {
  showView(viewClip);

  if (errorMsg) {
    showError(clipError, errorMsg);
    btnSave.disabled = true;
  } else {
    hideError(clipError);
    btnSave.disabled = false;
  }

  if (extractedContent) {
    clipTitle.value = extractedContent.title;

    try {
      const host = new URL(extractedContent.url).hostname.replace(/^www\./, '');
      clipSite.textContent = host;
    } catch {
      clipSite.textContent = '';
    }

    clipWords.textContent = `${extractedContent.wordCount.toLocaleString()} words`;
  } else {
    clipTitle.value = '';
    clipSite.textContent = '';
    clipWords.textContent = '';
  }

  // Space selector no longer needed since we save to Inbox
}

/* ── Event Handlers ── */

// Connect button
btnConnect.addEventListener('click', async () => {
  const url = setupUrl.value.trim().replace(/\/+$/, '');
  const token = setupToken.value.trim();

  if (!url) { showError(setupError, 'Please enter your MindOS URL'); return; }
  if (!token) { showError(setupError, 'Please paste your auth token'); return; }

  hideError(setupError);
  setButtonLoading(btnConnect, true);

  const testConfig: ClipperConfig = {
    mindosUrl: url,
    authToken: token,
    defaultSpace: 'Clips',
    connected: false,
  };

  const result = await testConnection(testConfig);

  if (!result.ok) {
    setButtonLoading(btnConnect, false);
    showError(setupError, result.error || 'Connection failed');
    return;
  }

  // Save and proceed
  config = await saveConfig({ ...testConfig, connected: true });
  setButtonLoading(btnConnect, false);

  // Now extract content
  showView(viewLoading);

  try {
    [extractedContent] = await Promise.all([
      extractContent(),
    ]);
  } catch (err) {
    extractedContent = null;
    showClipView(err instanceof Error ? err.message : 'Cannot read this page');
    return;
  }

  showClipView();
});

// Save button
btnSave.addEventListener('click', async () => {
  if (!extractedContent) {
    showError(clipError, 'No content extracted from this page');
    return;
  }

  hideError(clipError);
  setButtonLoading(btnSave, true);

  // Override title if user edited
  const content = { ...extractedContent, title: clipTitle.value.trim() || extractedContent.title };

  // Create markdown (no space prefix since going to Inbox)
  const doc = toClipDocument(content, '', (html) => turndown.turndown(html));

  // Save to Inbox directly
  const result = await saveToInbox(config, doc.fileName, doc.markdown);

  setButtonLoading(btnSave, false);

  if (result.error) {
    showError(clipError, result.error);
    return;
  }

  // Success!
  successDetail.textContent = `Inbox/${doc.fileName}`;
  showView(viewSuccess);
});

// Settings button — go back to setup
btnSettings.addEventListener('click', () => {
  setupUrl.value = config.mindosUrl;
  setupToken.value = config.authToken;
  showView(viewSetup);
});

// Done button — close popup
btnDone.addEventListener('click', () => {
  window.close();
});

// Clip Again — go back to clip view for same page
btnClipAnother.addEventListener('click', () => {
  showClipView();
});

/* ── Error display helpers ── */

function showError(el: HTMLElement, msg: string) {
  el.textContent = msg;
  el.hidden = false;
}

function hideError(el: HTMLElement) {
  el.hidden = true;
}

/* ── Boot ── */
init();

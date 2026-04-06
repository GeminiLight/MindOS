/* ── Popup Controller — Orchestrates Setup / Clip / Save flows ── */

import TurndownService from 'turndown';
import { loadConfig, saveConfig, isConfigured } from '../lib/storage';
import { testConnection, listDirs, saveToInbox, createFile } from '../lib/api';
import { toClipDocument } from '../lib/markdown';
import type { ClipperConfig, PageContent } from '../lib/types';

const INBOX_VALUE = '__inbox__';

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
const dirTrigger = $<HTMLButtonElement>('dir-trigger');
const dirLabel = $<HTMLSpanElement>('dir-label');
const dirPanel = $<HTMLDivElement>('dir-panel');
const dirBreadcrumb = $<HTMLDivElement>('dir-breadcrumb');
const dirList = $<HTMLDivElement>('dir-list');
const dirConfirm = $<HTMLButtonElement>('dir-confirm');
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
let allDirs: string[] = [];
let selectedPath = INBOX_VALUE;  // '__inbox__' or a dir path
let browsingPath = '';           // current level being viewed in picker

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
  // Step 1: inject Readability + extractor (IIFE, sets window.__mindosClipResult)
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/extractor.js'],
    });
  } catch {
    throw new Error('Cannot read this page — try refreshing first');
  }

  // Step 2: read the result back (executeScript with func can return values)
  let results: chrome.scripting.InjectionResult[];
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (window as any).__mindosClipResult,
    });
  } catch {
    throw new Error('Cannot read extraction result');
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
    [extractedContent, allDirs] = await Promise.all([
      extractContent(),
      listDirs(config),
    ]);
  } catch (err) {
    extractionError = err instanceof Error ? err.message : 'Cannot read this page';
    extractedContent = null;
    allDirs = await listDirs(config).catch(() => []);
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

  // Reset dir picker state
  selectedPath = INBOX_VALUE;
  browsingPath = '';
  updateDirLabel();
  toggleDirPanel(false);
}

/** Render the hierarchical directory picker at the current browsing level */
function renderDirPicker() {
  // Breadcrumb
  const segments = browsingPath ? browsingPath.split('/') : [];
  dirBreadcrumb.innerHTML = '';

  // Root / Inbox button
  const rootBtn = document.createElement('button');
  rootBtn.type = 'button';
  rootBtn.textContent = '/ Inbox';
  rootBtn.className = selectedPath === INBOX_VALUE && !browsingPath ? 'active' : '';
  rootBtn.addEventListener('click', () => {
    browsingPath = '';
    selectedPath = INBOX_VALUE;
    updateDirLabel();
    renderDirPicker();
  });
  dirBreadcrumb.appendChild(rootBtn);

  segments.forEach((seg, i) => {
    const sep = document.createElement('span');
    sep.className = 'crumb-sep';
    sep.innerHTML = '&#8250;';
    dirBreadcrumb.appendChild(sep);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = seg;
    const path = segments.slice(0, i + 1).join('/');
    btn.className = i === segments.length - 1 ? 'active' : '';
    btn.addEventListener('click', () => {
      browsingPath = path;
      selectedPath = path;
      updateDirLabel();
      renderDirPicker();
    });
    dirBreadcrumb.appendChild(btn);
  });

  // Child directories at current level
  const prefix = browsingPath ? browsingPath + '/' : '';
  const children = allDirs
    .filter(p => {
      if (!p.startsWith(prefix)) return false;
      const rest = p.slice(prefix.length);
      return rest.length > 0 && !rest.includes('/');
    })
    .sort();

  dirList.innerHTML = '';
  for (const childPath of children) {
    const childName = childPath.split('/').pop() || childPath;
    const hasChildren = allDirs.some(p => p.startsWith(childPath + '/'));

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dir-item';
    btn.innerHTML = `
      <svg class="dir-item-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      <span class="dir-item-name">${childName}</span>
      ${hasChildren ? '<svg class="dir-item-arrow" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>' : ''}
    `;
    btn.addEventListener('click', () => {
      browsingPath = childPath;
      selectedPath = childPath;
      updateDirLabel();
      renderDirPicker();
    });
    dirList.appendChild(btn);
  }
}

function updateDirLabel() {
  if (selectedPath === INBOX_VALUE) {
    dirLabel.textContent = 'Inbox';
  } else {
    dirLabel.textContent = selectedPath.split('/').join(' / ');
  }
}

function toggleDirPanel(show?: boolean) {
  const isOpen = show ?? dirPanel.hidden;
  dirPanel.hidden = !isOpen;
  dirTrigger.classList.toggle('active', isOpen);
  if (isOpen) renderDirPicker();
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
    defaultSpace: 'Inbox',
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
    [extractedContent, allDirs] = await Promise.all([
      extractContent(),
      listDirs(config),
    ]);
  } catch (err) {
    extractedContent = null;
    allDirs = [];
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
  const isInbox = selectedPath === INBOX_VALUE;

  const doc = toClipDocument(content, isInbox ? '' : selectedPath, (html) => turndown.turndown(html));

  // Route to Inbox API or File API based on user choice
  const result = isInbox
    ? await saveToInbox(config, doc.fileName, doc.markdown)
    : await createFile(config, selectedPath, doc.fileName, doc.markdown);

  setButtonLoading(btnSave, false);

  if (result.error) {
    showError(clipError, result.error);
    return;
  }

  // Success!
  const displayPath = isInbox ? `Inbox/${doc.fileName}` : `${selectedPath}/${doc.fileName}`;
  successDetail.textContent = displayPath;
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

// DirPicker — toggle panel
dirTrigger.addEventListener('click', () => toggleDirPanel());

// DirPicker — confirm selection
dirConfirm.addEventListener('click', () => toggleDirPanel(false));

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

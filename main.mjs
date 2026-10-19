import { mountSceneMotion } from './scene.mjs';
import { mountAgentMarquee } from './brands.mjs';
import { copyText, releaseDetails } from './lib.mjs';
import { mountPageMotion, mountTabIndicator, revealPanel, stopMotion } from './motion.mjs';

const html = document.documentElement;
const themeButton = document.querySelector('.theme-button');
function syncThemeButton() {
  themeButton?.setAttribute('aria-pressed', String(html.dataset.theme === 'dark'));
}
syncThemeButton();

const languageLink = document.querySelector('.language-link');
function syncLanguageAnchor() {
  if (!languageLink) return;
  let id = '';
  try { id = decodeURIComponent(location.hash.slice(1)); } catch { /* Ignore malformed fragments. */ }
  const target = new URL(languageLink.href);
  target.hash = id && document.getElementById(id) ? location.hash : '';
  languageLink.href = target.href;
}
syncLanguageAnchor();
window.addEventListener('hashchange', syncLanguageAnchor);

themeButton?.addEventListener('click', () => {
  const theme = html.dataset.theme === 'dark' ? 'light' : 'dark';
  html.dataset.theme = theme;
  try { localStorage.setItem('mindos-theme', theme); } catch { /* The theme works without persistence. */ }
  syncThemeButton();
});

const menu = document.querySelector('.menu-button');
const nav = document.getElementById('site-nav');
function closeMenu(restoreFocus = false) {
  menu?.setAttribute('aria-expanded', 'false');
  nav?.removeAttribute('data-open');
  if (restoreFocus) menu?.focus();
}
menu?.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  if (open) nav?.setAttribute('data-open', 'true'); else closeMenu();
});
nav?.querySelectorAll('a').forEach(a => a.addEventListener('click', () => closeMenu()));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menu?.getAttribute('aria-expanded') === 'true') closeMenu(true);
});
document.addEventListener('click', event => {
  if (menu?.getAttribute('aria-expanded') === 'true' && !event.target.closest('.site-header')) closeMenu();
});

document.querySelectorAll('[data-tabs]').forEach(list => {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const narrow = window.matchMedia('(max-width: 700px)');
  const syncOrientation = () => list.setAttribute('aria-orientation',
    list.dataset.tabs === 'screens' && !narrow.matches ? 'vertical' : 'horizontal');
  syncOrientation();
  narrow.addEventListener('change', syncOrientation);
  const moveIndicator = mountTabIndicator(list, tabs);
  function activate(index, focus = false) {
    const previous = tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true');
    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(tab.getAttribute('aria-controls'));
      stopMotion(panel);
      panel.hidden = !selected;
    });
    if (list.dataset.tabs === 'phases') list.closest('#coevolution').dataset.flowPhase = String(index);
    if (previous !== index) {
      moveIndicator();
      revealPanel(document.getElementById(tabs[index].getAttribute('aria-controls')), index > previous ? 1 : -1);
    }
    if (focus) tabs[index].focus();
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => activate(i));
    tab.addEventListener('keydown', event => {
      let next;
      const vertical = list.getAttribute('aria-orientation') === 'vertical';
      if (vertical && event.key === 'ArrowDown') next = (i + 1) % tabs.length;
      if (vertical && event.key === 'ArrowUp') next = (i + tabs.length - 1) % tabs.length;
      if (event.key === 'ArrowRight') next = (i + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (i + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); activate(next, true); }
    });
  });
});

const dialog = document.querySelector('.image-dialog');
let returnFocus;
function enlarge(index, trigger) {
  const original = document.querySelector('#screen-' + index + ' img');
  if (!dialog || !original || typeof dialog.showModal !== 'function') return false;
  const image = dialog.querySelector('img');
  image.src = original.src;
  image.alt = original.alt;
  returnFocus = trigger;
  dialog.showModal();
  revealPanel(dialog);
  dialog.querySelector('[data-close-image]').focus();
  return true;
}
document.querySelectorAll('[data-enlarge]').forEach(b => b.addEventListener('click', () => enlarge(b.dataset.enlarge, b)));
document.querySelectorAll('[data-image-link]').forEach(a => a.addEventListener('click', event => {
  if (enlarge(a.dataset.imageLink, a)) event.preventDefault();
}));
dialog?.querySelector('[data-close-image]')?.addEventListener('click', () => dialog.close());
dialog?.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const r = dialog.getBoundingClientRect();
  if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
});
dialog?.addEventListener('close', () => returnFocus?.focus());

document.querySelectorAll('[data-copy]').forEach(button => {
  const label = button.textContent;
  const status = button.closest('.copy-box').querySelector('.copy-status');
  let resetTimer;
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    clearTimeout(resetTimer);
    button.disabled = true;
    status.textContent = '';
    const text = document.getElementById(button.dataset.copy)?.textContent || '';
    let timeout;
    const success = await Promise.race([
      copyText(text, navigator.clipboard),
      new Promise(resolve => { timeout = setTimeout(() => resolve(false), 6000); }),
    ]);
    clearTimeout(timeout);
    button.disabled = false;
    button.textContent = success ? button.dataset.success : label;
    status.dataset.error = String(!success);
    status.textContent = success ? button.dataset.success : button.dataset.error;
    resetTimer = setTimeout(() => { button.textContent = label; }, 2500);
  });
});

// Release metadata is optional enhancement. Direct downloads never wait for this request.
const releaseLink = document.querySelector('[data-release]');
if (releaseLink) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  fetch('https://api.github.com/repos/GeminiLight/MindOS/releases/latest', { signal: controller.signal })
    .then(response => response.ok ? response.json() : null)
    .then(data => {
      const release = releaseDetails(data);
      if (!release) return;
      const icon = releaseLink.querySelector('svg');
      releaseLink.replaceChildren('Desktop v' + release.version + ' ', ...(icon ? [icon] : []));
      releaseLink.href = release.url;
    })
    .catch(() => { /* Keep the native latest-release link and all download routes. */ })
    .finally(() => clearTimeout(timeout));
}
html.classList.add('js-ready');
mountPageMotion();
mountAgentMarquee();
mountSceneMotion();

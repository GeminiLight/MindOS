/**
 * Full-screen overlays injected into the main window.
 *
 * Extracted from main.ts, which carried four near-identical inline HTML blobs
 * with their own copies of the spinner CSS and their own `zh ? … : …` strings.
 */
import type { BrowserWindow } from 'electron';
import { mt } from './i18n/main-strings';

const SAFE_ID = /^[a-zA-Z][\w-]*$/;

/** Escape for use inside an HTML text node / attribute-free context. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SPINNER = `<div style="width:28px;height:28px;border:3px solid rgba(212,149,74,0.3);border-top-color:#d4954a;border-radius:50%;animation:spin 1s linear infinite;margin-bottom:14px"></div>`;
const KEYFRAMES = `<style>@keyframes spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){*{animation-duration:4s!important}}</style>`;

function shell(inner: string, opacity: number, blurPx: number): string {
  return `
    <div style="position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,${opacity});display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;backdrop-filter:blur(${blurPx}px);padding:24px;text-align:center">
      ${inner}
      ${KEYFRAMES}
    </div>
  `;
}

function titleAndDetail(title: string, detail?: string): string {
  const titleHtml = `<div style="color:#e8e4dc;font-size:18px;font-weight:600;max-width:420px;overflow-wrap:anywhere">${escapeHtml(title)}</div>`;
  const detailHtml = detail
    ? `<div style="color:#b7afa3;font-size:13px;margin-top:8px;max-width:360px;line-height:1.5;overflow-wrap:anywhere">${escapeHtml(detail)}</div>`
    : '';
  return `${SPINNER}${titleHtml}${detailHtml}`;
}

export const OVERLAY_IDS = {
  switching: 'mindos-switch-overlay',
  coreUpdate: 'mindos-core-update-overlay',
  runtimeUpdate: 'mindos-update-overlay',
  crashRepair: 'mindos-crash-repair-overlay',
  disconnected: 'mindos-disconnect-overlay',
} as const;

export function busyOverlayHtml(title: string, detail?: string): string {
  return shell(titleAndDetail(title, detail), 0.7, 8);
}

export function switchingOverlayHtml(): string {
  return shell(
    `<div style="color:#fff;font-size:16px">${escapeHtml(mt('switchingMode'))}</div>`,
    0.5,
    4,
  );
}

export function restartingOverlayHtml(): string {
  return shell(
    `<div style="color:#fff;font-size:16px">${escapeHtml(mt('restartingServices'))}</div>`,
    0.5,
    4,
  );
}

export function coreUpdateOverlayHtml(): string {
  return busyOverlayHtml(mt('coreUpdatingTitle'), mt('coreUpdatingShortDetail'));
}

export function runtimeUpdateOverlayHtml(): string {
  return busyOverlayHtml(mt('coreUpdatingTitle'), mt('coreUpdatingDetail'));
}

export function crashRepairOverlayHtml(): string {
  return busyOverlayHtml(mt('repairingRuntimeTitle'), mt('repairingRuntimeDetail'));
}

export function disconnectedOverlayHtml(): string {
  const inner = `
    <div style="color:#e8e4dc;font-size:18px;margin-bottom:8px">${escapeHtml(mt('connectionLostTitle'))}</div>
    <div style="color:#8a8275;font-size:13px;margin-bottom:20px">${escapeHtml(mt('connectionLostDetail'))}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
      <button onclick="location.reload()" style="padding:8px 18px;border-radius:8px;border:none;background:#c8873a;color:#fff;font-size:13px;cursor:pointer;font-weight:500">${escapeHtml(mt('retryNow'))}</button>
      <button onclick="window.mindos&&window.mindos.switchMode&&window.mindos.switchMode()" style="padding:8px 18px;border-radius:8px;border:1px solid rgba(232,228,220,0.15);background:rgba(255,255,255,0.08);color:#e8e4dc;font-size:13px;cursor:pointer">${escapeHtml(mt('switchToLocalMode'))}</button>
    </div>
  `;
  return shell(inner, 0.6, 6);
}

/**
 * Inject an overlay into the main window.
 * `id` must be a safe CSS identifier (alphanumeric + hyphens only).
 */
export async function injectOverlay(
  win: BrowserWindow | null,
  id: string,
  html: string,
): Promise<void> {
  if (!win || win.isDestroyed()) return;
  if (!SAFE_ID.test(id)) return;
  try {
    await win.webContents.executeJavaScript(`
      (function() {
        var _id = ${JSON.stringify(id)};
        if (document.getElementById(_id)) return;
        var d = document.createElement('div');
        d.id = _id;
        d.insertAdjacentHTML("beforeend", ${JSON.stringify(html)});
        document.body.appendChild(d);
      })()
    `);
  } catch (err) {
    console.warn('[MindOS] injectOverlay failed:', (err as Error)?.message);
  }
}

export async function removeOverlay(win: BrowserWindow | null, id: string): Promise<void> {
  if (!win || win.isDestroyed()) return;
  if (!SAFE_ID.test(id)) return;
  try {
    await win.webContents.executeJavaScript(
      `document.getElementById(${JSON.stringify(id)})?.remove()`,
    );
  } catch (err) {
    console.warn('[MindOS] removeOverlay failed:', (err as Error)?.message);
  }
}

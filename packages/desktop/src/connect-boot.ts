/**
 * Boot screen rendering — the startup state of connect.html when it is hosted
 * inside the main window (`?shell=boot`, see boot-shell.ts).
 *
 * This replaces splash.html, which was a separate 360x240 window with its own
 * inline i18n table, its own theme bootstrap and its own status renderer. All
 * three now come from the connect UI the rest of the shell already uses, so
 * there is one appearance source, one language source, and one place where a
 * startup failure is described.
 */
import { $, getIpc, setLabel } from './connect-dom';
import { t, type I18nKeys } from './i18n/index';

export interface BootStatusPayload {
  status?: string;
  message?: string;
  error?: string;
  actions?: Array<{ id: string; label: string; primary?: boolean }>;
  done?: boolean;
}

/**
 * Main reports coarse phases; the renderer owns their wording.
 *
 * Keeping the mapping here (rather than sending prose over IPC) is what lets
 * the language toggle re-render a boot screen that is already on screen.
 */
const STATUS_KEYS: Record<string, I18nKeys> = {
  detecting: 'bootDetecting',
  healing: 'bootHealing',
  starting: 'bootStarting',
  connecting: 'bootConnecting',
  ready: 'bootReady',
  error: 'bootFailed',
};

/** Action ids are stable contract with main; their labels are ours. */
const ACTION_KEYS: Record<string, I18nKeys> = {
  retry: 'bootActionRetry',
  quit: 'bootActionQuit',
  selectMode: 'bootActionSelectMode',
  switchRemote: 'bootActionSwitchRemote',
};

/** Phases slower than this are where a user starts to suspect a hang. */
const ELAPSED_VISIBLE_AFTER_MS = 10_000;
/** A first run compiles the frontend; say so rather than letting it look stuck. */
const FIRST_RUN_HINT_AFTER_MS = 20_000;

let elapsedTimer: ReturnType<typeof setInterval> | null = null;
let phaseStartedAt = 0;
/**
 * The current phase as a descriptor rather than rendered text, so toggling the
 * language re-renders it. The splash stored a string and froze in whatever
 * language it started in.
 */
let phase: { key: I18nKeys } | { text: string } | null = null;
let lastPayload: BootStatusPayload | null = null;

function phaseText(): string {
  if (!phase) return '';
  return 'key' in phase ? t(phase.key) : phase.text;
}

function renderPhase(): void {
  const el = $('boot-status');
  if (!el || !phase) return;
  const elapsedMs = Date.now() - phaseStartedAt;
  const base = phaseText();
  el.textContent = elapsedMs >= ELAPSED_VISIBLE_AFTER_MS
    ? `${base}  ${t('bootElapsed', { seconds: Math.floor(elapsedMs / 1000) })}`
    : base;

  const hint = $('boot-hint');
  if (hint) {
    const show = elapsedMs >= FIRST_RUN_HINT_AFTER_MS;
    hint.classList.toggle('hidden', !show);
    if (show) setLabel(hint, 'bootFirstRunHint');
  }
}

function stopElapsed(): void {
  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
}

function startPhase(next: { key: I18nKeys } | { text: string }): void {
  phase = next;
  phaseStartedAt = Date.now();
  stopElapsed();
  renderPhase();
  elapsedTimer = setInterval(renderPhase, 1000);
}

function renderActions(actions: BootStatusPayload['actions']): void {
  const host = $('boot-actions');
  if (!host) return;
  host.replaceChildren();
  if (!actions || actions.length === 0) {
    host.classList.add('hidden');
    return;
  }
  host.classList.remove('hidden');
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    if (action.primary) btn.className = 'primary';
    const key = ACTION_KEYS[action.label];
    if (key) setLabel(btn, key);
    else btn.textContent = action.label;
    btn.addEventListener('click', () => {
      // Every action restarts or ends the flow; a second click while the first
      // is in flight used to queue a duplicate bootApp().
      host.querySelectorAll('button').forEach((other) => {
        (other as HTMLButtonElement).disabled = true;
      });
      void getIpc()?.action?.(action.id);
    });
    host.appendChild(btn);
  }
  (host.querySelector('button') as HTMLButtonElement | null)?.focus();
}

/** Re-render in the current language (called by the language toggle). */
export function refreshBootScreen(): void {
  if (!lastPayload) return;
  renderPhase();
  if (lastPayload.error) renderActions(lastPayload.actions);
}

/** One run of an error message: ordinary prose, or a command to copy. */
export type ErrorSegment = { kind: 'prose' | 'command'; text: string };

/**
 * Split an error message into prose and command blocks.
 *
 * Main's messages follow one convention: a line indented by two or more
 * spaces (or a tab) is a command the user may want to copy, e.g. the `lsof`
 * hint on a port clash. Those used to be set in body type, in red, and
 * wrapped mid-flag. Pure, so the rule is testable without a DOM.
 */
export function splitErrorDetail(text: string): ErrorSegment[] {
  const segments: ErrorSegment[] = [];
  let prose: string[] = [];
  let command: string[] = [];
  const flushProse = () => {
    const joined = prose.join('\n').replace(/^\n+|\n+$/g, '');
    if (joined) segments.push({ kind: 'prose', text: joined });
    prose = [];
  };
  const flushCommand = () => {
    if (command.length) segments.push({ kind: 'command', text: command.join('\n') });
    command = [];
  };
  for (const line of text.split('\n')) {
    if (/^(?: {2,}|\t)\S/.test(line)) {
      flushProse();
      command.push(line.trim());
    } else {
      flushCommand();
      prose.push(line);
    }
  }
  flushProse();
  flushCommand();
  return segments;
}

/** DOM nodes, never markup: the text can contain paths and command output. */
function renderErrorDetail(el: HTMLElement, text: string): void {
  el.replaceChildren();
  for (const segment of splitErrorDetail(text)) {
    if (segment.kind === 'prose') {
      el.appendChild(document.createTextNode(segment.text));
    } else {
      const block = document.createElement('code');
      block.className = 'boot-code';
      block.textContent = segment.text;
      el.appendChild(block);
    }
  }
}

export function applyBootStatus(data: BootStatusPayload): void {
  lastPayload = data;
  const statusEl = $('boot-status');
  const progressEl = $('boot-progress');

  if (data.error) {
    stopElapsed();
    phase = null;
    if (statusEl) renderErrorDetail(statusEl, data.error);
    const title = $('boot-title');
    if (title) {
      setLabel(title, 'bootFailed');
      title.classList.remove('hidden');
    }
    progressEl?.classList.add('hidden');
    $('boot-hint')?.classList.add('hidden');
    document.body.classList.add('has-error');
    renderActions(data.actions);
    return;
  }

  $('boot-title')?.classList.add('hidden');
  document.body.classList.remove('has-error');
  renderActions(undefined);
  progressEl?.classList.remove('hidden');

  // A free-text message (an npm phase, an SSH host) is already specific;
  // a coarse status is translated here.
  if (data.message) startPhase({ text: data.message });
  else if (data.status) startPhase(STATUS_KEYS[data.status] ? { key: STATUS_KEYS[data.status] } : { text: data.status });

  if (data.done) {
    stopElapsed();
    progressEl?.classList.add('hidden');
  }
}

/** Swap the whole page over to the boot state. */
export function showBootScreen(): void {
  $('mode-selection')?.classList.add('hidden');
  $('remote-screen')?.classList.add('hidden');
  $('boot-screen')?.classList.remove('hidden');
}

export function isBootScreenVisible(): boolean {
  return $('boot-screen')?.classList.contains('hidden') === false;
}

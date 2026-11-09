/**
 * SSH tunnel flow for the connect window.
 *
 * Split out of connect-renderer.ts along with its own state. The dependency
 * runs one way — the screen logic calls in here, this never calls back.
 */
import { t } from './i18n/index';
import {
  $,
  applyI18nToElement,
  failureParts,
  fitWindowToContent,
  getIpc,
  setLabel,
  setStatus,
} from './connect-dom';

// SSH password flow state — when the tunnel is up but the server needs a password
let sshPendingAuth: { sshHost: string; sshRemotePort: number; tunnelUrl: string } | null = null;
// SSH passphrase flow state — when the key itself needs a passphrase
let sshPassphraseNeeded = false;
let sshPassphraseHost = '';
let sshPassphrasePort = 0;
// Connect phase and cancel flag — kept out of btn.onclick to avoid listener conflicts
let sshConnectPhase: 'idle' | 'connecting' = 'idle';
let sshConnectCancelled = false;

/** Switching away from the SSH tab must not leave half-finished auth state behind. */
export function resetSshFlowState(): void {
  sshPendingAuth = null;
  sshPassphraseNeeded = false;
}

export function isSshConnecting(): boolean {
  return sshConnectPhase === 'connecting';
}

// ── SSH Functions ──

export async function loadSshHosts(): Promise<void> {
  const ipc = getIpc();
  if (!ipc) return;

  const datalist = $('ssh-host-list') as HTMLDataListElement;
  const note = $('ssh-note');
  if (!datalist) return;

  try {
    const result = await ipc.getSshHosts();

    if (!result.available) {
      // SSH not available — hide the SSH tab and say why instead of silently
      // dropping the feature.
      $('tab-ssh')?.classList.add('hidden');
      $('tab-http')?.classList.add('active');
      $('ssh-panel')?.classList.add('hidden');
      $('http-panel')?.classList.remove('hidden');
      if (note) {
        note.dataset.i18n = 'sshNoSsh';
        applyI18nToElement(note);
      }
      return;
    }

    // Populate datalist suggestions from ~/.ssh/config (may be empty)
    datalist.replaceChildren();
    for (const host of result.hosts) {
      const opt = document.createElement('option');
      opt.value = host.name;
      opt.label = host.hostname
        ? `${host.name} — ${host.user ? host.user + '@' : ''}${host.hostname}`
        : host.name;
      datalist.appendChild(opt);
    }

    if (note) {
      note.dataset.i18n = 'sshNoConfig';
      applyI18nToElement(note);
    }
  } catch (err) {
    console.error('[MindOS] Failed to load SSH hosts:', err);
  }
}

/** Ask main to tear down the in-flight tunnel, then reset the UI. */
export async function cancelSshConnect(): Promise<void> {
  sshConnectCancelled = true;
  const btn = $('ssh-connect-btn') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  const ipc = getIpc();
  try {
    await ipc?.cancelSsh();
  } catch (err) {
    console.warn('[MindOS] SSH cancel failed:', err);
  }
  sshConnectPhase = 'idle';
  setStatus('ssh-status', null);
  if (btn) {
    btn.disabled = false;
    setLabel(btn, 'sshConnect');
  }
}

export async function handleSshConnect(): Promise<void> {
  const ipc = getIpc();
  if (!ipc) return;

  // Prevent re-entry while connecting (Enter key on inputs can trigger this)
  if (sshConnectPhase === 'connecting') return;

  const hostInput = $('ssh-host-input') as HTMLInputElement;
  const portInput = $('ssh-port') as HTMLInputElement;
  const btn = $('ssh-connect-btn') as HTMLButtonElement;
  const pwSection = $('ssh-password-section');
  const pwInput = $('ssh-password') as HTMLInputElement;
  const ppSection = $('ssh-passphrase-section');
  const ppInput = $('ssh-passphrase') as HTMLInputElement;
  const ppRemember = $('ssh-remember-passphrase') as HTMLInputElement;

  const host = hostInput?.value.trim();
  const port = parseInt(portInput?.value || '3456', 10);
  if (!host) { hostInput?.focus(); return; }

  // ── Passphrase entry mode: user entered passphrase, submit to add key + retry ──
  // Only if host/port still matches what triggered the passphrase prompt
  if (sshPassphraseNeeded && sshPassphraseHost === host && sshPassphrasePort === port) {
    const passphrase = ppInput?.value;
    if (!passphrase) { ppInput?.focus(); return; }

    btn.disabled = true;
    setLabel(btn, 'sshAddingKey');
    setStatus('ssh-status', { cls: 'status-bar info', parts: ['sshAddingKey'] });

    try {
      const result = await ipc.sshAddKey(host, port, passphrase, ppRemember?.checked ?? true);

      if (result.ok) {
        sshPassphraseNeeded = false;
        ppSection?.classList.add('hidden');
        if (ppInput) ppInput.value = '';

        if (result.authRequired && result.url) {
          // Tunnel OK, but MindOS server needs password
          sshPendingAuth = {
            sshHost: result.sshHost || host,
            sshRemotePort: result.sshRemotePort || port,
            tunnelUrl: result.url,
          };
          setStatus('ssh-status', {
            cls: 'status-bar success',
            parts: ['sshSuccess', { text: ' · ' }, 'passwordRequired'],
          });
          pwSection?.classList.remove('hidden');
      fitWindowToContent();
          pwInput?.focus();
          setLabel(btn, 'connect');
          btn.disabled = false;
        } else {
          // Success — window will close
          setStatus('ssh-status', { cls: 'status-bar success', parts: ['sshSuccess'] });
          setLabel(btn, 'connected');
          btn.disabled = true;
        }
      } else {
        setStatus('ssh-status', {
          cls: 'status-bar error',
          parts: failureParts(result, 'sshPassphraseWrong'),
        });
        btn.disabled = false;
        setLabel(btn, 'connect');
        ppInput?.focus();
        ppInput?.select();
      }
    } catch (err) {
      setStatus('ssh-status', {
        cls: 'status-bar error',
        parts: [{ text: `${t('sshFailed')}: ${err instanceof Error ? err.message : String(err)}` }],
      });
      btn.disabled = false;
      setLabel(btn, 'connect');
    }
    return;
  }

  // ── Password entry mode (tunnel established, MindOS server needs password) ──
  if (sshPendingAuth && sshPendingAuth.sshHost === host && sshPendingAuth.sshRemotePort === port) {
    const password = pwInput?.value;
    if (!password) { pwInput?.focus(); return; }

    btn.disabled = true;
    setLabel(btn, 'connecting');
    setStatus('ssh-status', { cls: 'status-bar info', parts: ['connecting'] });

    try {
      const result = await ipc.completeSshWithPassword(
        sshPendingAuth.sshHost,
        sshPendingAuth.sshRemotePort,
        sshPendingAuth.tunnelUrl,
        password
      );

      if (result.ok) {
        setStatus('ssh-status', { cls: 'status-bar success', parts: ['connected'] });
        setLabel(btn, 'connected');
        sshPendingAuth = null;
      } else {
        setStatus('ssh-status', { cls: 'status-bar error', parts: failureParts(result, 'incorrectPassword') });
        btn.disabled = false;
        setLabel(btn, 'connect');
        pwInput?.focus();
      }
    } catch (err) {
      setStatus('ssh-status', {
        cls: 'status-bar error',
        parts: [{ text: `${t('connectionFailed')}: ${err instanceof Error ? err.message : String(err)}` }],
      });
      btn.disabled = false;
      setLabel(btn, 'connect');
    }
    return;
  }

  // ── Clear stale state ──
  if (sshPendingAuth) {
    sshPendingAuth = null;
    pwSection?.classList.add('hidden');
    if (pwInput) pwInput.value = '';
  }
  if (sshPassphraseNeeded) {
    sshPassphraseNeeded = false;
    ppSection?.classList.add('hidden');
    if (ppInput) ppInput.value = '';
  }

  // ── Initial SSH connection — establish tunnel ──
  sshConnectCancelled = false;
  btn.disabled = false;
  setLabel(btn, 'cancel', { busy: true });
  sshConnectPhase = 'connecting';
  setStatus('ssh-status', { cls: 'status-bar info', parts: ['sshConnecting'] });

  try {
    const result = await ipc.connectSsh(host, port);

    // Cancel is handled by cancelSshConnect(), which already reset the UI and
    // told main to tear the tunnel down.
    if (sshConnectCancelled || result.cancelled) {
      sshConnectPhase = 'idle';
      return;
    }

    sshConnectPhase = 'idle';

    if (result.ok) {
      if (result.authRequired && result.url) {
        sshPendingAuth = {
          sshHost: result.sshHost || host,
          sshRemotePort: result.sshRemotePort || port,
          tunnelUrl: result.url,
        };
        setStatus('ssh-status', {
          cls: 'status-bar success',
          parts: ['sshSuccess', { text: ' · ' }, 'passwordRequired'],
        });
        pwSection?.classList.remove('hidden');
      fitWindowToContent();
        pwInput?.focus();
        setLabel(btn, 'connect');
        btn.disabled = false;
      } else {
        setStatus('ssh-status', { cls: 'status-bar success', parts: ['sshSuccess'] });
        setLabel(btn, 'connected');
        btn.disabled = true;
      }
    } else if (result.passphraseNeeded) {
      // SSH key needs passphrase — show passphrase input
      sshPassphraseNeeded = true;
      sshPassphraseHost = host;
      sshPassphrasePort = port;
      setStatus('ssh-status', { cls: 'status-bar info', parts: ['sshPassphraseNeeded'] });
      ppSection?.classList.remove('hidden');
      fitWindowToContent();
      ppInput?.focus();
      setLabel(btn, 'connect');
      btn.disabled = false;
    } else {
      setStatus('ssh-status', {
        cls: 'status-bar error',
        parts: [{ text: `${t('sshFailed')}: ` }, ...failureParts(result, 'errSshFailed')],
      });
      setLabel(btn, 'sshConnect');
      btn.disabled = false;
    }
  } catch (err) {
    sshConnectPhase = 'idle';
    setStatus('ssh-status', {
      cls: 'status-bar error',
      parts: [{ text: `${t('sshFailed')}: ${err instanceof Error ? err.message : String(err)}` }],
    });
    setLabel(btn, 'sshConnect');
    btn.disabled = false;
  }
}

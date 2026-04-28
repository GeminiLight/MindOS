/**
 * Frontend entry point for MindOS Desktop (Tauri)
 *
 * This is a minimal spike that connects to the MindOS runtime at localhost:3456.
 * In Phase 1, we simply redirect to the runtime URL once it's available.
 * In Phase 3, we add deep link support to handle mindos:// URLs.
 */

const RUNTIME_URL = 'http://localhost:3456';
const CHECK_INTERVAL = 1000; // 1 second
const MAX_RETRIES = 30; // 30 seconds total

let retries = 0;

const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');

// Check if we're running in Tauri
const isTauri = '__TAURI__' in window;

interface DeepLinkPayload {
  action: string;
  path?: string;
  query?: string;
}

async function checkRuntime(): Promise<boolean> {
  try {
    // Try /api/health first, fallback to root if not found
    const response = await fetch(`${RUNTIME_URL}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) return true;

    // Fallback: check if root responds
    const rootResponse = await fetch(RUNTIME_URL, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    return rootResponse.ok;
  } catch {
    return false;
  }
}

async function connectToRuntime(targetPath?: string) {
  if (statusEl) {
    statusEl.textContent = `Connecting to runtime... (${retries + 1}/${MAX_RETRIES})`;
  }

  const isHealthy = await checkRuntime();

  if (isHealthy) {
    // Runtime is ready, redirect to it
    const targetUrl = targetPath ? `${RUNTIME_URL}${targetPath}` : RUNTIME_URL;
    window.location.href = targetUrl;
    return;
  }

  retries++;

  if (retries >= MAX_RETRIES) {
    // Timeout
    if (statusEl) {
      statusEl.textContent = 'Failed to connect to runtime';
    }
    if (errorEl) {
      errorEl.style.display = 'block';
      errorEl.innerHTML = `
        <p>Could not connect to MindOS runtime at ${RUNTIME_URL}.</p>
        <p>Please ensure the runtime is running with "mindos start".</p>
        <button onclick="location.reload()" style="margin-top: 10px; padding: 8px 16px; cursor: pointer;">
          Retry
        </button>
      `;
    }
    return;
  }

  // Retry
  setTimeout(() => connectToRuntime(targetPath), CHECK_INTERVAL);
}

async function handleDeepLink(payload: DeepLinkPayload) {
  console.log('[MindOS] Received deep link:', payload);

  // Navigate to the specified path
  if (payload.path) {
    connectToRuntime(payload.path);
  } else {
    connectToRuntime();
  }
}

async function init() {
  // Listen for deep link events (Tauri only)
  if (isTauri) {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      await listen<DeepLinkPayload>('deep-link', (event) => {
        handleDeepLink(event.payload);
      });
      console.log('[MindOS] Deep link listener registered');
    } catch (error) {
      console.error('[MindOS] Failed to register deep link listener:', error);
    }
  }

  // Start connection check
  connectToRuntime();
}

init();

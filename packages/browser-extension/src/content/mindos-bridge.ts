import {
  MINDOS_BRIDGE_READY_TYPE,
  MINDOS_CONTENT_BRIDGE_SOURCE,
  MINDOS_EXTENSION_BRIDGE_SOURCE,
  isMindosPageBridgeRequest,
  type MindosBridgeResponse,
} from '../lib/bridge-protocol';

function postToPage(id: string, response: MindosBridgeResponse) {
  window.postMessage({
    source: MINDOS_EXTENSION_BRIDGE_SOURCE,
    id,
    ...response,
  }, window.location.origin);
}

function postReady() {
  const manifest = chrome.runtime.getManifest();
  window.postMessage({
    source: MINDOS_EXTENSION_BRIDGE_SOURCE,
    id: `ready:${Date.now()}`,
    type: MINDOS_BRIDGE_READY_TYPE,
    ok: true,
    data: {
      installed: true,
      name: manifest.name,
      version: manifest.version,
      transport: 'content-script',
    },
  }, window.location.origin);
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (!isMindosPageBridgeRequest(event.data)) return;

  const request = event.data;
  chrome.runtime.sendMessage({
    source: MINDOS_CONTENT_BRIDGE_SOURCE,
    id: request.id,
    type: request.type,
    payload: request.payload,
  }, (response: MindosBridgeResponse | undefined) => {
    const lastError = chrome.runtime.lastError?.message;
    if (lastError) {
      postToPage(request.id, { ok: false, error: lastError });
      return;
    }

    if (!response || typeof response !== 'object') {
      postToPage(request.id, { ok: false, error: 'MindOS browser bridge returned an invalid response' });
      return;
    }

    postToPage(request.id, {
      ok: response.ok === true,
      ...(response.data !== undefined ? { data: response.data } : {}),
      ...(response.error ? { error: response.error } : {}),
    });
  });
});

postReady();

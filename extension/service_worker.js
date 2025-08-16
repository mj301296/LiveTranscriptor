/* global chrome */

const state = {
  activeCaptureTabId: null,
  connectionStatus: 'idle',
  backendMode: 'stream',
};

// Open side panel on extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
    await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel.html', enabled: true });
  } catch (e) {
    console.warn('Sidepanel open error', e);
  }
});

// Handle messages from sidepanel or other scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'START_CAPTURE') {
      const tabId = msg.tabId || sender?.tab?.id || (await getActiveTabId());
      state.activeCaptureTabId = tabId;
      const ok = await startTabCapture();
      sendResponse({ ok });
    }

    if (msg?.type === 'STOP_CAPTURE') {
      await stopTabCapture();
      sendResponse({ ok: true });
    }

    if (msg?.type === 'GET_STATUS') {
      sendResponse({ state });
    }
  })();

  return true; // Keep the message channel open for async responses
});

// Utility: get currently active tab ID
async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

// Start capturing tab audio
async function startTabCapture() {
  try {
    const stream = await chrome.tabCapture.capture({ audio: true, video: false });
    if (!stream) throw new Error('No stream from tabCapture');

    const port = chrome.runtime.connect({ name: 'AUDIO_PORT' });
    port.postMessage({ type: 'TAB_STREAM_STARTED' });

    await chrome.storage.session.set({ hasActiveStream: true });
    chrome.runtime.sendMessage({ type: 'TAB_CAPTURE_READY' });
    return true;
  } catch (err) {
    console.error('startTabCapture failed', err);
    chrome.runtime.sendMessage({ type: 'ERROR', error: friendlyError(err) });
    return false;
  }
}

// Stop capturing tab audio
async function stopTabCapture() {
  await chrome.storage.session.set({ hasActiveStream: false });
  chrome.runtime.sendMessage({ type: 'CAPTURE_STOPPED' });
}

// Format error messages for user-friendly display
function friendlyError(e) {
  const msg = String(e?.message || e);
  if (msg.includes('denied')) return 'Microphone or tab audio permission denied.';
  return msg;
}

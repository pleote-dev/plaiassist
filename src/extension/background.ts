/**
 * Extension service worker: keeps ONE WebSocket to the avatar MCP server (the
 * one Hermes uses) and relays commands to the active tab's overlay. Reports
 * from the overlay go back to the server so Hermes can read the live state.
 */
declare const chrome: any;

let ws: WebSocket | null = null;
let url = '';
let retry: ReturnType<typeof setTimeout> | null = null;
let connected = false;

async function getUrl(): Promise<string> {
  const { wsUrl } = await chrome.storage.sync.get({ wsUrl: 'ws://localhost:8080' });
  return wsUrl;
}

async function activeTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id ?? null;
}

async function forward(msg: any) {
  if (msg?.action === 'presence') {
    // every tab needs to know whether the desktop app is showing the avatar
    const tabs = await chrome.tabs.query({});
    tabs.forEach((t: any) => t.id && chrome.tabs.sendMessage(t.id, { type: 'mcp', msg }).catch(() => {}));
    return;
  }
  const id = await activeTabId();
  if (id !== null) chrome.tabs.sendMessage(id, { type: 'mcp', msg }).catch(() => {});
}

async function connect() {
  if (retry) clearTimeout(retry);
  retry = null;
  url = await getUrl();
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  try {
    ws = new WebSocket(url);
  } catch {
    schedule();
    return;
  }
  ws.onopen = () => {
    connected = true;
    chrome.action?.setBadgeText({ text: '' });
  };
  ws.onmessage = (e) => {
    try {
      forward(JSON.parse(String(e.data)));
    } catch {
      /* ignore */
    }
  };
  ws.onclose = () => {
    connected = false;
    chrome.action?.setBadgeText({ text: '!' });
    chrome.action?.setBadgeBackgroundColor({ color: '#8a6d2b' });
    schedule();
  };
  ws.onerror = () => ws?.close();
}

function schedule() {
  if (!retry) retry = setTimeout(connect, 4000);
}

chrome.runtime.onMessage.addListener((m: any, _sender: any, sendResponse: (r: any) => void) => {
  if (m?.type === 'report' && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m.payload));
  if (m?.type === 'status') sendResponse({ connected, url });
  if (m?.type === 'reconnect') connect();
});

chrome.storage.onChanged.addListener((changes: any) => {
  if (changes.wsUrl) connect();
});

chrome.alarms?.create('plai-keepalive', { periodInMinutes: 0.5 });
chrome.alarms?.onAlarm.addListener(() => {
  if (!ws || ws.readyState > 1) connect();
});

chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();

const DEFAULTS = { enabled: true, mode: 'follow', avoidText: true, size: 240, hideWhenDesktop: true, disabledHosts: [], wsUrl: 'ws://localhost:8080', idleRoam: false, idleRoamDelay: 60 };
const $ = (id) => document.getElementById(id);
let host = '';

async function load() {
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { host = new URL(tab.url).hostname; } catch { host = ''; }
  $('enabled').checked = cfg.enabled;
  $('here').checked = !cfg.disabledHosts.includes(host);
  $('here').disabled = !host;
  $('mode').value = cfg.mode;
  $('avoidText').checked = cfg.avoidText;
  $('size').value = cfg.size;
  $('hideWhenDesktop').checked = cfg.hideWhenDesktop;
  $('wsUrl').value = cfg.wsUrl;
  $('idleRoam').checked = cfg.idleRoam;
  $('idleRoamDelay').value = cfg.idleRoamDelay;
  $('idleRoamDelayV').textContent = cfg.idleRoamDelay + ' s';
  chrome.runtime.sendMessage({ type: 'status' }, (r) => {
    $('dot').classList.toggle('on', !!(r && r.connected));
    $('status').textContent = r && r.connected ? 'Ligado a ' + r.url : 'Sem ligação ao servidor';
  });
}

$('enabled').onchange = (e) => chrome.storage.sync.set({ enabled: e.target.checked });
$('mode').onchange = (e) => chrome.storage.sync.set({ mode: e.target.value });
$('idleRoam').onchange = (e) => chrome.storage.sync.set({ idleRoam: e.target.checked });
$('idleRoamDelay').oninput = (e) => ($('idleRoamDelayV').textContent = e.target.value + ' s');
$('idleRoamDelay').onchange = (e) => chrome.storage.sync.set({ idleRoamDelay: Number(e.target.value) });
$('avoidText').onchange = (e) => chrome.storage.sync.set({ avoidText: e.target.checked });
$('size').onchange = (e) => chrome.storage.sync.set({ size: Number(e.target.value) });
$('hideWhenDesktop').onchange = (e) => chrome.storage.sync.set({ hideWhenDesktop: e.target.checked });
$('here').onchange = async (e) => {
  const { disabledHosts } = await chrome.storage.sync.get({ disabledHosts: [] });
  const set = new Set(disabledHosts);
  if (e.target.checked) set.delete(host); else set.add(host);
  chrome.storage.sync.set({ disabledHosts: [...set] });
};
$('save').onclick = async () => {
  await chrome.storage.sync.set({ wsUrl: $('wsUrl').value.trim() || DEFAULTS.wsUrl });
  chrome.runtime.sendMessage({ type: 'reconnect' });
  setTimeout(load, 1200);
};
load();

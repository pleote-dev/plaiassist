/**
 * Browser overlay (content script). Injects the avatar in a small transparent
 * iframe on top of the page and runs the companion locomotion engine using the
 * page's DOM as the world: element top edges, horizontal rules, images, inputs
 * and text lines become platforms. She stays near the mouse / text caret,
 * looks at it, and avoids covering the text being read or edited.
 */
import { CompanionEngine, Rect, Surface, CompanionSettings } from '../companion/engine';
import { protectAround } from '../companion/surface-analysis';

declare const chrome: any;

interface Cfg {
  enabled: boolean;
  mode: CompanionSettings['mode'];
  avoidText: boolean;
  size: number;
  hideWhenDesktop: boolean;
  disabledHosts: string[];
}
const DEFAULTS: Cfg = {
  enabled: true,
  mode: 'follow',
  avoidText: true,
  size: 240,
  hideWhenDesktop: true,
  disabledHosts: [],
};

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'BR', 'HEAD', 'META', 'LINK', 'TITLE', 'OPTION']);
const SOLID = new Set([
  'IMG', 'VIDEO', 'CANVAS', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'HR', 'TABLE', 'PRE', 'IFRAME', 'svg',
  'NAV', 'HEADER', 'FOOTER', 'FIGURE', 'BLOCKQUOTE',
]);
const TEXT = new Set([
  'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD', 'TH', 'BLOCKQUOTE', 'DD', 'DT', 'FIGCAPTION', 'LABEL', 'PRE',
  'SUMMARY', 'A', 'SPAN', 'DIV', 'CODE', 'EM', 'STRONG', 'B', 'I', 'SMALL', 'BUTTON',
]);

function hasDirectText(el: Element) {
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3 && (n.textContent || '').trim().length > 1) return true;
  }
  return false;
}
function alpha(color: string) {
  if (!color || color === 'transparent') return 0;
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return 1;
  const p = m[1].split(/[ ,/]+/).filter(Boolean);
  return p.length >= 4 ? parseFloat(p[3]) : 1;
}
function isEditable(el: Element | null): el is HTMLElement {
  if (!el) return false;
  const t = el.tagName;
  if (t === 'TEXTAREA') return true;
  if (t === 'INPUT') return /^(text|search|email|url|tel|password|number)?$/i.test((el as HTMLInputElement).type || '');
  return (el as HTMLElement).isContentEditable;
}

class Overlay {
  private cfg: Cfg = { ...DEFAULTS };
  private iframe: HTMLIFrameElement | null = null;
  private menu: HTMLDivElement | null = null;
  private engine = new CompanionEngine();
  private metrics = { footX: 94, footY: 236, bodyW: 64, bodyH: 196, width: 187, height: 240 };
  private cursor = { x: innerWidth * 0.6, y: innerHeight * 0.5 };
  private caret: Rect | null = null;
  private focusRect: Rect | null = null;
  private surfaces: Surface[] = [];
  private lines: Rect[] = [];
  private fixedIds = new Set<string>();
  private ids = new WeakMap<Element, number>();
  private nextId = 1;
  private dirty = true;
  private lastScan = 0;
  private hover = false;
  private grabbing = false;
  private running = false;
  private lastT = performance.now();
  private lastScroll = { x: scrollX, y: scrollY };
  private desktopPresent = false;
  private lookOverride: { x: number; y: number; until: number } | null = null;
  private lastStateSent = 0;
  private lastOut: ReturnType<CompanionEngine['update']> | null = null;

  async init() {
    this.cfg = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
    chrome.storage.onChanged.addListener(async () => {
      this.cfg = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
      this.applyCfg();
    });
    chrome.runtime.onMessage.addListener((m: any) => this.onBackground(m));
    window.addEventListener('message', (e) => this.onFrameMessage(e));
    addEventListener('mousemove', (e) => this.onMouse(e.clientX, e.clientY), { passive: true, capture: true });
    addEventListener('scroll', () => this.onScroll(), { passive: true, capture: true });
    addEventListener('resize', () => (this.dirty = true));
    document.addEventListener('selectionchange', () => this.updateCaret());
    document.addEventListener('focusin', () => this.updateCaret());
    document.addEventListener('focusout', () => setTimeout(() => this.updateCaret(), 0));
    document.addEventListener('visibilitychange', () => this.applyCfg());
    new MutationObserver(() => (this.dirty = true)).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden'],
    });
    this.applyCfg();
  }

  private get active() {
    return (
      this.cfg.enabled &&
      !this.cfg.disabledHosts.includes(location.hostname) &&
      !(this.cfg.hideWhenDesktop && this.desktopPresent) &&
      !document.hidden
    );
  }

  private applyCfg() {
    this.engine.setSettings({ mode: this.cfg.mode, avoidText: this.cfg.avoidText, enabled: true });
    if (this.active) {
      if (!this.iframe) this.mount();
      else this.resize();
      if (!this.running) {
        this.running = true;
        this.lastT = performance.now();
        requestAnimationFrame(() => this.loop());
      }
    } else {
      this.running = false;
      this.unmount();
    }
  }

  // ------------------------------------------------------------------ iframe
  private mount() {
    const f = document.createElement('iframe');
    f.src = chrome.runtime.getURL('avatar/index.html') + '?mode=web&ws=none';
    f.setAttribute('allowtransparency', 'true');
    f.setAttribute('aria-hidden', 'true');
    f.tabIndex = -1;
    Object.assign(f.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      border: '0',
      margin: '0',
      padding: '0',
      background: 'transparent',
      colorScheme: 'normal',
      zIndex: '2147483646',
      pointerEvents: 'none',
      willChange: 'transform',
      visibility: 'hidden',
    } as Partial<CSSStyleDeclaration>);
    this.iframe = f;
    this.resize();
    (document.body || document.documentElement).appendChild(f);
    this.engine.dropIn(Math.min(innerWidth - 120, this.cursor.x + 200), this.metrics.bodyH + 10);
  }

  private unmount() {
    this.iframe?.remove();
    this.iframe = null;
    this.menu?.remove();
    this.menu = null;
  }

  private resize() {
    if (!this.iframe) return;
    const h = Math.max(160, Math.min(700, this.cfg.size));
    this.iframe.style.width = `${Math.round(h * 0.78)}px`;
    this.iframe.style.height = `${h}px`;
  }

  private post(type: string, data?: any) {
    this.iframe?.contentWindow?.postMessage({ __plai: true, type, data }, '*');
  }

  // ------------------------------------------------------------------ input
  private onMouse(x: number, y: number) {
    this.cursor = { x, y };
  }

  private onScroll() {
    const dx = scrollX - this.lastScroll.x;
    const dy = scrollY - this.lastScroll.y;
    this.lastScroll = { x: scrollX, y: scrollY };
    if (!dx && !dy) return;
    this.dirty = true;
    // move the known world with the page (fixed/sticky boxes stay put)
    this.surfaces = this.surfaces.map((s) =>
      s.kind === 'ground' || this.fixedIds.has(s.id) ? s : { ...s, x0: s.x0 - dx, x1: s.x1 - dx, y: s.y - dy }
    );
    this.lines = this.lines.map((l) => ({ ...l, x: l.x - dx, y: l.y - dy }));
    // ride along with the element she stands on
    const sid = this.engine.getSupportId();
    if (sid && sid !== 'ground' && !this.fixedIds.has(sid)) this.engine.shift(-dx, -dy);
    this.updateCaret();
  }

  private updateCaret() {
    const ae = document.activeElement;
    this.caret = null;
    this.focusRect = null;
    if (!isEditable(ae)) {
      const sel = getSelection();
      if (sel && sel.rangeCount && !sel.isCollapsed) {
        const r = sel.getRangeAt(0).getBoundingClientRect();
        if (r.width > 0) this.caret = { x: r.x, y: r.y, w: r.width, h: r.height };
      }
      return;
    }
    const er = ae.getBoundingClientRect();
    if (er.width * er.height < innerWidth * innerHeight * 0.4) this.focusRect = { x: er.x - 8, y: er.y - 8, w: er.width + 16, h: er.height + 16 };
    if (ae.isContentEditable) {
      const sel = getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        const r = range.getClientRects()[0] || range.getBoundingClientRect();
        if (r && (r.width || r.height)) {
          this.caret = { x: r.x, y: r.y, w: Math.max(2, r.width), h: Math.max(14, r.height) };
          return;
        }
      }
    }
    this.caret = { x: er.x + Math.min(er.width, 40), y: er.y, w: 2, h: Math.min(er.height, 24) };
  }

  // ------------------------------------------------------------------ world
  private idOf(el: Element) {
    let id = this.ids.get(el);
    if (!id) {
      id = this.nextId++;
      this.ids.set(el, id);
    }
    return id;
  }

  private scan() {
    const now = performance.now();
    if (!this.dirty && now - this.lastScan < 2000) return;
    if (now - this.lastScan < 250) return;
    this.lastScan = now;
    this.dirty = false;
    const vw = innerWidth;
    const vh = innerHeight;
    const minW = this.metrics.bodyW * 0.5;
    const minY = this.metrics.bodyH * 0.85;
    const out: Surface[] = [{ id: 'ground', x0: 0, x1: vw, y: vh, kind: 'ground' }];
    const lines: Rect[] = [];
    this.fixedIds.clear();
    const all = document.body ? document.body.getElementsByTagName('*') : ([] as any);
    const textEls: Element[] = [];
    let styled = 0;
    for (let i = 0; i < all.length && i < 8000; i++) {
      const el = all[i] as Element;
      if (el === this.iframe || el === this.menu || SKIP.has(el.tagName)) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw || r.width < 4 || r.height < 4) continue;
      const tag = el.tagName;
      if (TEXT.has(tag) && textEls.length < 400 && hasDirectText(el)) textEls.push(el);
      if (r.width < minW || r.top < minY || r.top > vh - 4) continue;
      let solid = SOLID.has(tag);
      let st: CSSStyleDeclaration | null = null;
      if (styled < 900) {
        st = getComputedStyle(el);
        styled++;
        if (st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) < 0.1) continue;
        if (!solid)
          solid =
            (parseFloat(st.borderTopWidth) > 0 && st.borderTopStyle !== 'none' && alpha(st.borderTopColor) > 0.2) ||
            alpha(st.backgroundColor) > 0.3 ||
            st.boxShadow !== 'none' ||
            st.backgroundImage !== 'none';
      }
      if (!solid) continue;
      // ignore boxes that start at the very top-left and fill the viewport (page wrappers)
      if (r.width > vw * 0.95 && r.height > vh * 0.9) continue;
      const id = `el${this.idOf(el)}`;
      out.push({ id, x0: Math.max(0, r.left), x1: Math.min(vw, r.right), y: Math.round(r.top), kind: 'element' });
      if (st && (st.position === 'fixed' || st.position === 'sticky')) this.fixedIds.add(id);
    }

    const range = document.createRange();
    for (const el of textEls) {
      range.selectNodeContents(el);
      const rects = range.getClientRects();
      const ls: Rect[] = [];
      for (let k = 0; k < rects.length && k < 400; k++) {
        const r = rects[k];
        if (r.width < 2 || r.height < 6 || r.bottom < 0 || r.top > vh) continue;
        const l = ls.find((q) => Math.abs(q.y - r.top) < Math.max(4, q.h * 0.5));
        if (l) {
          const x1 = Math.max(l.x + l.w, r.right);
          l.x = Math.min(l.x, r.left);
          l.w = x1 - l.x;
          l.h = Math.max(l.h, r.height);
        } else ls.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      }
      const eid = this.idOf(el);
      ls.forEach((l, k) => {
        if (lines.some((q) => Math.abs(q.y - l.y) < 3 && Math.abs(q.x - l.x) < 3)) return;
        lines.push(l);
        if (l.w >= this.metrics.bodyW && l.y >= minY && l.y <= vh - 4)
          out.push({ id: `tx${eid}_${k}`, x0: l.x, x1: l.x + l.w, y: Math.round(l.y - 1), kind: 'text' });
      });
    }
    if (out.length > 260) out.length = 260;
    this.surfaces = out;
    this.lines = lines;
    this.post('page', { url: location.href, title: document.title, surfaces: out.length, textLines: lines.length });
  }

  private protectRects(): Rect[] {
    const P: Rect[] = [];
    if (this.focusRect) P.push(this.focusRect);
    if (this.caret) P.push(...protectAround(this.lines, { x: this.caret.x, y: this.caret.y + this.caret.h / 2 }, 300, 60));
    const c = this.cursor;
    const overText = this.lines.some((l) => c.x >= l.x - 4 && c.x <= l.x + l.w + 4 && c.y >= l.y - 4 && c.y <= l.y + l.h + 4);
    if (overText) P.push(...protectAround(this.lines, c, 240, 50));
    else P.push({ x: c.x - 70, y: c.y - 40, w: 140, h: 80 });
    return P;
  }

  // ------------------------------------------------------------------ loop
  private loop() {
    if (!this.running || !this.iframe) return;
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    this.scan();

    const out = this.engine.update({
      dt,
      cursor: this.cursor,
      caret: this.caret,
      surfaces: this.surfaces,
      bounds: { x: 0, y: 0, w: innerWidth, h: innerHeight },
      protect: this.protectRects(),
      avoid: this.lines,
    });
    this.lastOut = out;

    if (this.lookOverride) {
      if (now > this.lookOverride.until) this.lookOverride = null;
      else {
        out.lookX = Math.max(-1, Math.min(1, (this.lookOverride.x - out.x) / 500));
        out.lookY = Math.max(-1, Math.min(1, (out.y - this.metrics.bodyH * 0.86 - this.lookOverride.y) / 350));
      }
    }

    const x = Math.round(out.x - this.metrics.footX);
    const y = Math.round(out.y - this.metrics.footY);
    this.iframe.style.transform = `translate(${x}px, ${y}px)`;
    this.iframe.style.visibility = 'visible';

    const b = out.body;
    const c = this.cursor;
    this.hover = c.x > b.x + b.w * 0.1 && c.x < b.x + b.w * 0.9 && c.y > b.y && c.y < b.y + b.h;
    this.iframe.style.pointerEvents = this.hover && !this.grabbing ? 'auto' : 'none';

    if (now - this.lastStateSent > 33) {
      this.lastStateSent = now;
      this.post('state', {
        ...out,
        hover: this.hover,
        bodyH: this.metrics.bodyH,
        cursor: this.cursor,
        surfaces: this.surfaces.length,
        screen: { x: 0, y: 0, w: innerWidth, h: innerHeight },
      });
    }
  }

  // ------------------------------------------------------------------ messages
  private onFrameMessage(e: MessageEvent) {
    if (!this.iframe || e.source !== this.iframe.contentWindow || !e.data?.__plai) return;
    const { type, data } = e.data;
    const fr = this.iframe.getBoundingClientRect();
    switch (type) {
      case 'metrics':
        this.metrics = data;
        this.engine.setMetrics(data.bodyW, data.bodyH);
        this.dirty = true;
        break;
      case 'pointer':
        this.cursor = { x: fr.left + data.x, y: fr.top + data.y };
        break;
      case 'grab': {
        this.cursor = { x: fr.left + (data?.x ?? fr.width / 2), y: fr.top + (data?.y ?? fr.height / 2) };
        this.engine.grab(this.cursor.x, this.cursor.y);
        this.grabbing = true;
        const move = (ev: MouseEvent) => (this.cursor = { x: ev.clientX, y: ev.clientY });
        const up = () => {
          this.grabbing = false;
          this.engine.release();
          removeEventListener('mousemove', move, true);
          removeEventListener('mouseup', up, true);
        };
        addEventListener('mousemove', move, true);
        addEventListener('mouseup', up, true);
        break;
      }
      case 'release':
        if (this.grabbing) {
          this.grabbing = false;
          this.engine.release();
        }
        break;
      case 'menu':
        this.showMenu();
        break;
      case 'command':
        this.command(data);
        break;
      case 'report':
        try {
          chrome.runtime.sendMessage({ type: 'report', payload: data });
        } catch {
          /* extension reloaded */
        }
        break;
    }
  }

  private onBackground(m: any) {
    if (!m) return;
    if (m.type === 'mcp') {
      const msg = m.msg;
      if (msg?.action === 'presence') {
        this.desktopPresent = !!msg.data?.desktop;
        this.applyCfg();
        return;
      }
      if (msg?.action === 'companion') this.command(msg.data);
      else this.post('mcp', msg);
    }
  }

  private toViewport(x: number, y: number) {
    // screen px → viewport px (approximate browser chrome offsets)
    return {
      x: x - screenX - (outerWidth - innerWidth) / 2,
      y: y - screenY - (outerHeight - innerHeight),
    };
  }

  private command(c: any) {
    if (!c) return;
    const vw = innerWidth;
    const vh = innerHeight;
    switch (c.cmd) {
      case 'settings': {
        const patch: Partial<Cfg> = {};
        if (c.mode) patch.mode = c.mode;
        if (c.avoidText !== undefined) patch.avoidText = !!c.avoidText;
        if (c.enabled !== undefined) patch.mode = c.enabled ? this.cfg.mode === 'stay' ? 'follow' : this.cfg.mode : 'stay';
        if (c.height) patch.size = Number(c.height);
        const eng: Partial<CompanionSettings> = {};
        ['followDistance', 'walkSpeed', 'runSpeed'].forEach((k) => c[k] !== undefined && ((eng as any)[k] = Number(c[k])));
        this.engine.setSettings(eng);
        chrome.storage.sync.set(patch);
        break;
      }
      case 'walk_to': {
        let x = Number(c.x);
        let y = Number(c.y);
        const t = c.target;
        if (t === 'cursor') ({ x, y } = this.cursor);
        if (t === 'left') [x, y] = [100, vh];
        if (t === 'right') [x, y] = [vw - 100, vh];
        if (t === 'center') [x, y] = [vw / 2, vh / 2];
        if (t === 'top') [x, y] = [this.cursor.x, this.metrics.bodyH];
        if (t === 'bottom') [x, y] = [this.cursor.x, vh];
        if (Number.isFinite(x) && Number.isFinite(y)) this.engine.walkTo(x, y, c.holdSeconds ?? 25);
        break;
      }
      case 'jump':
        this.engine.jump(c.direction || 'up');
        break;
      case 'drop_in':
        this.engine.dropIn(Number(c.x ?? this.cursor.x), Number(c.y ?? this.metrics.bodyH));
        break;
      case 'look_at': {
        const p = c.screenX !== undefined ? this.toViewport(Number(c.screenX), Number(c.screenY)) : { x: Number(c.x), y: Number(c.y) };
        this.lookOverride = { ...p, until: performance.now() + Number(c.durationMs ?? 4000) };
        break;
      }
      case 'point': {
        const p = this.toViewport(Number(c.x), Number(c.y));
        const o = this.engine.getPosition();
        this.lookOverride = { ...p, until: performance.now() + 4000 };
        this.post('point', {
          nx: Math.max(-1, Math.min(1, (p.x - o.x) / 500)),
          ny: Math.max(-1, Math.min(1, (o.y - this.metrics.bodyH * 0.8 - p.y) / 500)),
        });
        break;
      }
      case 'hide':
        chrome.storage.sync.set({ enabled: false });
        break;
      case 'show':
        chrome.storage.sync.set({ enabled: true });
        break;
      case 'size':
        chrome.storage.sync.set({ size: Number(c.height) });
        break;
    }
  }

  private showMenu() {
    this.menu?.remove();
    const host = document.createElement('div');
    const sh = host.attachShadow({ mode: 'closed' });
    const b = this.lastOut?.body ?? { x: this.cursor.x, y: this.cursor.y, w: 0, h: 0 };
    Object.assign(host.style, {
      position: 'fixed',
      zIndex: '2147483647',
      left: `${Math.max(4, Math.min(innerWidth - 210, b.x + b.w))}px`,
      top: `${Math.max(4, Math.min(innerHeight - 260, b.y + b.h * 0.3))}px`,
    });
    const item = (label: string, fn: () => void, on = false) =>
      `<button data-k="${label}" class="${on ? 'on' : ''}">${on ? '● ' : ''}${label}</button>`;
    const m = this.cfg.mode;
    const actions: Record<string, () => void> = {
      'Seguir o cursor': () => chrome.storage.sync.set({ mode: 'follow' }),
      'Passear pela página': () => chrome.storage.sync.set({ mode: 'roam' }),
      'Ficar aqui': () => chrome.storage.sync.set({ mode: 'stay' }),
      Saltar: () => this.engine.jump('up'),
      'Esconder nesta página': () =>
        chrome.storage.sync.set({ disabledHosts: [...new Set([...this.cfg.disabledHosts, location.hostname])] }),
      'Esconder em todo o lado': () => chrome.storage.sync.set({ enabled: false }),
    };
    sh.innerHTML = `<style>
      div{font:12.5px -apple-system,system-ui,sans-serif;background:rgba(12,12,16,.96);border:1px solid rgba(233,196,106,.7);
        border-radius:12px;padding:6px;display:flex;flex-direction:column;min-width:190px;box-shadow:0 8px 24px rgba(0,0,0,.4)}
      button{all:unset;color:#fff3d6;padding:6px 10px;border-radius:8px;cursor:pointer}
      button:hover{background:rgba(233,196,106,.18)} .on{color:#f2cf7a}
      hr{border:0;border-top:1px solid rgba(233,196,106,.25);margin:4px 2px}</style>
      <div>${item('Seguir o cursor', () => {}, m === 'follow')}${item('Passear pela página', () => {}, m === 'roam')}${item(
        'Ficar aqui',
        () => {},
        m === 'stay'
      )}<hr>${item('Saltar', () => {})}${item('Esconder nesta página', () => {})}${item('Esconder em todo o lado', () => {})}</div>`;
    sh.querySelectorAll('button').forEach((btn) =>
      btn.addEventListener('click', () => {
        actions[(btn as HTMLElement).dataset.k!]?.();
        host.remove();
      })
    );
    const close = (e: MouseEvent) => {
      if (!e.composedPath().includes(host)) {
        host.remove();
        removeEventListener('mousedown', close, true);
      }
    };
    setTimeout(() => addEventListener('mousedown', close, true), 0);
    document.documentElement.appendChild(host);
    this.menu = host;
  }
}

if (window.top === window && !(window as any).__plaiOverlay) {
  (window as any).__plaiOverlay = true;
  new Overlay().init();
}

import { BrowserWindow, Menu, desktopCapturer, screen, systemPreferences, shell } from 'electron';
import { CompanionEngine, CompanionSettings, Rect, Surface } from './engine';
import { analyzeScreen, protectAround, textSurfaces } from './surface-analysis';

export interface DesktopCompanionOptions {
  captureIntervalMs: number;
  settings: Partial<CompanionSettings>;
  onSettingsChanged: (s: CompanionSettings & { captureIntervalMs: number; height: number }) => void;
  onOpenConfig: () => void;
  onQuit: () => void;
  onHide: () => void;
}

interface Metrics {
  footX: number;
  footY: number;
  bodyW: number;
  bodyH: number;
  width: number;
  height: number;
}

/**
 * Drives the transparent desktop avatar window: polls the cursor, scans the
 * screen for walkable lines / text, runs the locomotion engine at 60 Hz and
 * moves the window so her feet land on the chosen surface.
 */
export class DesktopCompanion {
  readonly engine: CompanionEngine;
  private metrics: Metrics = { footX: 140, footY: 350, bodyW: 95, bodyH: 290, width: 280, height: 360 };
  private edges: Surface[] = [];
  private textLines: Rect[] = [];
  private scanBusy = false;
  private scanTimer: NodeJS.Timeout | null = null;
  private loopTimer: NodeJS.Timeout | null = null;
  private lastTick = Date.now();
  private lastSend = 0;
  private ignoring = true;
  private lastWinPos = { x: -99999, y: -99999 };
  private displayId: number;
  private switchSince = 0;
  private captureState: 'granted' | 'denied' | 'unknown' = 'unknown';
  private warnedPermission = false;
  private lookOverride: { x: number; y: number; until: number } | null = null;
  private lastOut: ReturnType<CompanionEngine['update']> | null = null;
  private captureIntervalMs: number;

  constructor(private win: BrowserWindow, private opts: DesktopCompanionOptions) {
    this.engine = new CompanionEngine(opts.settings);
    this.captureIntervalMs = opts.captureIntervalMs;
    const c = screen.getCursorScreenPoint();
    const d = screen.getDisplayNearestPoint(c);
    this.displayId = d.id;
    this.engine.dropIn(Math.max(d.workArea.x + 150, c.x - 250), d.workArea.y + this.metrics.bodyH + 10);
  }

  start() {
    this.stop();
    this.lastTick = Date.now();
    this.loopTimer = setInterval(() => this.tick(), 16);
    this.scanTimer = setInterval(() => this.scan(), this.captureIntervalMs);
    this.scan();
  }

  stop() {
    if (this.loopTimer) clearInterval(this.loopTimer);
    if (this.scanTimer) clearInterval(this.scanTimer);
    this.loopTimer = this.scanTimer = null;
  }

  setMetrics(m: Metrics) {
    this.metrics = m;
    this.engine.setMetrics(m.bodyW, m.bodyH);
  }

  grab() {
    const c = screen.getCursorScreenPoint();
    this.engine.grab(c.x, c.y);
  }

  release() {
    this.engine.release();
  }

  private display() {
    return screen.getAllDisplays().find((d) => d.id === this.displayId) ?? screen.getPrimaryDisplay();
  }

  private sendHost(type: string, data: any) {
    if (!this.win.isDestroyed()) this.win.webContents.send('companion-host-message', { type, data });
  }

  // ------------------------------------------------------------------ commands
  command(c: any) {
    if (!c || typeof c !== 'object') return;
    const wa = this.display().workArea;
    switch (c.cmd) {
      case 'settings': {
        const { captureIntervalMs, height, ...rest } = c;
        delete rest.cmd;
        this.engine.setSettings(rest);
        if (captureIntervalMs) {
          this.captureIntervalMs = Math.max(500, Number(captureIntervalMs));
          this.start();
        }
        if (height) this.resize(Number(height));
        this.persist();
        break;
      }
      case 'walk_to': {
        let x = Number(c.x);
        let y = Number(c.y);
        const cur = screen.getCursorScreenPoint();
        switch (c.target) {
          case 'cursor':
            x = cur.x;
            y = cur.y;
            break;
          case 'left':
            x = wa.x + 120;
            y = wa.y + wa.height;
            break;
          case 'right':
            x = wa.x + wa.width - 120;
            y = wa.y + wa.height;
            break;
          case 'center':
            x = wa.x + wa.width / 2;
            y = wa.y + wa.height / 2;
            break;
          case 'top':
            x = cur.x;
            y = wa.y + this.metrics.bodyH;
            break;
          case 'bottom':
            x = cur.x;
            y = wa.y + wa.height;
            break;
        }
        if (Number.isFinite(x) && Number.isFinite(y)) this.engine.walkTo(x, y, c.holdSeconds ?? 25);
        break;
      }
      case 'jump':
        this.engine.jump(c.direction || 'up');
        break;
      case 'drop_in': {
        const cur = screen.getCursorScreenPoint();
        this.engine.dropIn(Number(c.x ?? cur.x), Number(c.y ?? wa.y + this.metrics.bodyH));
        break;
      }
      case 'look_at':
        this.lookOverride = {
          x: Number(c.screenX ?? c.x),
          y: Number(c.screenY ?? c.y),
          until: Date.now() + Number(c.durationMs ?? 4000),
        };
        break;
      case 'point': {
        const p = this.engine.getPosition();
        const hx = p.x;
        const hy = p.y - this.metrics.bodyH * 0.8;
        const nx = Math.max(-1, Math.min(1, (Number(c.x) - hx) / 500));
        const ny = Math.max(-1, Math.min(1, (hy - Number(c.y)) / 500));
        this.lookOverride = { x: Number(c.x), y: Number(c.y), until: Date.now() + 4000 };
        this.sendHost('point', { nx, ny });
        break;
      }
      case 'show':
        this.win.showInactive();
        break;
      case 'hide':
        this.opts.onHide();
        break;
      case 'size':
        this.resize(Number(c.height));
        this.persist();
        break;
    }
  }

  private resize(height: number) {
    if (!Number.isFinite(height)) return;
    const h = Math.max(180, Math.min(900, Math.round(height)));
    const w = Math.round(h * 0.78);
    const b = this.win.getBounds();
    this.win.setBounds({ x: b.x, y: b.y, width: w, height: h });
  }

  private persist() {
    const b = this.win.getBounds();
    this.opts.onSettingsChanged({ ...this.engine.settings, captureIntervalMs: this.captureIntervalMs, height: b.height });
  }

  menu() {
    const s = this.engine.settings;
    const setMode = (mode: CompanionSettings['mode']) => {
      this.engine.setSettings({ mode, enabled: true });
      this.persist();
    };
    const m = Menu.buildFromTemplate([
      { label: 'Seguir o cursor', type: 'radio', checked: s.enabled && s.mode === 'follow', click: () => setMode('follow') },
      { label: 'Passear pelo ecrã', type: 'radio', checked: s.enabled && s.mode === 'roam', click: () => setMode('roam') },
      { label: 'Ficar aqui', type: 'radio', checked: !s.enabled || s.mode === 'stay', click: () => setMode('stay') },
      { type: 'separator' },
      {
        label: 'Evitar tapar texto',
        type: 'checkbox',
        checked: s.avoidText,
        click: (i) => {
          this.engine.setSettings({ avoidText: i.checked });
          this.persist();
        },
      },
      {
        label: 'Tamanho',
        submenu: [240, 300, 360, 440, 520].map((h) => ({
          label: `${h}px`,
          type: 'radio' as const,
          checked: Math.abs(this.win.getBounds().height - h) < 10,
          click: () => {
            this.resize(h);
            this.persist();
          },
        })),
      },
      { label: 'Saltar', click: () => this.engine.jump('up') },
      { label: 'Vir ao cursor', click: () => this.command({ cmd: 'walk_to', target: 'cursor' }) },
      { type: 'separator' },
      ...(this.captureState !== 'granted' && process.platform === 'darwin'
        ? [
            {
              label: 'Permitir ver janelas (Gravação de ecrã)…',
              click: () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'),
            },
          ]
        : []),
      { label: 'Configurações…', click: () => this.opts.onOpenConfig() },
      { label: 'Esconder', click: () => this.opts.onHide() },
      { label: 'Sair', click: () => this.opts.onQuit() },
    ]);
    m.popup({ window: this.win });
  }

  // ------------------------------------------------------------------ screen scan
  private async scan() {
    if (this.scanBusy || this.win.isDestroyed() || !this.win.isVisible()) return;
    this.scanBusy = true;
    try {
      if (process.platform === 'darwin') {
        const st = systemPreferences.getMediaAccessStatus('screen');
        this.captureState = st === 'granted' ? 'granted' : st === 'not-determined' ? 'unknown' : 'denied';
        if (st !== 'granted') {
          if (!this.warnedPermission) {
            this.warnedPermission = true;
            // first call registers the app in System Settings › Privacy › Screen Recording
            await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 16, height: 16 } }).catch(() => {});
            this.sendHost('say', {
              text: 'Para eu poder andar por cima das janelas e do texto, dá-me permissão de Gravação de ecrã nas Definições. Entretanto fico pelo fundo do ecrã!',
              durationMs: 7000,
            });
          }
          this.edges = [];
          this.textLines = [];
          return;
        }
      } else this.captureState = 'granted';

      const d = this.display();
      const k = 0.5;
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: Math.round(d.size.width * k), height: Math.round(d.size.height * k) },
      });
      const src = sources.find((s) => s.display_id === String(d.id)) ?? (sources.length === 1 ? sources[0] : null);
      if (!src) return;
      const img = src.thumbnail;
      const size = img.getSize();
      if (!size.width || !size.height) return;
      const bmp = img.toBitmap();
      const body = this.lastOut?.body;
      const res = analyzeScreen(new Uint8Array(bmp.buffer, bmp.byteOffset, bmp.byteLength), size.width, size.height, {
        scaleX: size.width / d.bounds.width,
        scaleY: size.height / d.bounds.height,
        offsetX: d.bounds.x,
        offsetY: d.bounds.y,
        minEdgePx: Math.max(60, this.metrics.bodyW * 0.8),
        // macOS/Windows exclude our window from captures (content protection); Linux needs masking
        exclude:
          body && process.platform === 'linux' ? [{ x: body.x - 6, y: body.y - 30, w: body.w + 12, h: body.h + 5 }] : [],
      });
      if (body && process.platform === 'linux') {
        // keep previously known edges hidden behind her body (she may be about to land on them)
        const ex = { x: body.x - 6, y: body.y - 30, w: body.w + 12, h: body.h + 5 };
        for (const e of this.edges) {
          const hidden = e.y >= ex.y && e.y <= ex.y + ex.h && e.x1 > ex.x && e.x0 < ex.x + ex.w;
          if (hidden && !res.edges.some((n) => Math.abs(n.y - e.y) < 5 && n.x1 > e.x0 && n.x0 < e.x1)) res.edges.push(e);
        }
      }
      this.edges = res.edges;
      this.textLines = res.textLines;
    } catch (err) {
      console.error('Screen scan failed:', err);
    } finally {
      this.scanBusy = false;
    }
  }

  // ------------------------------------------------------------------ loop
  private tick() {
    if (this.win.isDestroyed()) return this.stop();
    const now = Date.now();
    const dt = Math.min(0.05, (now - this.lastTick) / 1000);
    this.lastTick = now;

    const cursor = screen.getCursorScreenPoint();
    const cd = screen.getDisplayNearestPoint(cursor);
    if (cd.id !== this.displayId) {
      if (!this.switchSince) this.switchSince = now;
      else if (now - this.switchSince > 1500 && !this.engine.isGrabbed()) {
        this.displayId = cd.id;
        this.switchSince = 0;
        this.edges = [];
        this.textLines = [];
        this.engine.dropIn(cursor.x, cd.workArea.y + this.metrics.bodyH + 5);
        this.scan();
      }
    } else this.switchSince = 0;

    const d = this.display();
    const wa = d.workArea;
    const minY = wa.y + this.metrics.bodyH * 0.85;
    const maxY = wa.y + wa.height - 6;
    const inX = (s: Surface) => s.x1 > wa.x && s.x0 < wa.x + wa.width;
    const surfaces: Surface[] = [
      { id: 'ground', x0: wa.x, x1: wa.x + wa.width, y: wa.y + wa.height, kind: 'ground' },
      ...this.edges.filter((s) => s.y >= minY && s.y <= maxY && inX(s)),
      ...textSurfaces(this.textLines, this.metrics.bodyW * 1.2).filter((s) => s.y >= minY && s.y <= maxY && inX(s)),
    ];
    const protect =
      this.captureState === 'granted'
        ? protectAround(this.textLines, cursor)
        : [{ x: cursor.x - 160, y: cursor.y - 50, w: 320, h: 100 }];

    const out = this.engine.update({
      dt,
      cursor,
      surfaces,
      bounds: { x: wa.x, y: wa.y, w: wa.width, h: wa.height },
      protect,
      avoid: this.textLines,
    });
    this.lastOut = out;

    // look override (Hermes "look_at" / "point")
    if (this.lookOverride) {
      if (now > this.lookOverride.until) this.lookOverride = null;
      else {
        const hy = out.y - this.metrics.bodyH * 0.86;
        out.lookX = Math.max(-1, Math.min(1, (this.lookOverride.x - out.x) / 500));
        out.lookY = Math.max(-1, Math.min(1, (hy - this.lookOverride.y) / 350));
      }
    }

    const wx = Math.round(out.x - this.metrics.footX);
    const wy = Math.round(out.y - this.metrics.footY);
    const ix = wx | 0;
    const iy = wy | 0;
    if (
      Number.isFinite(wx) &&
      Number.isFinite(wy) &&
      (ix !== this.lastWinPos.x || iy !== this.lastWinPos.y)
    ) {
      try {
        this.win.setPosition(ix, iy);
        this.lastWinPos = { x: ix, y: iy };
      } catch (err) {
        console.error('setPosition failed:', { ix, iy, wx, wy }, err);
      }
    }

    // click-through everywhere except over her body
    const b = out.body;
    const hover =
      cursor.x > b.x + b.w * 0.1 && cursor.x < b.x + b.w * 0.9 && cursor.y > b.y && cursor.y < b.y + b.h;
    const ignore = !(hover || this.engine.isGrabbed());
    if (ignore !== this.ignoring) {
      this.win.setIgnoreMouseEvents(ignore, { forward: true });
      this.ignoring = ignore;
    }

    if (now - this.lastSend >= 33) {
      this.lastSend = now;
      this.win.webContents.send('companion-state', {
        ...out,
        hover,
        bodyH: this.metrics.bodyH,
        cursor,
        surfaces: surfaces.length,
        screenCapture: this.captureState,
        screen: { x: wa.x, y: wa.y, w: wa.width, h: wa.height, displayId: d.id },
      });
    }
  }
}

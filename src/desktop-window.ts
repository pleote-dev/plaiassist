import { app, BrowserWindow, ipcMain, dialog, screen, globalShortcut, session } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn, ChildProcess } from 'child_process';
import WebSocket from 'ws';
import TrayManager from './tray-manager';
import { DesktopCompanion } from './companion/desktop-controller';
import type { CompanionSettings } from './companion/engine';

/**
 * Runtime configuration: ~/.plaiassist/config.json (created on first run).
 *   wsUrl            WebSocket of the MCP server Hermes uses, e.g. "ws://192.168.1.50:8080".
 *                    Empty = the local server spawned by this app (ws://localhost:8080).
 *   startLocalServer Spawn a local MCP/WS server alongside the app (default true).
 *   companion        Locomotion settings (mode follow|roam|stay, avoidText, height, …).
 * Env overrides: AVATAR_WS_URL, AVATAR_COMPANION=0 (classic static window).
 */
interface RuntimeConfig {
  wsUrl: string;
  startLocalServer: boolean;
  appearance?: Record<string, any>;
  behavior?: Record<string, any>;
  voice?: Record<string, any>;
  advanced?: { port?: number; logLevel?: string; debugMode?: boolean };
  companion: Partial<CompanionSettings> & { height: number; captureIntervalMs: number };
}

const DEFAULT_BEHAVIOR = {
  position: { x: 100, y: 100 },
  alwaysOnTop: true,
  clickThrough: true,
  autoHide: false,
  animSpeed: 1.0,
  floatingAnim: true,
  idleRotation: true,
  idleRoam: false,
  idleRoamDelay: 60,
};
const DEFAULT_VOICE = { engine: 'system', rate: 1.0, volume: 100, enabled: true, inputEnabled: false };
const DEFAULT_ADVANCED = { port: 8080, logLevel: 'info', debugMode: false };
const LISTEN_SHORTCUT = 'CommandOrControl+Shift+Space';

const CONFIG_DIR = path.join(os.homedir(), '.plaiassist');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const DEFAULT_RUNTIME: RuntimeConfig = {
  wsUrl: '',
  startLocalServer: true,
  companion: {
    enabled: true,
    mode: 'follow',
    avoidText: true,
    followDistance: 0.75,
    height: 340,
    captureIntervalMs: 1500,
  },
};

function loadRuntimeConfig(): RuntimeConfig {
  let cfg: RuntimeConfig = JSON.parse(JSON.stringify(DEFAULT_RUNTIME));
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      cfg = { ...cfg, ...raw, companion: { ...cfg.companion, ...(raw.companion || {}) } };
    } else {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
    }
  } catch (err) {
    console.error('Could not read', CONFIG_FILE, err);
  }
  if (process.env.AVATAR_WS_URL) cfg.wsUrl = process.env.AVATAR_WS_URL;
  if (process.env.AVATAR_COMPANION === '0') cfg.companion.enabled = false;
  return cfg;
}

/** "192.168.1.50" → "ws://192.168.1.50:8080"; "https://ha.example/x" → "wss://ha.example/x"; '' stays ''. */
export function normalizeWsUrl(input: string): string {
  let u = String(input || '').trim();
  if (!u) return '';
  u = u.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  if (!/^wss?:\/\//i.test(u)) u = 'ws://' + u;
  try {
    const url = new URL(u);
    if (!url.port && url.protocol === 'ws:' && (url.pathname === '/' || url.pathname === '')) url.port = '8080';
    let out = url.toString();
    if (url.pathname === '/' && !url.search) out = out.replace(/\/$/, '');
    return out;
  } catch {
    return u;
  }
}

function saveRuntimeConfig(cfg: RuntimeConfig) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  } catch (err) {
    console.error('Could not save', CONFIG_FILE, err);
  }
}

export class DesktopWindow {
  private mainWindow: BrowserWindow | null = null;
  private mcpServer: ChildProcess | null = null;
  private trayManager: TrayManager | null = null;
  private companion: DesktopCompanion | null = null;
  private runtime: RuntimeConfig = loadRuntimeConfig();
  private quitting = false;
  private config: any = {
    appearance: {
      hairColor: '#C9A15A',
      eyeColor: '#7A4A1C',
      skinTone: '#F7DCC0',
      pose: 'idle',
      outfit: 'noir-gold',
      size: 150,
    },
    behavior: {
      position: { x: 100, y: 100 },
      alwaysOnTop: true,
      clickThrough: true,
      autoHide: false,
      animSpeed: 1.0,
      floatingAnim: true,
      idleRotation: true,
    },
    voice: { engine: 'system', rate: 1.0, volume: 100, enabled: true, inputEnabled: false },
  };

  constructor() {
    this.config.appearance = { ...this.config.appearance, ...(this.runtime.appearance || {}) };
    this.config.behavior = { ...DEFAULT_BEHAVIOR, ...(this.runtime.behavior || {}) };
    this.config.voice = { ...DEFAULT_VOICE, ...(this.runtime.voice || {}) };
    this.config.advanced = { ...DEFAULT_ADVANCED, ...(this.runtime.advanced || {}) };
    this.initializeApp();
  }

  private get port() {
    return Number(this.config.advanced?.port) || 8080;
  }

  private get wsUrl() {
    return this.runtime.wsUrl || (this.runtime.startLocalServer ? `ws://localhost:${this.port}` : '');
  }

  /** Sends behaviour + voice settings to the avatar renderer. */
  private pushRendererSettings() {
    const wc = this.mainWindow?.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.send('mcp-message', { action: 'behavior', data: this.config.behavior });
    wc.send('mcp-message', { action: 'voice', data: this.config.voice });
  }

  private statusInfo() {
    const remote = !!this.runtime.wsUrl;
    return {
      running: this.mcpServer !== null,
      status: this.mcpServer ? 'running' : this.runtime.startLocalServer ? 'stopped' : 'disabled',
      port: this.port,
      wsUrl: this.wsUrl,
      hermesUrl: this.runtime.wsUrl || '',
      remote,
      localEnabled: !!this.runtime.startLocalServer,
      error: this.serverError,
      connection: this.hermesState,
    };
  }

  private sendStatus() {
    const status = this.statusInfo();
    BrowserWindow.getAllWindows().forEach((w) => {
      if (w !== this.mainWindow && !w.isDestroyed()) w.webContents.send('service-status-changed', status);
    });
  }

  private updateShortcut() {
    globalShortcut.unregister(LISTEN_SHORTCUT);
    if (this.config.voice?.inputEnabled) {
      globalShortcut.register(LISTEN_SHORTCUT, () => {
        this.mainWindow?.webContents.send('mcp-message', { action: 'listen', data: { duration: 6 } });
      });
    }
  }

  private get companionMode() {
    return this.runtime.companion.enabled !== false;
  }

  private initializeApp() {
    if (!app.requestSingleInstanceLock()) {
      app.quit();
      return;
    }
    app.on('second-instance', () => this.showAvatar());

    // keep animating while other apps are focused
    app.commandLine.appendSwitch('disable-renderer-backgrounding');
    app.commandLine.appendSwitch('disable-background-timer-throttling');

    app.whenReady().then(() => {
      if (process.platform === 'darwin') app.dock?.hide(); // background service: no Dock icon
      // microphone for voice input; speech synthesis needs no permission
      session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
      if (this.runtime.startLocalServer) this.startMCPServer();
      this.createWindow();
      this.updateShortcut();
      this.setupTray();
      this.setupIPC();
    });

    app.on('before-quit', () => (this.quitting = true));
    app.on('will-quit', () => globalShortcut.unregisterAll());
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit();
    });
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) this.createWindow();
    });
  }

  private createWindow() {
    const companion = this.companionMode;
    const h = companion ? this.runtime.companion.height || 340 : 400;
    const w = companion ? Math.round(h * 0.78) : 300;
    const wa = screen.getPrimaryDisplay().workArea;

    this.mainWindow = new BrowserWindow({
      width: w,
      height: h,
      x: companion ? wa.x + 40 : this.config.behavior.position.x,
      y: companion ? wa.y + wa.height - h : this.config.behavior.position.y,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      alwaysOnTop: true,
      resizable: false,
      movable: !companion,
      skipTaskbar: companion,
      focusable: !companion, // never steals keyboard focus from what you're typing
      fullscreenable: false,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        backgroundThrottling: false,
        webSecurity: false,
      },
    });

    if (companion) {
      this.mainWindow.setAlwaysOnTop(true, 'screen-saver');
      this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      this.mainWindow.setContentProtection(true); // excluded from our own screen scans
      this.mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }

    this.loadAvatarPage();

    this.mainWindow.webContents.on('did-finish-load', () => {
      this.pushRendererSettings();
      if (this.config.advanced?.debugMode) this.mainWindow?.webContents.openDevTools({ mode: 'detach' });
      if (this.runtime.appearance) {
        this.config.appearance = { ...this.config.appearance, ...this.runtime.appearance };
        this.mainWindow?.webContents.send('mcp-message', { action: 'customize', data: this.config.appearance });
        if (this.config.appearance.pose) {
          this.mainWindow?.webContents.send('mcp-message', { action: 'pose', data: { pose: this.config.appearance.pose, default: true } });
        }
      }
      setTimeout(() => {
        if (companion) this.mainWindow?.showInactive();
        else {
          this.mainWindow?.show();
          this.mainWindow?.setIgnoreMouseEvents(false);
        }
      }, 100);
    });

    this.mainWindow.on('closed', () => {
      this.companion?.stop();
      this.companion = null;
      this.mainWindow = null;
    });

    if (companion) {
      this.companion = new DesktopCompanion(this.mainWindow, {
        captureIntervalMs: this.runtime.companion.captureIntervalMs || 1500,
        settings: this.runtime.companion,
        onSettingsChanged: (s) => {
          this.runtime.companion = { ...this.runtime.companion, ...s };
          saveRuntimeConfig(this.runtime);
        },
        onOpenConfig: () => this.openConfigWindow(),
        onQuit: () => this.quitApplication(),
        onHide: () => this.hideAvatar(),
        onIdleRoamChanged: (on) => {
          this.config.behavior = { ...this.config.behavior, idleRoam: on };
          this.runtime.behavior = { ...(this.runtime.behavior || {}), ...this.config.behavior };
          saveRuntimeConfig(this.runtime);
        },
      });
      this.companion.start();
      this.applyBehaviorToCompanion(true);
    } else {
      this.mainWindow.on('moved', () => {
        const b = this.mainWindow?.getBounds();
        if (b) this.config.behavior.position = { x: b.x, y: b.y };
      });
    }
  }

  private loadAvatarPage() {
    this.mainWindow?.loadFile(path.join(__dirname, 'avatar/index.html'), {
      query: { mode: this.companionMode ? 'companion' : 'viewer', ws: this.wsUrl || 'none' },
    });
  }

  private lastPosition = '';
  /** Behaviour tab → desktop companion (always on top, click-through, auto-hide, speed, position). */
  private applyBehaviorToCompanion(initial = false) {
    const b = this.config.behavior || DEFAULT_BEHAVIOR;
    const win = this.mainWindow;
    if (!win || !this.companion) return;
    if (b.alwaysOnTop) win.setAlwaysOnTop(true, 'screen-saver');
    else win.setAlwaysOnTop(false);
    this.companion.setClickThrough(b.clickThrough !== false);
    this.companion.setAutoHide(!!b.autoHide);
    this.companion.setSpeedFactor(Number(b.animSpeed) || 1);
    this.companion.setIdleRoam(!!b.idleRoam, Number(b.idleRoamDelay) || 60);
    const pos = JSON.stringify(b.position || {});
    if (b.position && pos !== this.lastPosition) {
      // "Initial position": she drops in there (only when it changes, not on every apply)
      if (!initial || this.runtime.behavior?.position) {
        this.companion.command({ cmd: 'drop_in', x: Number(b.position.x), y: Number(b.position.y) });
      }
      this.lastPosition = pos;
    }
  }

  private applySize() {
    const size = Number(this.config.appearance?.size);
    if (!this.companion || !Number.isFinite(size)) return;
    const h = Math.max(200, Math.min(600, Math.round(size * 2)));
    this.companion.command({ cmd: 'settings', height: h });
  }

  private setupTray() {
    this.trayManager = new TrayManager({
      onShowAvatar: () => this.showAvatar(),
      onHideAvatar: () => this.hideAvatar(),
      onOpenConfig: () => this.openConfigWindow(),
      onStart: () => this.startService(),
      onStop: () => this.stopService(),
      onRestart: () => this.restartService(),
      onQuit: () => this.quitApplication(),
    });
    if (this.mainWindow) this.trayManager.setAvatarWindow(this.mainWindow);
  }

  private showAvatar() {
    if (!this.mainWindow) return this.createWindow();
    if (this.companionMode) {
      this.mainWindow.showInactive();
      this.companion?.start();
    } else {
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }

  private hideAvatar() {
    this.companion?.stop();
    this.mainWindow?.hide();
  }

  private openConfigWindow() {
    const configWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'config-preload.js'),
        webSecurity: false,
      },
    });
    const simple = path.join(__dirname, 'config/simple-config.html');
    configWindow.loadFile(fs.existsSync(simple) ? simple : path.join(__dirname, 'config/index.html'));
    configWindow.show();
  }

  private startService() {
    if (!this.mcpServer) this.startMCPServer();
  }

  private stopService() {
    if (this.mcpServer) {
      this.mcpServer.removeAllListeners('exit');
      this.mcpServer.kill();
      this.mcpServer = null;
    }
    this.sendStatus();
  }

  private restartService() {
    this.stopService();
    setTimeout(() => this.startService(), 500);
  }

  private quitApplication() {
    this.quitting = true;
    this.trayManager?.destroy();
    this.stopService();
    app.quit();
  }

  private serverRestarts = 0;
  private serverError = '';
  private serverLog: string[] = [];
  /** connection state of the avatar window's WebSocket (reported by the renderer) */
  private hermesState: { connected: boolean; url?: string; error?: string; at: number } = { connected: false, at: 0 };

  private serverEnv() {
    // apps started from Finder get a minimal PATH: also look for Node in the usual Homebrew / nvm places
    const extra = ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.volta/bin')];
    const PATH = [process.env.PATH || '/usr/bin:/bin', ...extra].join(':');
    return {
      ...process.env,
      PATH,
      AVATAR_WS_PORT: String(this.port),
      AVATAR_LOG_LEVEL: String(this.config.advanced?.logLevel || 'info'),
    };
  }

  private startMCPServer(useElectronNode = false) {
    // Prefer the system Node (the MCP SDK is ESM-only and needs a recent Node);
    // fall back to Electron's embedded Node when `node` is not on PATH.
    const script = path.join(__dirname, 'mcp-server.js');
    const child = useElectronNode
      ? spawn(process.execPath, [script], {
          env: { ...this.serverEnv(), ELECTRON_RUN_AS_NODE: '1' },
          stdio: ['pipe', 'inherit', 'pipe', 'ipc'],
        })
      : spawn(process.env.AVATAR_NODE || 'node', [script], {
          env: this.serverEnv(),
          stdio: ['pipe', 'inherit', 'pipe', 'ipc'],
        });
    this.mcpServer = child;
    this.serverError = '';
    child.stderr?.on('data', (d: Buffer) => {
      const text = d.toString();
      process.stderr.write(text);
      this.serverLog.push(...text.split('\n').filter((l) => l.trim()));
      this.serverLog = this.serverLog.slice(-30);
      for (const m of text.matchAll(/port (\d+) already in use/gi)) {
        const msg = `porta ${m[1]} já está a ser usada por outro programa`;
        if (!this.serverError.includes(msg)) this.serverError = this.serverError ? `${this.serverError}; ${msg}` : msg;
        this.sendStatus();
      }
    });
    setTimeout(() => this.sendStatus(), 300);
    child.on('message', (message: any) => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) this.mainWindow.webContents.send('mcp-message', message);
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' && !useElectronNode) {
        this.mcpServer = null;
        this.startMCPServer(true);
      } else {
        console.error('MCP Server error:', error);
        this.serverError = `não arrancou: ${error.message}`;
        this.sendStatus();
      }
    });
    child.on('exit', (code: number | null) => {
      if (this.mcpServer === child) this.mcpServer = null;
      if (code !== 0 && code !== null) {
        const last = this.serverLog.filter((l) => /error|Error|cannot|Cannot/.test(l)).slice(-1)[0] || this.serverLog.slice(-1)[0] || '';
        this.serverError = `terminou com código ${code}${last ? ': ' + last.slice(0, 220) : ''}`;
      }
      this.sendStatus();
      if (code !== 0 && code !== null && !this.quitting && this.serverRestarts++ < 5) {
        setTimeout(() => this.startMCPServer(useElectronNode), 1500 * this.serverRestarts);
      }
    });
  }

  private setupIPC() {
    // --- companion bridge -------------------------------------------------
    ipcMain.on('companion-metrics', (_e, m) => this.companion?.setMetrics(m));
    ipcMain.on('companion-grab', () => this.companion?.grab());
    ipcMain.on('companion-release', () => this.companion?.release());
    ipcMain.on('companion-menu', () => this.companion?.menu());
    ipcMain.on('companion-command', (_e, c) => {
      if (c?.cmd === 'show') return this.showAvatar();
      this.companion?.command(c);
    });
    ipcMain.handle('get-runtime-config', () => this.runtime);

    // --- legacy window API ------------------------------------------------
    ipcMain.handle('move-window', (_e, x: number, y: number) => {
      if (this.companion) this.companion.command({ cmd: 'walk_to', x, y });
      else if (this.mainWindow) {
        this.mainWindow.setPosition(Math.round(x), Math.round(y));
        this.config.behavior.position = { x, y };
      }
    });
    ipcMain.handle('minimize-window', () => this.mainWindow?.minimize());
    ipcMain.handle('close-window', () => this.mainWindow?.close());
    ipcMain.handle('set-always-on-top', (_e, on: boolean) => this.mainWindow?.setAlwaysOnTop(on));
    ipcMain.handle('get-screen-size', () => {
      const { width, height } = screen.getPrimaryDisplay().workAreaSize;
      return { width, height };
    });
    ipcMain.handle('set-ignore-mouse-events', (_e, ignore: boolean, options?: any) => {
      if (!this.companion) this.mainWindow?.setIgnoreMouseEvents(ignore, options);
    });
    ipcMain.handle('save-config', (_e, config: any) => {
      this.mergeAndApplyConfig(config, true);
    });
    ipcMain.handle('apply-config', (_e, config: any) => {
      this.mergeAndApplyConfig(config, false);
    });
    ipcMain.handle('get-config', () => ({ ...this.config, runtime: this.runtime }));
    ipcMain.handle('test-voice', (_e, text: string, voiceConfig?: any) => {
      const wc = this.mainWindow?.webContents;
      if (!wc) return;
      if (voiceConfig) wc.send('mcp-message', { action: 'voice', data: voiceConfig });
      wc.send('mcp-message', {
        action: 'speak_start',
        data: { text: text || 'Olá! Sou a tua assistente.', forceVoice: true },
      });
    });
    ipcMain.handle('reset-config', () => {
      this.runtime.appearance = undefined;
      this.runtime.behavior = undefined;
      this.runtime.voice = undefined;
      this.runtime.advanced = undefined;
      saveRuntimeConfig(this.runtime);
      this.config.behavior = { ...DEFAULT_BEHAVIOR };
      this.config.voice = { ...DEFAULT_VOICE };
      const portChanged = this.port !== DEFAULT_ADVANCED.port;
      this.config.advanced = { ...DEFAULT_ADVANCED };
      this.config.appearance = {
        hairColor: '#C9A15A',
        eyeColor: '#7A4A1C',
        skinTone: '#F7DCC0',
        pose: 'idle',
        outfit: 'noir-gold',
        size: 150,
      };
      this.loadAvatarPage(); // fresh avatar with default looks
      this.companion?.setSpeedFactor(1);
      this.applyBehaviorToCompanion();
      this.applySize();
      if (portChanged) this.restartService();
      this.updateShortcut();
      return { ...this.config, runtime: this.runtime };
    });
    ipcMain.handle('clear-cache', async () => {
      await session.defaultSession.clearCache();
      await session.defaultSession.clearStorageData({ storages: ['localstorage', 'cachestorage', 'serviceworkers', 'shadercache'] });
      return true;
    });
    ipcMain.handle('get-service-status', () => this.statusInfo());
    ipcMain.on('avatar-ws-state', (_e, st: any) => {
      // ignore late reports from a page that still used the previous address
      const mask = (u: string) => String(u || '').replace(/token=[^&]+/, 'token=…');
      if (process.env.AVATAR_DEBUG_WS) console.log('[ws-state]', JSON.stringify(st), 'current', this.wsUrl);
      if (st?.url && mask(st.url) !== mask(this.wsUrl)) return;
      this.hermesState = { connected: !!st?.connected, url: st?.url, error: st?.error, at: Date.now() };
      this.sendStatus();
    });
    ipcMain.handle('test-hermes', (_e, url: string) => this.testHermes(normalizeWsUrl(url) || this.wsUrl));
    ipcMain.handle('update-avatar-appearance', (_e, appearance: any) => {
      const sizeChanged = appearance?.size !== undefined && appearance.size !== this.config.appearance?.size;
      this.config.appearance = { ...this.config.appearance, ...appearance };
      if (sizeChanged) this.applySize();
      this.mainWindow?.webContents.send('mcp-message', { action: 'customize', data: this.config.appearance });
      if (appearance?.pose) {
        this.mainWindow?.webContents.send('mcp-message', { action: 'pose', data: { pose: appearance.pose, default: true } });
      }
    });
    ipcMain.handle('update-avatar-behavior', (_e, behavior: any) => {
      this.config.behavior = { ...this.config.behavior, ...behavior };
      this.pushRendererSettings();
      this.applyConfiguration();
    });
    ipcMain.handle('show-avatar', () => this.showAvatar());
    ipcMain.handle('hide-avatar', () => this.hideAvatar());
    ipcMain.handle('start-service', () => this.startService());
    ipcMain.handle('stop-service', () => this.stopService());
    ipcMain.handle('restart-service', () => this.restartService());
    ipcMain.handle('open-config', () => this.openConfigWindow());
    ipcMain.handle('show-about', () => this.showAbout());
    ipcMain.handle('quit-app', () => this.quitApplication());
    ipcMain.handle('close-config', () => {
      BrowserWindow.getAllWindows().forEach((w) => {
        if (w !== this.mainWindow) w.close();
      });
    });
  }

  private showAbout() {
    dialog.showMessageBox({
      type: 'info',
      title: 'Avatar Assistant',
      message: 'Avatar Assistant',
      detail: 'Hermes 3D desktop companion.\nConfig: ' + CONFIG_FILE,
      buttons: ['OK'],
    });
  }

  /** Try a WebSocket to the Hermes avatar server: ok + what answered. */
  private testHermes(url: string): Promise<{ ok: boolean; url: string; message: string; clients?: number }> {
    return new Promise((resolve) => {
      if (!url) return resolve({ ok: false, url, message: 'Sem endereço configurado' });
      let done = false;
      let ws: WebSocket;
      const finish = (r: { ok: boolean; message: string; clients?: number }) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        resolve({ url, ...r });
      };
      const timer = setTimeout(() => finish({ ok: false, message: 'Sem resposta em 5 s (endereço, porta ou firewall?)' }), 5000);
      try {
        ws = new WebSocket(url, { handshakeTimeout: 4500 });
      } catch (e: any) {
        return finish({ ok: false, message: `Endereço inválido: ${e?.message || e}` });
      }
      ws.on('message', (raw) => {
        try {
          const m = JSON.parse(raw.toString());
          if (m?.action === 'presence') finish({ ok: true, message: 'Servidor do avatar do Hermes a responder' });
        } catch {
          /* ignore */
        }
      });
      ws.on('open', () => setTimeout(() => finish({ ok: true, message: 'Ligação aberta' }), 1200));
      ws.on('close', (code) => {
        if (code === 4401) finish({ ok: false, message: 'Token inválido' });
      });
      ws.on('error', (e: any) => {
        const c = e?.code;
        finish({
          ok: false,
          message:
            c === 'ECONNREFUSED'
              ? 'Ligação recusada: o servidor do avatar não está a correr nesse endereço/porta (o Hermes já o arrancou?)'
              : c === 'ENOTFOUND'
                ? 'Nome do servidor não encontrado'
                : c === 'EHOSTUNREACH' || c === 'ETIMEDOUT'
                  ? 'Máquina inacessível (rede, VPN ou firewall)'
                  : `Erro: ${e?.message || c || e}`,
        });
      });
    });
  }

  /** Connection tab: Hermes address (remote server in the VM) and whether to run the local server too. */
  private applyConnection(conn: { wsUrl?: string; startLocalServer?: boolean }, persist: boolean) {
    const wsUrl = conn.wsUrl !== undefined ? normalizeWsUrl(conn.wsUrl) : this.runtime.wsUrl;
    const local = conn.startLocalServer !== undefined ? !!conn.startLocalServer : this.runtime.startLocalServer;
    const changed = wsUrl !== this.runtime.wsUrl || local !== this.runtime.startLocalServer;
    if (!changed) return;
    this.runtime.wsUrl = wsUrl;
    this.runtime.startLocalServer = local;
    if (persist) saveRuntimeConfig(this.runtime);
    if (local && !this.mcpServer) {
      this.serverRestarts = 0;
      this.startMCPServer();
    } else if (!local && this.mcpServer) this.stopService();
    this.hermesState = { connected: false, at: Date.now() };
    setTimeout(() => this.loadAvatarPage(), 500); // reconnect the avatar to the new address
    this.sendStatus();
  }

  private mergeAndApplyConfig(config: any, persist: boolean) {
    if (!config || typeof config !== 'object') return;
    if (config.connection) this.applyConnection(config.connection, persist);
    if (config.appearance) {
      this.config.appearance = { ...this.config.appearance, ...config.appearance };
      this.mainWindow?.webContents.send('mcp-message', {
        action: 'customize',
        data: this.config.appearance,
      });
      if (config.appearance.pose) {
        this.mainWindow?.webContents.send('mcp-message', {
          action: 'pose',
          data: { pose: config.appearance.pose, default: true },
        });
      }
    }
    if (config.behavior) {
      this.config.behavior = { ...this.config.behavior, ...config.behavior };
    }
    if (config.voice) {
      this.config.voice = { ...this.config.voice, ...config.voice };
      this.updateShortcut();
    }
    let restart = false;
    let reload = false;
    if (config.advanced) {
      const prev = { ...this.config.advanced };
      this.config.advanced = { ...this.config.advanced, ...config.advanced };
      if (Number(prev.port) !== this.port) {
        restart = true;
        reload = !this.runtime.wsUrl; // avatar talks to the local server → reconnect on the new port
      }
      if (prev.logLevel !== this.config.advanced.logLevel) restart = true;
      if (!!prev.debugMode !== !!this.config.advanced.debugMode && this.mainWindow) {
        if (this.config.advanced.debugMode) this.mainWindow.webContents.openDevTools({ mode: 'detach' });
        else this.mainWindow.webContents.closeDevTools();
      }
    }
    if (persist) {
      this.runtime.appearance = { ...this.config.appearance };
      this.runtime.behavior = { ...this.config.behavior };
      this.runtime.voice = { ...this.config.voice };
      this.runtime.advanced = { ...this.config.advanced };
      saveRuntimeConfig(this.runtime);
    }
    if (restart && this.runtime.startLocalServer) this.restartService();
    if (reload) setTimeout(() => this.loadAvatarPage(), 800);
    this.applyConfiguration();
  }

  private applyConfiguration() {
    if (!this.mainWindow) return;
    this.pushRendererSettings();
    if (this.companion) {
      this.applySize();
      this.applyBehaviorToCompanion();
      return;
    }
    this.mainWindow.setIgnoreMouseEvents(!!this.config.behavior.clickThrough, { forward: true });
    this.mainWindow.setAlwaysOnTop(this.config.behavior.alwaysOnTop);
    this.mainWindow.setPosition(this.config.behavior.position.x, this.config.behavior.position.y);
    this.mainWindow.webContents.send('config-update', this.config);
  }
}

new DesktopWindow();

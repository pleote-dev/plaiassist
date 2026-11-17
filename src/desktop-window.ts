import { app, BrowserWindow, ipcMain, dialog, screen } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn, ChildProcess } from 'child_process';
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
  companion: Partial<CompanionSettings> & { height: number; captureIntervalMs: number };
}

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
    this.initializeApp();
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
      if (this.runtime.startLocalServer) this.startMCPServer();
      this.createWindow();
      this.setupTray();
      this.setupIPC();
    });

    app.on('before-quit', () => (this.quitting = true));
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

    const wsUrl = this.runtime.wsUrl || (this.runtime.startLocalServer ? 'ws://localhost:8080' : '');
    this.mainWindow.loadFile(path.join(__dirname, 'avatar/index.html'), {
      query: { mode: companion ? 'companion' : 'viewer', ws: wsUrl || 'none' },
    });

    this.mainWindow.webContents.once('did-finish-load', () => {
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
      });
      this.companion.start();
    } else {
      this.mainWindow.on('moved', () => {
        const b = this.mainWindow?.getBounds();
        if (b) this.config.behavior.position = { x: b.x, y: b.y };
      });
    }
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

  private startMCPServer(useElectronNode = false) {
    // Prefer the system Node (the MCP SDK is ESM-only and needs a recent Node);
    // fall back to Electron's embedded Node when `node` is not on PATH.
    const script = path.join(__dirname, 'mcp-server.js');
    const child = useElectronNode
      ? spawn(process.execPath, [script], {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          stdio: ['pipe', 'inherit', 'inherit', 'ipc'],
        })
      : spawn(process.env.AVATAR_NODE || 'node', [script], { stdio: ['pipe', 'inherit', 'inherit', 'ipc'] });
    this.mcpServer = child;
    child.on('message', (message: any) => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) this.mainWindow.webContents.send('mcp-message', message);
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' && !useElectronNode) {
        this.mcpServer = null;
        this.startMCPServer(true);
      } else console.error('MCP Server error:', error);
    });
    child.on('exit', (code: number | null) => {
      if (this.mcpServer === child) this.mcpServer = null;
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
      this.config = { ...this.config, ...config };
    });
    ipcMain.handle('apply-config', (_e, config: any) => {
      this.config = { ...this.config, ...config };
      this.applyConfiguration();
    });
    ipcMain.handle('get-config', () => ({ ...this.config, runtime: this.runtime }));
    ipcMain.handle('test-voice', () => undefined);
    ipcMain.handle('get-service-status', () => ({
      running: this.mcpServer !== null,
      status: this.mcpServer ? 'running' : 'stopped',
    }));
    ipcMain.handle('update-avatar-appearance', (_e, appearance: any) => {
      this.config.appearance = { ...this.config.appearance, ...appearance };
      this.mainWindow?.webContents.send('mcp-message', { action: 'customize', data: this.config.appearance });
    });
    ipcMain.handle('update-avatar-behavior', (_e, behavior: any) => {
      this.config.behavior = { ...this.config.behavior, ...behavior };
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

  private applyConfiguration() {
    if (!this.mainWindow || this.companion) return;
    this.mainWindow.setAlwaysOnTop(this.config.behavior.alwaysOnTop);
    this.mainWindow.setPosition(this.config.behavior.position.x, this.config.behavior.position.y);
    this.mainWindow.webContents.send('config-update', this.config);
  }
}

new DesktopWindow();

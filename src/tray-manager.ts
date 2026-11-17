import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron';
import * as path from 'path';
import { spawn } from 'child_process';

interface TrayManagerConfig {
  onShowAvatar: () => void;
  onHideAvatar: () => void;
  onOpenConfig: () => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onQuit: () => void;
}

class TrayManager {
  private tray: Tray | null = null;
  private configWindow: BrowserWindow | null = null;
  private avatarWindow: BrowserWindow | null = null;
  private mcpServer: any = null;
  private isRunning = false;
  private callbacks: TrayManagerConfig;

  constructor(callbacks: TrayManagerConfig) {
    this.callbacks = callbacks;
    this.createTray();
  }

  private createTray(): void {
    // Try to load the tray icon
    const iconPath = path.join(__dirname, '../assets/tray-icon.png');
    const fs = require('fs');
    
    if (fs.existsSync(iconPath)) {
      this.tray = new Tray(iconPath);
    } else {
      // Create a simple icon programmatically
      this.tray = new Tray(this.createTrayIcon());
    }

    this.tray.setToolTip('Avatar Assistant MCP');
    this.updateTrayMenu();
  }

  private createTrayIcon(): any {
    // Create a simple 32x32 icon programmatically
    try {
      const canvas = require('canvas');
      if (canvas) {
        const { createCanvas } = canvas;
        const canv = createCanvas(32, 32);
        const ctx = canv.getContext('2d');
        
        // Draw simple avatar icon
        ctx.fillStyle = '#4169E1';
        ctx.beginPath();
        ctx.arc(16, 16, 14, 0, 2 * Math.PI);
        ctx.fill();
        
        ctx.fillStyle = '#FDBCB4';
        ctx.beginPath();
        ctx.arc(16, 12, 6, 0, 2 * Math.PI);
        ctx.fill();
        
        return nativeImage.createFromDataURL(canv.toDataURL());
      }
    } catch (error) {
      console.log('Canvas not available, using fallback icon');
    }
    
    // Fallback: create a simple colored square
    return nativeImage.createEmpty();
  }

  private updateTrayMenu() {
    if (!this.tray) return;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Avatar Assistant',
        enabled: false,
        icon: this.getStatusIcon()
      },
      { type: 'separator' },
      {
        label: 'Show Avatar',
        click: () => this.callbacks.onShowAvatar(),
        accelerator: 'CmdOrCtrl+Shift+A',
        enabled: this.isRunning
      },
      {
        label: 'Hide Avatar',
        click: () => this.callbacks.onHideAvatar(),
        accelerator: 'CmdOrCtrl+Shift+H',
        enabled: this.isRunning && this.avatarWindow !== null
      },
      { type: 'separator' },
      {
        label: 'Start Service',
        click: () => this.startService(),
        accelerator: 'CmdOrCtrl+Shift+S',
        enabled: !this.isRunning
      },
      {
        label: 'Stop Service',
        click: () => this.stopService(),
        accelerator: 'CmdOrCtrl+Shift+T',
        enabled: this.isRunning
      },
      {
        label: 'Restart Service',
        click: () => this.restartService(),
        accelerator: 'CmdOrCtrl+Shift+R',
        enabled: this.isRunning
      },
      { type: 'separator' },
      {
        label: 'Configuration',
        click: () => this.openConfigWindow(),
        accelerator: 'CmdOrCtrl+Shift+C'
      },
      { type: 'separator' },
      {
        label: 'About',
        click: () => this.showAbout()
      },
      {
        label: 'Quit',
        click: () => this.callbacks.onQuit(),
        accelerator: 'CmdOrCtrl+Q'
      }
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  private getStatusIcon(): any {
    const size = 16;
    const icon = nativeImage.createEmpty();
    
    // Create a simple status indicator
    const color = this.isRunning ? '#00FF00' : '#FF0000';
    
    try {
      // Use canvas if available, otherwise fallback
      const canvas = require('canvas');
      if (canvas) {
        const { createCanvas } = canvas;
        const canv = createCanvas(size, size);
        const ctx = canv.getContext('2d');
        
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(size/2, size/2, size/4, 0, 2 * Math.PI);
        ctx.fill();
        
        return nativeImage.createFromDataURL(canv.toDataURL());
      }
    } catch (error) {
      // Fallback: just return the empty icon
      console.log('Cannot create status icon, using fallback');
    }
    
    return icon;
  }

  private startService() {
    if (this.isRunning) return;

    try {
      // Start MCP server
      this.mcpServer = spawn('node', [path.join(__dirname, '../mcp-server.js')], {
        stdio: ['inherit', 'inherit', 'inherit', 'ipc']
      });

      this.mcpServer.on('error', (error: Error) => {
        console.error('MCP Server error:', error);
        this.showNotification('Failed to start MCP server', 'error');
      });

      this.mcpServer.on('exit', (code: number) => {
        console.log(`MCP Server exited with code ${code}`);
        if (code !== 0 && this.isRunning) {
          this.showNotification('MCP server crashed, restarting...', 'warning');
          setTimeout(() => this.startService(), 1000);
        }
      });

      // Show avatar window
      this.callbacks.onShowAvatar();
      
      this.isRunning = true;
      this.updateTrayMenu();
      this.showNotification('Avatar Assistant started', 'success');
      
    } catch (error) {
      console.error('Failed to start service:', error);
      this.showNotification('Failed to start service', 'error');
    }
  }

  private stopService() {
    if (!this.isRunning) return;

    try {
      // Stop MCP server
      if (this.mcpServer) {
        this.mcpServer.kill();
        this.mcpServer = null;
      }

      // Hide avatar window
      this.callbacks.onHideAvatar();
      
      this.isRunning = false;
      this.updateTrayMenu();
      this.showNotification('Avatar Assistant stopped', 'info');
      
    } catch (error) {
      console.error('Failed to stop service:', error);
      this.showNotification('Failed to stop service', 'error');
    }
  }

  private restartService() {
    this.stopService();
    setTimeout(() => this.startService(), 500);
  }

  private openConfigWindow() {
    if (this.configWindow && !this.configWindow.isDestroyed()) {
      this.configWindow.focus();
      return;
    }

    this.configWindow = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'config-preload.js')
      },
      icon: path.join(__dirname, '../assets/icon.png'),
      title: 'Avatar Assistant Configuration'
    });

    // Load configuration dashboard
    if (process.env.NODE_ENV === 'development') {
      this.configWindow.loadURL('http://localhost:3001');
    } else {
      this.configWindow.loadFile(path.join(__dirname, '../config/index.html'));
    }

    this.configWindow.on('closed', () => {
      this.configWindow = null;
    });

    // Open DevTools in development
    if (process.env.NODE_ENV === 'development') {
      this.configWindow.webContents.openDevTools();
    }
  }

  private showAbout() {
    const { dialog } = require('electron');
    dialog.showMessageBox({
      type: 'info',
      title: 'About Avatar Assistant',
      message: 'Avatar Assistant MCP',
      detail: 'Version 1.0.0\n\nA desktop assistant with a customizable 3D avatar girl that can interface with the desktop and user through voice and visual interactions.\n\nBuilt with Electron, Three.js, and MCP.',
      buttons: ['OK']
    });
  }

  private showNotification(message: string, type: 'success' | 'error' | 'warning' | 'info') {
    if (this.tray && this.tray.displayBalloon) {
      this.tray.displayBalloon({
        title: 'Avatar Assistant',
        content: message,
        iconType: type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info'
      });
    }
  }

  // Public methods
  public setAvatarWindow(window: BrowserWindow) {
    this.avatarWindow = window;
    this.updateTrayMenu();
  }

  public setStatus(running: boolean) {
    this.isRunning = running;
    this.updateTrayMenu();
  }

  public destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
    
    if (this.configWindow && !this.configWindow.isDestroyed()) {
      this.configWindow.close();
    }
    
    this.stopService();
  }
}

export default TrayManager;

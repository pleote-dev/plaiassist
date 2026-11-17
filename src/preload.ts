import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
  moveWindow: (x: number, y: number) => ipcRenderer.invoke('move-window', x, y),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  setAlwaysOnTop: (alwaysOnTop: boolean) => ipcRenderer.invoke('set-always-on-top', alwaysOnTop),
  getScreenSize: () => ipcRenderer.invoke('get-screen-size'),
  setIgnoreMouseEvents: (ignore: boolean, options?: any) => 
    ipcRenderer.invoke('set-ignore-mouse-events', ignore, options),
  
  // MCP communication
  onMCPMessage: (callback: (message: any) => void) => {
    ipcRenderer.on('mcp-message', (event, message) => callback(message));
  },
  
  sendToMCP: (message: any) => {
    ipcRenderer.send('mcp-message', message);
  },

  // Desktop companion (locomotion engine runs in the main process)
  companion: {
    grab: () => ipcRenderer.send('companion-grab'),
    release: () => ipcRenderer.send('companion-release'),
    menu: () => ipcRenderer.send('companion-menu'),
    command: (cmd: any) => ipcRenderer.send('companion-command', cmd),
    metrics: (m: any) => ipcRenderer.send('companion-metrics', m),
    onState: (cb: (s: any) => void) => {
      ipcRenderer.on('companion-state', (_e, s) => cb(s));
    },
    onHostMessage: (cb: (m: any) => void) => {
      ipcRenderer.on('companion-host-message', (_e, m) => cb(m));
    },
  },
  getRuntimeConfig: () => ipcRenderer.invoke('get-runtime-config'),

  // Avatar control functions
  showAvatar: () => ipcRenderer.invoke('show-avatar'),
  hideAvatar: () => ipcRenderer.invoke('hide-avatar'),
  startService: () => ipcRenderer.invoke('start-service'),
  stopService: () => ipcRenderer.invoke('stop-service'),
  restartService: () => ipcRenderer.invoke('restart-service'),
  openConfig: () => ipcRenderer.invoke('open-config'),
  closeConfig: () => ipcRenderer.invoke('close-config'),
  showAbout: () => ipcRenderer.invoke('show-about'),
  quit: () => ipcRenderer.invoke('quit-app'),

  // Legacy names for compatibility
  minimize: () => ipcRenderer.invoke('minimize-window'),
  close: () => ipcRenderer.invoke('close-window')
});

// Type definitions for the exposed API
declare global {
  interface Window {
    api: {
      moveWindow: (x: number, y: number) => Promise<void>;
      minimizeWindow: () => Promise<void>;
      closeWindow: () => Promise<void>;
      setAlwaysOnTop: (alwaysOnTop: boolean) => Promise<void>;
      getScreenSize: () => Promise<{ width: number; height: number }>;
      setIgnoreMouseEvents: (ignore: boolean, options?: any) => Promise<void>;
      onMCPMessage: (callback: (message: any) => void) => void;
      sendToMCP: (message: any) => void;
      showAvatar: () => Promise<void>;
      hideAvatar: () => Promise<void>;
      startService: () => Promise<void>;
      stopService: () => Promise<void>;
      restartService: () => Promise<void>;
      openConfig: () => Promise<void>;
      closeConfig: () => Promise<void>;
      showAbout: () => Promise<void>;
      quit: () => Promise<void>;
      minimize: () => Promise<void>;
      close: () => Promise<void>;
      companion: {
        grab: () => void;
        release: () => void;
        menu: () => void;
        command: (cmd: any) => void;
        metrics: (m: any) => void;
        onState: (cb: (s: any) => void) => void;
        onHostMessage: (cb: (m: any) => void) => void;
      };
      getRuntimeConfig: () => Promise<any>;
    };
  }
}

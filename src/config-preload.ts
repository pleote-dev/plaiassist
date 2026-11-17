import { contextBridge, ipcRenderer } from 'electron';

// Expose configuration-specific APIs
contextBridge.exposeInMainWorld('configAPI', {
  // Configuration management
  saveConfig: (config: any) => ipcRenderer.invoke('save-config', config),
  applyConfig: (config: any) => ipcRenderer.invoke('apply-config', config),
  getConfig: () => ipcRenderer.invoke('get-config'),
  
  // Voice testing
  testVoice: (text: string, voiceConfig: any) => ipcRenderer.invoke('test-voice', text, voiceConfig),
  
  // Service status
  getServiceStatus: () => ipcRenderer.invoke('get-service-status'),
  
  // Avatar control from config
  updateAvatarAppearance: (appearance: any) => ipcRenderer.invoke('update-avatar-appearance', appearance),
  updateAvatarBehavior: (behavior: any) => ipcRenderer.invoke('update-avatar-behavior', behavior),
  
  // Events
  onConfigUpdate: (callback: (config: any) => void) => {
    ipcRenderer.on('config-updated', (event, config) => callback(config));
  },
  
  onServiceStatusChange: (callback: (status: any) => void) => {
    ipcRenderer.on('service-status-changed', (event, status) => callback(status));
  }
});

// Type definitions
declare global {
  interface Window {
    configAPI: {
      saveConfig: (config: any) => Promise<void>;
      applyConfig: (config: any) => Promise<void>;
      getConfig: () => Promise<any>;
      testVoice: (text: string, voiceConfig: any) => Promise<void>;
      getServiceStatus: () => Promise<{ running: boolean; status: string }>;
      updateAvatarAppearance: (appearance: any) => Promise<void>;
      updateAvatarBehavior: (behavior: any) => Promise<void>;
      onConfigUpdate: (callback: (config: any) => void) => void;
      onServiceStatusChange: (callback: (status: any) => void) => void;
    };
  }
}

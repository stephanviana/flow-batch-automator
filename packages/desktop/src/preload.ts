import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from './contracts.js';

const bridge: DesktopBridge = {
  getSnapshot: () => ipcRenderer.invoke('desktop:snapshot'),
  navigate: (route) => ipcRenderer.invoke('desktop:navigate', route),
  openLogin: () => ipcRenderer.invoke('desktop:open-login'),
  connectBrowser: () => ipcRenderer.invoke('desktop:connect-browser'),
  selectProfile: (name) => ipcRenderer.invoke('desktop:select-profile', name),
  createProfile: (name) => ipcRenderer.invoke('desktop:create-profile', name),
  pairExecutor: () => ipcRenderer.invoke('desktop:pair-executor'),
  installMcp: (client) => ipcRenderer.invoke('desktop:install-mcp', client),
  openFolder: (target) => ipcRenderer.invoke('desktop:open-folder', target),
};

contextBridge.exposeInMainWorld('flowDesktop', bridge);

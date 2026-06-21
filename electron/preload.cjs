/**
 * Antibiogram Analytics - Preload Script
 * @copyright 2026 Abdallahjawadk
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAppName: () => ipcRenderer.invoke('get-app-name'),
  getAuthor: () => ipcRenderer.invoke('get-author'),
  getCopyright: () => ipcRenderer.invoke('get-copyright'),

  // File operations
  savePDF: (defaultName) => ipcRenderer.invoke('save-pdf', defaultName),
  saveExcel: (defaultName) => ipcRenderer.invoke('save-excel', defaultName),
  printHTML: (payload) => ipcRenderer.invoke('print-html', payload),
  saveFile: (payload) => ipcRenderer.invoke('save-file', payload),
  openFile: () => ipcRenderer.invoke('open-file'),
  showMessage: (options) => ipcRenderer.invoke('show-message', options),

  // Menu events
  onMenuNewHospital: (callback) => ipcRenderer.on('menu-new-hospital', callback),
  onMenuImportFile: (callback) => ipcRenderer.on('menu-import-file', (_event, filePath) => callback(filePath)),
  onMenuExportPDF: (callback) => ipcRenderer.on('menu-export-pdf', callback),
  onMenuExportExcel: (callback) => ipcRenderer.on('menu-export-excel', callback),
  onMenuExportWord: (callback) => ipcRenderer.on('menu-export-word', callback),
  onMenuPrint: (callback) => ipcRenderer.on('menu-print', callback),
  onMenuNavigate: (callback) => ipcRenderer.on('menu-navigate', (_event, page) => callback(page)),
  onMenuLanguage: (callback) => ipcRenderer.on('menu-language', (_event, lang) => callback(lang)),
  onFileOpened: (callback) => ipcRenderer.on('file-opened', (_event, filePath) => callback(filePath)),

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});

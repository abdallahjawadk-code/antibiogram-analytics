/**
 * Ambient typing for the Electron preload bridge (electron/preload.js).
 * `window.electronAPI` is undefined when the app runs in a plain browser, so
 * all consumers must null-check before use.
 */
export interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getAppName: () => Promise<string>;
  getAuthor: () => Promise<string>;
  getCopyright: () => Promise<string>;

  savePDF: (defaultName?: string) => Promise<unknown>;
  saveExcel: (defaultName?: string) => Promise<unknown>;
  printHTML: (payload: { html: string; title?: string }) => Promise<{ success: boolean; failureReason?: string | null }>;
  saveFile: (payload: { defaultName: string; content: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<{ canceled: boolean; filePath?: string }>;
  openFile: () => Promise<unknown>;
  showMessage: (options: unknown) => Promise<unknown>;

  onMenuNewHospital: (cb: () => void) => void;
  onMenuImportFile: (cb: (filePath: string) => void) => void;
  onMenuExportPDF: (cb: () => void) => void;
  onMenuExportExcel: (cb: () => void) => void;
  onMenuExportWord: (cb: () => void) => void;
  onMenuPrint: (cb: () => void) => void;
  onMenuNavigate: (cb: (page: string) => void) => void;
  onMenuLanguage: (cb: (lang: 'en' | 'ar') => void) => void;
  onFileOpened: (cb: (filePath: string) => void) => void;

  removeAllListeners: (channel: string) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};

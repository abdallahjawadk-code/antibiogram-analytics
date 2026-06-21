/**
 * Antibiogram Analytics System - Desktop Application
 *
 * A comprehensive antimicrobial susceptibility analysis system
 * for generating professional antibiogram charts.
 *
 * @copyright 2026 Abdallahjawadk
 * @author Abdallahjawadk
 * @license MIT
 *
 * System Requirements:
 * - Windows 7 SP1 (32-bit/64-bit) or later
 * - Windows 8, 8.1, 10, 11
 * - Minimum 2GB RAM
 * - Minimum 500MB disk space
 */

const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Keep a global reference of the window object
let mainWindow = null;
let tray = null;

// App information
const APP_NAME = 'Antibiogram Analytics';
const APP_VERSION = '1.0.0';
const COPYRIGHT = '© 2026 Abdallahjawadk. All Rights Reserved.';
const AUTHOR = 'Abdallahjawadk';

// Development mode check
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Get icon path. electron-builder packages electron/** under resources/app,
// so electron/assets travels with the app and __dirname/assets resolves in
// both development and the packaged build.
function getIconPath() {
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  return path.join(__dirname, 'assets', iconFile);
}

// Create the main application window
function createMainWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: `${APP_NAME} v${APP_VERSION}`,
    icon: getIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.cjs'),
      // Hardening: keep the renderer sandboxed and block dangerous APIs.
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
    frame: true,
    backgroundColor: '#f8fafc',
    show: false,
    // Windows 7 compatibility
    autoHideMenuBar: false,
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // In the packaged app, electron-builder copies dist/** to the app root
    // (resources/app/dist) while this file lives in resources/app/electron,
    // so the renderer entry point is one directory up from __dirname.
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Security hardening: external links open in the system browser, never in an
  // in-app window, and in-app navigation away from the bundled app is blocked.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isLocal = url.startsWith('http://localhost:5173') || url.startsWith('file://');
    if (!isLocal) {
      event.preventDefault();
      if (url.startsWith('https://')) shell.openExternal(url);
    }
  });

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Handle window close
  mainWindow.on('close', (event) => {
    if (app.isQuitting) {
      return;
    }
    event.preventDefault();
    mainWindow.hide();
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Create application menu
  createApplicationMenu();
}

// Create system tray icon
function createTray() {
  const iconPath = getIconPath();
  const icon = nativeImage.createFromPath(iconPath);

  tray = new Tray(icon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: APP_NAME,
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Open',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createMainWindow();
        }
      }
    },
    {
      label: 'Exit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip(APP_NAME);
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// Create application menu
function createApplicationMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Hospital',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow.webContents.send('menu-new-hospital')
        },
        {
          label: 'Import Data',
          accelerator: 'CmdOrCtrl+I',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openFile'],
              filters: [
                { name: 'Excel Files', extensions: ['xlsx', 'xls'] }
              ]
            });
            if (!result.canceled && result.filePaths.length > 0) {
              mainWindow.webContents.send('menu-import-file', result.filePaths[0]);
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Export Report',
          submenu: [
            {
              label: 'Export as PDF',
              click: () => mainWindow.webContents.send('menu-export-pdf')
            },
            {
              label: 'Export as Excel',
              click: () => mainWindow.webContents.send('menu-export-excel')
            },
            {
              label: 'Export as Word',
              click: () => mainWindow.webContents.send('menu-export-word')
            }
          ]
        },
        { type: 'separator' },
        {
          label: 'Print',
          accelerator: 'CmdOrCtrl+P',
          click: () => mainWindow.webContents.send('menu-print')
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Dashboard',
          accelerator: 'CmdOrCtrl+1',
          click: () => mainWindow.webContents.send('menu-navigate', 'dashboard')
        },
        {
          label: 'Hospitals',
          accelerator: 'CmdOrCtrl+2',
          click: () => mainWindow.webContents.send('menu-navigate', 'hospitals')
        },
        {
          label: 'Antibiogram',
          accelerator: 'CmdOrCtrl+3',
          click: () => mainWindow.webContents.send('menu-navigate', 'antibiogram')
        },
        {
          label: 'Comparison',
          accelerator: 'CmdOrCtrl+4',
          click: () => mainWindow.webContents.send('menu-navigate', 'comparison')
        },
        {
          label: 'Trends',
          accelerator: 'CmdOrCtrl+5',
          click: () => mainWindow.webContents.send('menu-navigate', 'trends')
        },
        {
          label: 'Alerts',
          accelerator: 'CmdOrCtrl+6',
          click: () => mainWindow.webContents.send('menu-navigate', 'alerts')
        },
        { type: 'separator' },
        {
          label: 'Toggle Full Screen',
          accelerator: 'F11',
          click: () => mainWindow.setFullScreen(!mainWindow.isFullScreen())
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools', visible: isDev }
      ]
    },
    {
      label: 'Language',
      submenu: [
        {
          label: 'English',
          click: () => mainWindow.webContents.send('menu-language', 'en')
        },
        {
          label: 'العربية',
          click: () => mainWindow.webContents.send('menu-language', 'ar')
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About ' + APP_NAME,
          click: () => showAboutDialog()
        },
        {
          label: 'Documentation',
          click: () => shell.openExternal('https://github.com/abdallahjawadk/antibiogram-analytics')
        },
        { type: 'separator' },
        {
          label: 'Check for Updates',
          click: () => mainWindow.webContents.send('menu-check-updates')
        },
        { type: 'separator' },
        {
          label: 'Report Issue',
          click: () => shell.openExternal('https://github.com/abdallahjawadk/antibiogram-analytics/issues')
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Show About dialog
function showAboutDialog() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: `About ${APP_NAME}`,
    message: APP_NAME,
    detail: `Version: ${APP_VERSION}\nAuthor: ${AUTHOR}\n\n${COPYRIGHT}\n\nA comprehensive antimicrobial susceptibility analysis system for generating professional antibiogram charts.\n\nCompatible with Windows 7 SP1 and later.`,
    buttons: ['OK'],
    icon: getIconPath()
  });
}

// App ready event
app.whenReady().then(() => {
  createMainWindow();
  createTray();

  // macOS specific
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// App window all closed event
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// App before quit event
app.on('before-quit', () => {
  app.isQuitting = true;
});

// App will quit event
app.on('will-quit', () => {
  if (tray) {
    tray.destroy();
  }
});

// Handle certificate errors (for development)
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (isDev) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// IPC handlers
ipcMain.handle('get-app-version', () => APP_VERSION);
ipcMain.handle('get-app-name', () => APP_NAME);
ipcMain.handle('get-author', () => AUTHOR);
ipcMain.handle('get-copyright', () => COPYRIGHT);

// File export handlers
ipcMain.handle('save-pdf', async (event, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'antibiogram-report.pdf',
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });
  return result;
});

ipcMain.handle('save-excel', async (event, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'antibiogram-report.xlsx',
    filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }]
  });
  return result;
});

// Native print and save handlers. `window.open()` is deliberately blocked in
// the packaged renderer as part of the navigation hardening, so printable
// reports and charts must be rendered by a controlled, short-lived window.
ipcMain.handle('print-html', async (_event, { html, title }) => {
  const printWindow = new BrowserWindow({
    show: false,
    parent: mainWindow || undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return new Promise((resolve) => {
    printWindow.webContents.print({ silent: false, printBackground: true, title: title || APP_NAME }, (success, failureReason) => {
      if (!printWindow.isDestroyed()) printWindow.close();
      resolve({ success, failureReason: failureReason || null });
    });
  });
});

ipcMain.handle('save-file', async (_event, { defaultName, content, filters }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: filters || [{ name: 'All Files', extensions: ['*'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.promises.writeFile(result.filePath, content, 'utf8');
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('open-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Excel Files', extensions: ['xlsx', 'xls'] }
    ]
  });
  return result;
});

ipcMain.handle('show-message', async (event, options) => {
  return dialog.showMessageBox(mainWindow, options);
});

// Process arguments
if (process.argv.length > 1) {
  // Handle command line arguments for file association
  const filePath = process.argv[1];
  if (fs.existsSync(filePath) && (filePath.endsWith('.xlsx') || filePath.endsWith('.xls'))) {
    mainWindow?.webContents?.send('file-opened', filePath);
  }
}

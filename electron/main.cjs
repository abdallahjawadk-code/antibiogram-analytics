/**
 * Antibiogram Analytics System - Desktop Application
 *
 * A comprehensive antimicrobial susceptibility analysis system
 * for generating professional antibiogram charts.
 *
 * @copyright 2026 Abdallahjawadk
 * @author Abdallahjawadk
 * @license Proprietary - All Rights Reserved
 *
 * System Requirements:
 * - Windows 7 SP1 (32-bit/64-bit) or later
 * - Windows 8, 8.1, 10, 11
 * - Minimum 2GB RAM
 * - Minimum 500MB disk space
 */

const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const crypto = require('crypto');

let mainWindow = null;
let tray       = null;

const APP_NAME    = 'Antibiogram Analytics';
const APP_VERSION = '1.0.0';
const COPYRIGHT   = '© 2026 Abdallahjawadk. All Rights Reserved.';
const AUTHOR      = 'Abdallahjawadk';

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// ── Runtime integrity checks ─────────────────────────────────────────────────

function enforceIntegrity() {
  if (isDev) return; // skip in development

  // 1. Block running as plain Node.js (fuse covers this but belt-and-suspenders)
  if (process.versions.electron === undefined) {
    process.exit(1);
  }

  // 2. Ensure the app is running from its installed location (not extracted/copied)
  const execPath = process.execPath.toLowerCase();
  const tmpPaths = [
    os.tmpdir().toLowerCase(),
    'appdata\\local\\temp',
    '/tmp/',
    '\\temp\\',
  ];
  for (const t of tmpPaths) {
    if (execPath.includes(t)) {
      dialog.showErrorBox('Security Error', 'Please install and run the application from its installer.');
      app.exit(1);
      return;
    }
  }

  // 3. Verify the asar archive exists and is not zero-length
  const asarPath = path.join(process.resourcesPath, 'app.asar');
  try {
    const st = fs.statSync(asarPath);
    if (st.size < 1024) throw new Error('asar too small');
  } catch {
    dialog.showErrorBox('Integrity Error', 'Application files are corrupted. Please reinstall.');
    app.exit(1);
    return;
  }

  // 4. Verify install registry marker matches actual location (Windows only)
  if (process.platform === 'win32') {
    try {
      // Soft check only - registry not always accessible in all environments
      const { execSync } = require('child_process');
      const regVal = execSync(
        'reg query "HKCU\\Software\\Abdallahjawadk\\AntibiogramAnalytics" /v InstallPath 2>nul',
        { encoding: 'utf8', timeout: 2000 }
      ).trim();
      if (regVal && !regVal.includes('ERROR')) {
        const match = regVal.match(/InstallPath\s+REG_SZ\s+(.+)/);
        if (match) {
          const registeredPath = match[1].trim().toLowerCase();
          const actualPath = path.dirname(process.execPath).toLowerCase();
          if (!actualPath.startsWith(registeredPath.slice(0, Math.min(20, registeredPath.length)))) {
            // Path mismatch — possible copy-and-run attack. Log only, don't block.
            console.warn('[integrity] Path mismatch - registered vs actual.');
          }
        }
      }
    } catch { /* registry check is optional */ }
  }
}

// Anti-debug: detect debugger attachment in production
function checkAntiDebug() {
  if (isDev) return;
  // Electron's inspector port: if something is debugging the main process, refuse
  if (process.debugPort || process.env.ELECTRON_ENABLE_LOGGING) {
    app.exit(0);
  }
}

// ── Icon helper ──────────────────────────────────────────────────────────────
function getIconPath() {
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  return path.join(__dirname, 'assets', iconFile);
}

// ── Main window ──────────────────────────────────────────────────────────────
function createMainWindow() {
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
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      // Block DevTools in production
      devTools: isDev,
    },
    frame: true,
    backgroundColor: '#f8fafc',
    show: false,
    autoHideMenuBar: false,
  });

  // Disable DevTools in production via keyboard and menu
  if (!isDev) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (
        (input.control && input.shift && input.key === 'I') ||
        (input.control && input.shift && input.key === 'J') ||
        (input.control && input.key === 'U') ||
        input.key === 'F12'
      ) {
        event.preventDefault();
      }
    });
  }

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Block external navigation
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

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('close', (event) => {
    if (app.isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  createApplicationMenu();
}

// ── System tray ──────────────────────────────────────────────────────────────
function createTray() {
  const icon = nativeImage.createFromPath(getIconPath());
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  const contextMenu = Menu.buildFromTemplate([
    { label: APP_NAME, enabled: false },
    { type: 'separator' },
    {
      label: 'Open',
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
        else createMainWindow();
      }
    },
    { label: 'Exit', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) mainWindow.hide();
      else { mainWindow.show(); mainWindow.focus(); }
    }
  });
}

// ── Application menu ─────────────────────────────────────────────────────────
function createApplicationMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Hospital',   accelerator: 'CmdOrCtrl+N', click: () => mainWindow.webContents.send('menu-new-hospital') },
        {
          label: 'Import Data',    accelerator: 'CmdOrCtrl+I',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openFile'],
              filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }]
            });
            if (!result.canceled && result.filePaths.length > 0)
              mainWindow.webContents.send('menu-import-file', result.filePaths[0]);
          }
        },
        { type: 'separator' },
        {
          label: 'Export Report',
          submenu: [
            { label: 'Export as PDF',   click: () => mainWindow.webContents.send('menu-export-pdf') },
            { label: 'Export as Excel', click: () => mainWindow.webContents.send('menu-export-excel') },
            { label: 'Export as Word',  click: () => mainWindow.webContents.send('menu-export-word') },
          ]
        },
        { type: 'separator' },
        { label: 'Print', accelerator: 'CmdOrCtrl+P', click: () => mainWindow.webContents.send('menu-print') },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Dashboard',   accelerator: 'CmdOrCtrl+1', click: () => mainWindow.webContents.send('menu-navigate', 'dashboard') },
        { label: 'Hospitals',   accelerator: 'CmdOrCtrl+2', click: () => mainWindow.webContents.send('menu-navigate', 'hospitals') },
        { label: 'Antibiogram', accelerator: 'CmdOrCtrl+3', click: () => mainWindow.webContents.send('menu-navigate', 'antibiogram') },
        { label: 'Comparison',  accelerator: 'CmdOrCtrl+4', click: () => mainWindow.webContents.send('menu-navigate', 'comparison') },
        { label: 'Trends',      accelerator: 'CmdOrCtrl+5', click: () => mainWindow.webContents.send('menu-navigate', 'trends') },
        { label: 'Alerts',      accelerator: 'CmdOrCtrl+6', click: () => mainWindow.webContents.send('menu-navigate', 'alerts') },
        { type: 'separator' },
        { label: 'Toggle Full Screen', accelerator: 'F11', click: () => mainWindow.setFullScreen(!mainWindow.isFullScreen()) },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        ...(isDev ? [{ role: 'toggleDevTools' }] : [])
      ]
    },
    {
      label: 'Language',
      submenu: [
        { label: 'English',   click: () => mainWindow.webContents.send('menu-language', 'en') },
        { label: 'العربية', click: () => mainWindow.webContents.send('menu-language', 'ar') }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'About ' + APP_NAME, click: () => showAboutDialog() },
        { label: 'Documentation', click: () => shell.openExternal('https://github.com/abdallahjawadk-code/antibiogram-analytics') },
        { type: 'separator' },
        { label: 'Check for Updates', click: () => mainWindow.webContents.send('menu-check-updates') },
        { type: 'separator' },
        { label: 'Report Issue', click: () => shell.openExternal('https://github.com/abdallahjawadk-code/antibiogram-analytics/issues') }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showAboutDialog() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: `About ${APP_NAME}`,
    message: APP_NAME,
    detail: `Version: ${APP_VERSION}\nAuthor: ${AUTHOR}\n\n${COPYRIGHT}\n\nA comprehensive antimicrobial susceptibility analysis system.\n\nCompatible with Windows 7 SP1 and later.`,
    buttons: ['OK'],
    icon: getIconPath()
  });
}

// ── Single instance lock ──────────────────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  checkAntiDebug();
  enforceIntegrity();
  createMainWindow();
  createTray();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit',       () => { app.isQuitting = true; });
app.on('will-quit',         () => { if (tray) tray.destroy(); });

// Certificate errors: only allow in dev
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (isDev) { event.preventDefault(); callback(true); }
  else callback(false);
});

// ── IPC handlers ──────────────────────────────────────────────────────────────
ipcMain.handle('get-app-version',  () => APP_VERSION);
ipcMain.handle('get-app-name',     () => APP_NAME);
ipcMain.handle('get-author',       () => AUTHOR);
ipcMain.handle('get-copyright',    () => COPYRIGHT);

ipcMain.handle('save-pdf', async (event, defaultName) => {
  return dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'antibiogram-report.pdf',
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });
});

ipcMain.handle('save-excel', async (event, defaultName) => {
  return dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'antibiogram-report.xlsx',
    filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }]
  });
});

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
    printWindow.webContents.print(
      { silent: false, printBackground: true, title: title || APP_NAME },
      (success, failureReason) => {
        if (!printWindow.isDestroyed()) printWindow.close();
        resolve({ success, failureReason: failureReason || null });
      }
    );
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
  return dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }]
  });
});

ipcMain.handle('show-message', async (event, options) => {
  return dialog.showMessageBox(mainWindow, options);
});

// File association: handle .xlsx/.xls passed as argument
if (process.argv.length > 1) {
  const filePath = process.argv[1];
  if (fs.existsSync(filePath) && (filePath.endsWith('.xlsx') || filePath.endsWith('.xls'))) {
    mainWindow?.webContents?.send('file-opened', filePath);
  }
}
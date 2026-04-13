const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

const DATA_DIR = path.join(app.getPath('userData'), 'data');
const FILES = {
  tasks: path.join(DATA_DIR, 'tasks.json'),
  debts: path.join(DATA_DIR, 'debts.json'),
  habits: path.join(DATA_DIR, 'habits.json'),
  settings: path.join(DATA_DIR, 'settings.json')
};

const DEFAULTS = {
  tasks: {},
  debts: [],
  habits: { habits: [], pomodoro: { sessionsToday: 0, lastDate: null, totalMinutes: 0 } },
  settings: { theme: 'dark' }
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    console.error('Failed reading', file, err);
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0a1428',
    title: 'Reinnovation Homes Dashboard',
    icon: path.join(__dirname, 'assets', 'logo.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  ensureDataDir();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('store:get', (_event, key) => {
  if (!FILES[key]) return null;
  return readJson(FILES[key], DEFAULTS[key]);
});

ipcMain.handle('store:set', (_event, key, data) => {
  if (!FILES[key]) return false;
  writeJson(FILES[key], data);
  return true;
});

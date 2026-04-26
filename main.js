const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { TOOL_SCHEMAS, executeTool, buildSystemPrompt } = require('./ai-tools');

const AI_MODEL = 'claude-sonnet-4-5-20241022';

let mainWindow;
let pendingConfirm = null; // { resolve }

const DATA_DIR = path.join(app.getPath('userData'), 'data');
const FILES = {
  tasks: path.join(DATA_DIR, 'tasks.json'),
  habits: path.join(DATA_DIR, 'habits.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
  expenses: path.join(DATA_DIR, 'expenses.json'),
  cashflow: path.join(DATA_DIR, 'cashflow.json'),
  income: path.join(DATA_DIR, 'income.json'),
  notes: path.join(DATA_DIR, 'notes.json'),
  deals: path.join(DATA_DIR, 'deals.json'),
  investors: path.join(DATA_DIR, 'investors.json')
};

const DEFAULTS = {
  tasks: {},
  habits: { habits: [], pomodoro: { sessionsToday: 0, lastDate: null, totalMinutes: 0 } },
  settings: { theme: 'dark' },
  expenses: {},
  cashflow: { startingBalance: 0, startingDate: null },
  income: {},
  notes: {},
  deals: [],
  investors: []
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

/* ------------------- AI COMMAND BAR ------------------- */
function loadApiKey() {
  const locations = [
    path.join(app.getPath('userData'), '.env'),
    path.join(path.dirname(process.execPath), '.env'),
    path.join(__dirname, '.env')
  ];
  for (const loc of locations) {
    try {
      if (!fs.existsSync(loc)) continue;
      const raw = fs.readFileSync(loc, 'utf8');
      const match = raw.match(/ANTHROPIC_API_KEY\s*=\s*(.+)/);
      if (match) return match[1].trim();
    } catch (e) { /* skip */ }
  }
  return null;
}

let anthropicClient = null;
function getClient() {
  if (anthropicClient) return anthropicClient;
  const apiKey = loadApiKey();
  if (!apiKey) return null;
  const Anthropic = require('@anthropic-ai/sdk');
  anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}

const store = { readJson, writeJson, FILES, DEFAULTS };

ipcMain.handle('ai:chat', async (_event, userMessage) => {
  const client = getClient();
  if (!client) return { error: 'No API key. Place a .env file with ANTHROPIC_API_KEY=sk-... next to the app or in ' + app.getPath('userData') };

  const systemPrompt = buildSystemPrompt(store);
  const toolSchemas = TOOL_SCHEMAS.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  let messages = [{ role: 'user', content: userMessage }];

  try {
    let done = false;
    while (!done) {
      const stream = client.messages.stream({
        model: AI_MODEL,
        system: systemPrompt,
        messages,
        tools: toolSchemas,
        max_tokens: 4096
      });

      stream.on('text', (text) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ai:chunk', text);
        }
      });

      const response = await stream.finalMessage();

      const toolUses = response.content.filter(b => b.type === 'tool_use');
      if (toolUses.length === 0) {
        done = true;
        break;
      }

      const toolResults = [];
      for (const tu of toolUses) {
        const schema = TOOL_SCHEMAS.find(t => t.name === tu.name);
        const isMutation = schema && schema.mutates;

        if (isMutation) {
          const desc = schema.describe ? schema.describe(tu.input) : `${tu.name}(${JSON.stringify(tu.input)})`;
          mainWindow.webContents.send('ai:tool-call', {
            id: tu.id, name: tu.name, input: tu.input,
            description: desc, destructive: !!schema.destructive
          });
          const confirmed = await new Promise(resolve => { pendingConfirm = { resolve }; });
          if (!confirmed) {
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: 'User cancelled this action.' });
            continue;
          }
        }

        const result = executeTool(tu.name, tu.input, store);
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) });

        if (isMutation && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ai:data-changed');
        }
      }

      messages = [...messages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: toolResults }
      ];
    }

    return { success: true };
  } catch (err) {
    console.error('AI error:', err);
    return { error: err.message || 'AI request failed' };
  }
});

ipcMain.handle('ai:confirm', (_event, confirmed) => {
  if (pendingConfirm) {
    pendingConfirm.resolve(confirmed);
    pendingConfirm = null;
  }
});

ipcMain.handle('ai:check-key', () => {
  return !!loadApiKey();
});

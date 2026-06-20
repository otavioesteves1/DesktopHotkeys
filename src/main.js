const {
  app, BrowserWindow, globalShortcut, ipcMain,
  shell, clipboard, screen, Notification, Tray, Menu, nativeImage, dialog
} = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const HOTKEY = 'Control+Shift+Alt+P';
const CONFIG_PATH = path.join(app.getAppPath(), 'config.json');

let win = null;
let tray = null;
let suppressBlur = false; // evita fechar no instante em que abre
let editMode = false;     // no modo edição o painel não fecha ao perder o foco

// Garante uma única instância do app rodando.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// ---------- Configuração ----------
// Na primeira vez (sem config.json) cria a partir do modelo config.example.json.
function ensureConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const ex = path.join(app.getAppPath(), 'config.example.json');
    if (fs.existsSync(ex)) fs.copyFileSync(ex, CONFIG_PATH);
  }
}

function getConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw);
}

// ---------- Janela do overlay ----------
function createWindow() {
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.bounds;

  win = new BrowserWindow({
    x, y, width, height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    fullscreenable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Some o overlay se perder o foco (ex.: Alt+Tab).
  win.on('blur', () => {
    if (suppressBlur || editMode) return;
    if (win && win.isVisible()) win.hide();
  });
}

function showOverlay() {
  if (!win) return;

  let config;
  try {
    config = getConfig();
  } catch (e) {
    notify('Erro na configuração', 'Verifique o config.json: ' + e.message);
    return;
  }

  // Abre no monitor onde está o cursor.
  const pt = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(pt);
  win.setBounds(display.bounds);

  editMode = false;
  win.show();
  win.focus();
  suppressBlur = true;
  setTimeout(() => { suppressBlur = false; }, 300);
  win.webContents.send('overlay:open', config);
}

function toggleOverlay() {
  if (win && win.isVisible()) {
    win.webContents.send('overlay:hide'); // renderer anima a saída e depois pede pra esconder
  } else {
    showOverlay();
  }
}

// ---------- Execução das ações ----------
function expandEnv(s) {
  return String(s).replace(/%([^%]+)%/g, (_, n) => process.env[n] || `%${n}%`);
}

function executeAction(a) {
  try {
    if (!a || !a.tipo) return;

    if (a.tipo === 'abrir_url') {
      shell.openExternal(a.url);

    } else if (a.tipo === 'abrir_arquivo') {
      const alvo = expandEnv(a.caminho);
      if (a.argumentos) {
        spawn(`"${alvo}" ${a.argumentos}`, {
          shell: true, detached: true, stdio: 'ignore', windowsHide: true
        }).unref();
      } else {
        shell.openPath(alvo).then(err => {
          if (err) notify('Não foi possível abrir', a.label || alvo);
        });
      }

    } else if (a.tipo === 'executar_comando') {
      const isPwsh = a.shell === 'powershell';
      const exe = isPwsh ? 'powershell.exe' : 'cmd.exe';
      const args = isPwsh ? ['-NoProfile', '-Command', a.comando] : ['/c', a.comando];
      spawn(exe, args, {
        detached: true, stdio: 'ignore', windowsHide: !a.visivel
      }).unref();

    } else if (a.tipo === 'copiar_texto') {
      clipboard.writeText(a.texto || '');

    } else if (a.tipo === 'enviar_teclas') {
      const delay = a.atraso_ms ?? 200;
      const keys = String(a.teclas || '').replace(/'/g, "''");
      const ps = `Start-Sleep -Milliseconds ${delay}; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${keys}')`;
      spawn('powershell.exe', ['-NoProfile', '-Command', ps], {
        detached: true, stdio: 'ignore', windowsHide: true
      }).unref();
    }
  } catch (e) {
    notify('Erro ao executar ação', e.message);
  }
}

// ---------- Bandeja (system tray) ----------
function notify(title, body) {
  try { new Notification({ title, body }).show(); } catch (e) { /* ignore */ }
}

function createTray() {
  const iconPath = path.join(app.getAppPath(), 'assets', 'tray.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) icon = nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('DesktopHotkeys — Ctrl+Shift+Alt+P');

  const menu = Menu.buildFromTemplate([
    { label: 'Abrir painel  (Ctrl+Shift+Alt+P)', click: () => showOverlay() },
    { type: 'separator' },
    { label: 'Editar atalhos (config.json)', click: () => shell.openPath(CONFIG_PATH) },
    { label: 'Abrir pasta do app', click: () => shell.openPath(app.getAppPath()) },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showOverlay());
}

// ---------- IPC (renderer -> main) ----------
ipcMain.on('overlay:doHide', () => {
  if (win) win.hide();
});

ipcMain.on('action:run', (_e, action) => {
  if (win) win.hide();           // esconde antes para devolver o foco ao app de destino
  setTimeout(() => executeAction(action), 50);
});

ipcMain.on('edit:setMode', (_e, on) => { editMode = !!on; });

ipcMain.handle('config:save', (_e, config) => {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  return true;
});

ipcMain.handle('dialog:pickFile', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Escolher programa ou arquivo',
    properties: ['openFile']
  });
  if (win) win.focus();
  return (r.canceled || !r.filePaths.length) ? null : r.filePaths[0];
});

// ---------- Ciclo de vida ----------
app.whenReady().then(() => {
  ensureConfig();
  createWindow();
  createTray();

  const ok = globalShortcut.register(HOTKEY, toggleOverlay);
  if (!ok) {
    notify('Atalho indisponível', 'Ctrl+Shift+Alt+P já está em uso por outro programa.');
  }

  // Autoteste: abre o painel, salva PNGs e fecha. Ligado só por variável de ambiente.
  if (process.env.STREAMDECK_SELFTEST) {
    win.webContents.on('console-message', (_e, _l, msg) => console.log('[renderer]', msg));
    const tmp = app.getPath('temp');
    const shot = async (name) => {
      try {
        const img = await win.webContents.capturePage();
        const out = path.join(tmp, name);
        fs.writeFileSync(out, img.toPNG());
        console.log('SELFTEST_SAVED ' + out);
      } catch (e) { console.log('SELFTEST_ERR ' + e.message); }
    };
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    win.webContents.once('did-finish-load', async () => {
      editMode = true; // não fecha por blur durante o teste
      showOverlay();
      editMode = true;
      await wait(700); await shot('streamdeck_selftest.png');
      await win.webContents.executeJavaScript('toggleEdit();');
      await wait(300); await shot('streamdeck_selftest_edit.png');
      await win.webContents.executeJavaScript('addNew(); document.getElementById("f-acaotipo").value="abrir_arquivo"; document.getElementById("f-acaotipo").dispatchEvent(new Event("change"));');
      await wait(300); await shot('streamdeck_selftest_form.png');
      app.quit();
    });
  }
});

app.on('second-instance', () => showOverlay());
app.on('will-quit', () => globalShortcut.unregisterAll());
// Mantém o app vivo na bandeja mesmo sem janela visível.
app.on('window-all-closed', (e) => { /* não sai */ });

const {
  app, BrowserWindow, globalShortcut, ipcMain,
  shell, clipboard, screen, Notification, Tray, Menu, nativeImage, dialog
} = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const DEFAULT_HOTKEY = 'Control+Shift+Alt+P';
// Em dev o config fica na pasta do projeto; empacotado (.exe) fica numa pasta gravável.
const EXAMPLE_PATH = path.join(app.getAppPath(), 'config.example.json');
const CONFIG_PATH = app.isPackaged
  ? path.join(app.getPath('userData'), 'config.json')
  : path.join(app.getAppPath(), 'config.json');
const STARTUP_LNK = path.join(
  process.env.APPDATA || '',
  'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'DesktopHotkeys.lnk'
);

let win = null;
let tray = null;
let suppressBlur = false; // evita fechar no instante em que abre
let editMode = false;     // no modo edição o painel não fecha ao perder o foco
let hotkey = DEFAULT_HOTKEY;

// Garante uma única instância do app rodando.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// ---------- Configuração ----------
// Na primeira vez (sem config.json) cria a partir do modelo config.example.json.
function ensureConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    if (fs.existsSync(EXAMPLE_PATH)) fs.copyFileSync(EXAMPLE_PATH, CONFIG_PATH);
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

// ---------- Atalho global ----------
function readHotkey() {
  try { return getConfig().atalho || DEFAULT_HOTKEY; } catch (e) { return DEFAULT_HOTKEY; }
}
function prettyKey(accel) {
  return String(accel || '').replace(/Control/g, 'Ctrl').replace(/Super/g, 'Win').split('+').join(' + ');
}
function registerHotkey() {
  globalShortcut.unregisterAll();
  const ok = globalShortcut.register(hotkey, toggleOverlay);
  if (!ok) notify('Atalho indisponível', prettyKey(hotkey) + ' já está em uso por outro programa.');
  return ok;
}
function persistHotkey(accel) {
  try {
    const cfg = getConfig();
    cfg.atalho = accel;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (e) { /* ignore */ }
}

// ---------- Iniciar com o Windows ----------
function psStr(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
function isAutostart() { try { return fs.existsSync(STARTUP_LNK); } catch (e) { return false; } }
function setAutostart(on) {
  if (on) {
    let target, args, workdir;
    if (app.isPackaged) {
      target = process.execPath;                 // o próprio .exe instalado
      args = '';
      workdir = path.dirname(process.execPath);
    } else {
      target = 'C:\\Windows\\System32\\wscript.exe';
      args = '"' + path.join(app.getAppPath(), 'DesktopHotkeys.vbs') + '"';
      workdir = app.getAppPath();
    }
    const ps = '$w=New-Object -ComObject WScript.Shell;$s=$w.CreateShortcut(' + psStr(STARTUP_LNK) +
      ');$s.TargetPath=' + psStr(target) +
      ';$s.Arguments=' + psStr(args) +
      ';$s.WorkingDirectory=' + psStr(workdir) +
      ';$s.IconLocation=' + psStr(process.execPath + ',0') + ';$s.Save()';
    spawn('powershell.exe', ['-NoProfile', '-Command', ps], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } else {
    try { fs.unlinkSync(STARTUP_LNK); } catch (e) { /* ignore */ }
  }
}

// ---------- Bandeja ----------
function openSettings() {
  showOverlay();
  if (win) win.webContents.send('overlay:settings', { atalho: hotkey, autostart: isAutostart() });
}
function openEditHome() {
  showOverlay();
  if (win) win.webContents.send('overlay:editmode');
}

function createTray() {
  const iconPath = path.join(app.getAppPath(), 'assets', 'tray.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.on('click', () => showOverlay());
  refreshTray();
}

function refreshTray() {
  if (!tray) return;
  tray.setToolTip('DesktopHotkeys — ' + prettyKey(hotkey));
  const menu = Menu.buildFromTemplate([
    { label: 'Abrir painel  (' + prettyKey(hotkey) + ')', click: () => showOverlay() },
    { label: '✏️  Editar tela inicial', click: () => openEditHome() },
    { label: '⚙️  Configurações (atalho, iniciar com Windows)…', click: () => openSettings() },
    { type: 'separator' },
    { label: 'Editar atalhos (config.json)', click: () => shell.openPath(CONFIG_PATH) },
    { label: 'Abrir pasta da configuração', click: () => shell.openPath(path.dirname(CONFIG_PATH)) },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
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

ipcMain.handle('dialog:pickImage', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Escolher imagem ou GIF',
    properties: ['openFile'],
    filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'svg'] }]
  });
  if (win) win.focus();
  return (r.canceled || !r.filePaths.length) ? null : r.filePaths[0];
});

ipcMain.handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Escolher pasta',
    properties: ['openDirectory']
  });
  if (win) win.focus();
  return (r.canceled || !r.filePaths.length) ? null : r.filePaths[0];
});

ipcMain.handle('settings:get', () => ({ atalho: hotkey, autostart: isAutostart() }));

ipcMain.handle('settings:setHotkey', (_e, accel) => {
  const prev = hotkey;
  hotkey = accel;
  if (registerHotkey()) {
    persistHotkey(accel);
    refreshTray();
    return { ok: true };
  }
  hotkey = prev;       // não conseguiu registrar; volta pro anterior
  registerHotkey();
  return { ok: false };
});

ipcMain.handle('settings:setAutostart', (_e, on) => { setAutostart(!!on); return !!on; });

// ---------- Ciclo de vida ----------
app.whenReady().then(() => {
  ensureConfig();
  createWindow();
  createTray();

  hotkey = readHotkey();
  registerHotkey();

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
    const shotPanel = async (name) => {
      try {
        const r = await win.webContents.executeJavaScript('(()=>{const p=document.querySelector(".overlay__panel");const b=p.getBoundingClientRect();return {x:Math.max(0,Math.round(b.x)),y:Math.max(0,Math.round(b.y)),width:Math.round(b.width),height:Math.round(b.height)};})()');
        const img = await win.webContents.capturePage(r);
        fs.writeFileSync(path.join(tmp, name), img.toPNG());
        console.log('SELFTEST_PANEL ' + name);
      } catch (e) { console.log('SELFTEST_ERR ' + e.message); }
    };
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    win.webContents.once('did-finish-load', async () => {
      editMode = true; // não fecha por blur durante o teste
      showOverlay();
      editMode = true;
      await wait(700); await shot('streamdeck_selftest.png');
      await win.webContents.executeJavaScript('activateByKey("q"); ');
      await wait(150);
      await win.webContents.executeJavaScript('activateByKey("q");');
      await wait(250); await shot('streamdeck_selftest_repar.png');
      await win.webContents.executeJavaScript('current().label = "Projeto Exemplo - ABC-1234"; render();');
      await wait(150); await shotPanel('readme_hero.png');
      await win.webContents.executeJavaScript('stack = [root]; navDir = "none"; render();');
      await wait(150);
      await win.webContents.executeJavaScript('toggleEdit();');
      await wait(300); await shot('streamdeck_selftest_edit.png'); await shotPanel('readme_edit.png');
      await win.webContents.executeJavaScript('addAt(4); document.getElementById("f-acaotipo").value="abrir_arquivo"; document.getElementById("f-acaotipo").dispatchEvent(new Event("change"));');
      await wait(300); await shot('streamdeck_selftest_form.png');
      await win.webContents.executeJavaScript('showGrid(); openTemplateEditor(); document.getElementById("tm-preset").click();');
      await wait(300); await shot('streamdeck_selftest_tmpl.png');
      await win.webContents.executeJavaScript('showGrid(); current().modelo = AUTODESK_MODEL; render(); openNewProject();');
      await wait(300); await shot('streamdeck_selftest_newproj.png'); await shotPanel('readme_newproj.png');
      await win.webContents.executeJavaScript('showGrid(); openSettingsView({ atalho: "Control+Shift+Alt+P", autostart: true });');
      await wait(250); await shot('streamdeck_selftest_settings.png');
      await win.webContents.executeJavaScript('capturing = true; window.dispatchEvent(new KeyboardEvent("keydown", { key: "q", ctrlKey: true, altKey: true, bubbles: true }));');
      await wait(250); await shot('streamdeck_selftest_settings2.png'); await shotPanel('readme_settings.png');
      app.quit();
    });
  }
});

app.on('second-instance', () => showOverlay());
app.on('will-quit', () => globalShortcut.unregisterAll());
// Mantém o app vivo na bandeja mesmo sem janela visível.
app.on('window-all-closed', (e) => { /* não sai */ });

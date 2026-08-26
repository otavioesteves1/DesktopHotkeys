const {
  app, BrowserWindow, globalShortcut, ipcMain,
  shell, clipboard, screen, Notification, Tray, Menu, nativeImage, dialog
} = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

const DEFAULT_HOTKEY = 'Control+Shift+Alt+P';
const EXAMPLE_PATH = path.join(app.getAppPath(), 'config.example.json');
// META_PATH: sempre em userData — guarda onde o config real está salvo
const META_PATH = path.join(app.getPath('userData'), 'meta.json');
// CONFIG_PATH: localização padrão (userData para empacotado, projeto para dev)
const CONFIG_PATH_DEFAULT = app.isPackaged
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
let floatMode = false;   // janela pequena e móvel (modo edição/config)
let floatBounds = null;  // posição/tamanho lembrados da janela flutuante

// Garante uma única instância do app rodando.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// ---------- Meta (localização portátil do config) ----------
function loadMeta() {
  if (!fs.existsSync(META_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(META_PATH, 'utf8')); } catch { return {}; }
}
function saveMeta(m) {
  fs.writeFileSync(META_PATH, JSON.stringify(m, null, 2), 'utf8');
}
function getConfigPath() {
  const m = loadMeta();
  return m.configPath || CONFIG_PATH_DEFAULT;
}

// ---------- Configuração ----------
// Na primeira vez (sem config.json) cria a partir do modelo config.example.json.
function ensureConfig() {
  const cp = getConfigPath();
  if (!fs.existsSync(cp)) {
    if (fs.existsSync(EXAMPLE_PATH)) {
      try {
        const dir = path.dirname(cp);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(EXAMPLE_PATH, cp);
      } catch {}
    }
  }
}

function getConfig() {
  const raw = fs.readFileSync(getConfigPath(), 'utf-8');
  return JSON.parse(raw);
}

// Primeiro uso empacotado: pergunta onde salvar o config
async function firstRunSetup() {
  if (!app.isPackaged) return; // dev usa pasta do projeto como sempre
  if (fs.existsSync(META_PATH)) return; // já configurado

  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: 'DesktopHotkeys — Configuração inicial',
    message: 'Onde deseja salvar o arquivo de configuração?',
    detail:
      'Escolha "OneDrive / Personalizado" para sincronizar entre computadores.\n' +
      'Escolha "Localização padrão" para usar a pasta de dados local.',
    buttons: ['Localização padrão', 'OneDrive / Personalizado'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });

  let cfgPath = CONFIG_PATH_DEFAULT;

  if (response === 1) {
    const r = await dialog.showSaveDialog({
      title: 'Escolher onde salvar o arquivo de configuração',
      defaultPath: path.join(app.getPath('home'), 'desktophotkeys_config.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!r.canceled && r.filePath) cfgPath = r.filePath;
  }

  if (cfgPath !== CONFIG_PATH_DEFAULT && !fs.existsSync(cfgPath) && fs.existsSync(CONFIG_PATH_DEFAULT)) {
    try {
      const dir = path.dirname(cfgPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(CONFIG_PATH_DEFAULT, cfgPath);
    } catch {}
  }

  saveMeta({ configPath: cfgPath });
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
    movable: true,
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
    if (suppressBlur || editMode || floatMode) return;
    if (win && win.isVisible()) hideOverlay();
  });

  // Lembra onde o usuário deixou a janela flutuante.
  win.on('moved', () => {
    if (floatMode && win) floatBounds = win.getBounds();
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

  // Abre no monitor onde está o cursor, sempre em tela cheia (modo launcher).
  const pt = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(pt);
  floatMode = false;
  win.setMovable(false);
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

// Esconde a janela e manda o renderer resetar pro início (evita "flash" do estado anterior na próxima abertura).
function hideOverlay() {
  if (!win) return;
  win.hide();
  win.webContents.send('overlay:reset');
}

// Alterna entre o painel cheio (launcher) e a janelinha flutuante móvel (edição/config).
function setWindowMode(mode) {
  if (!win) return;
  const disp = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  if (mode === 'float') {
    floatMode = true;
    win.setMovable(true);
    const wa = disp.workArea;
    const w = 470;
    const h = Math.min(720, wa.height - 60);
    let x, y;
    if (floatBounds) { x = floatBounds.x; y = floatBounds.y; }
    else { x = wa.x + Math.round((wa.width - w) / 2); y = wa.y + Math.round((wa.height - h) / 2); }
    win.setBounds({ x, y, width: w, height: h });
  } else {
    floatMode = false;
    win.setMovable(false);
    win.setBounds(disp.bounds);
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
    fs.writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (e) { /* ignore */ }
}

// ---------- Iniciar com o Windows ----------
// Usa a chave de registro HKCU\...\Run (método padrão do Windows, confiável).
const RUN_KEY = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
function psStr(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

function autostartCommand() {
  if (app.isPackaged) {
    // No portátil, process.execPath é a pasta TEMP de extração; use o .exe real que o usuário abriu.
    const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    return '"' + exe + '"';
  }
  return '"C:\\Windows\\System32\\wscript.exe" "' + path.join(app.getAppPath(), 'DesktopHotkeys.vbs') + '"';
}

function isAutostart() {
  try {
    execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v DesktopHotkeys', { stdio: 'ignore' });
    return true;
  } catch (e) { return false; }
}

function setAutostart(on) {
  const ps = on
    ? "Set-ItemProperty -Path '" + RUN_KEY + "' -Name DesktopHotkeys -Value " + psStr(autostartCommand())
    : "Remove-ItemProperty -Path '" + RUN_KEY + "' -Name DesktopHotkeys -ErrorAction SilentlyContinue";
  spawn('powershell.exe', ['-NoProfile', '-Command', ps], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
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
    { label: '⚙️  Configurações…', click: () => openSettings() },
    { type: 'separator' },
    {
      label: 'Iniciar com o Windows',
      type: 'checkbox',
      checked: isAutostart(),
      click: (item) => { setAutostart(item.checked); setTimeout(refreshTray, 800); }
    },
    { type: 'separator' },
    { label: 'Editar atalhos (config.json)',       click: () => shell.openPath(getConfigPath()) },
    { label: 'Abrir pasta da configuração',        click: () => shell.openPath(path.dirname(getConfigPath())) },
    { label: 'Alterar localização do config...',   click: () => changeConfigLocation() },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
}

// ---------- IPC (renderer -> main) ----------
ipcMain.on('overlay:doHide', () => {
  hideOverlay();
});

ipcMain.on('action:run', (_e, action) => {
  hideOverlay();                 // esconde antes para devolver o foco ao app de destino
  setTimeout(() => executeAction(action), 50);
});

ipcMain.on('edit:setMode', (_e, on) => { editMode = !!on; });

ipcMain.on('window:mode', (_e, mode) => setWindowMode(mode));

ipcMain.handle('config:save', (_e, config) => {
  const cp = getConfigPath();
  const dir = path.dirname(cp);
  if (!fs.existsSync(dir)) try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  fs.writeFileSync(cp, JSON.stringify(config, null, 2), 'utf-8');
  return true;
});

ipcMain.handle('config:get-path', () => getConfigPath());

ipcMain.handle('config:set-path', async (_, newPath) => {
  try {
    const oldPath = getConfigPath();
    if (!fs.existsSync(newPath)) {
      const dir = path.dirname(newPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(oldPath)) fs.copyFileSync(oldPath, newPath);
    }
    const meta = loadMeta();
    meta.configPath = newPath;
    saveMeta(meta);
    refreshTray();
    return { ok: true, path: newPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('config:pick-file', async () => {
  const def = loadMeta().configPath || path.join(app.getPath('home'), 'desktophotkeys_config.json');
  const r = await dialog.showSaveDialog(win, {
    title: 'Escolher local para o arquivo de configuração',
    defaultPath: def,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  return r.canceled ? null : r.filePath;
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

// Salva uma imagem colada (Ctrl+V) numa pasta gravável e devolve o caminho.
ipcMain.handle('icon:savePasted', (_e, dataUrl) => {
  try {
    const m = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl || '');
    if (!m) return null;
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const dir = path.join(app.getPath('userData'), 'icons');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'icon_' + Date.now() + '.' + ext);
    fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
    return file;
  } catch (e) { return null; }
});

// Altera a localização do config via dialog (invocado pelo tray)
async function changeConfigLocation() {
  const def = loadMeta().configPath || path.join(app.getPath('home'), 'desktophotkeys_config.json');
  const r = await dialog.showSaveDialog({
    title: 'Escolher local para o arquivo de configuração',
    defaultPath: def,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return;
  const newPath = r.filePath;
  const oldPath = getConfigPath();
  if (!fs.existsSync(newPath) && fs.existsSync(oldPath)) {
    try {
      const dir = path.dirname(newPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(oldPath, newPath);
    } catch {}
  }
  const meta = loadMeta();
  meta.configPath = newPath;
  saveMeta(meta);
  refreshTray();
  notify('DesktopHotkeys', 'Localização do config alterada.\nNovo local: ' + newPath);
}

// ---------- Ciclo de vida ----------
app.whenReady().then(async () => {
  await firstRunSetup();
  ensureConfig();
  // Migração: remove o atalho antigo da pasta Startup (agora usamos a chave de registro Run).
  try { fs.unlinkSync(STARTUP_LNK); } catch (e) { /* já não existe */ }
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
      await win.webContents.executeJavaScript('fullConfig.iconHistory=["📄","🤝","🧩","🏗️","👁️","🚧","👥","⚙️"]; addAt(4); document.getElementById("f-acaotipo").value="abrir_arquivo"; document.getElementById("f-acaotipo").dispatchEvent(new Event("change"));');
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

'use strict';

// Layout estilo StarCraft: Q W E R / A S D F / Z X C V  (12 lugares fixos)
const SLOT_KEYS = ['q', 'w', 'e', 'r', 'a', 's', 'd', 'f', 'z', 'x', 'c', 'v'];
const SLOTS = 12;

const EMOJIS = ['🌐','📄','📁','📂','💻','📊','📝','🏠','🏢','🏗️','🔧','📧','☁️','▶️','🤖','👤','⚡','📋','⬇️','✂️','🅰️','🟦','🧮','🗂️','📌','⭐','🔗','⚙️'];
const ACOES = [
  { v: 'abrir_url',        t: 'Abrir site' },
  { v: 'abrir_arquivo',    t: 'Abrir programa / arquivo / pasta' },
  { v: 'executar_comando', t: 'Rodar comando' },
  { v: 'copiar_texto',     t: 'Copiar texto' },
  { v: 'enviar_teclas',    t: 'Enviar teclas' }
];

// Modelo padrão de projeto Autodesk — ordem QWER / ASDF / ZXCV (com 2 espaços vazios)
const AUTODESK_MODEL = [
  { label: 'Arquivos',         tipo: 'abrir_url',     icone: '📄' },
  { label: 'DesignCollab',     tipo: 'abrir_url',     icone: '🤝' },
  { label: 'Model Cord',       tipo: 'abrir_url',     icone: '🧩' },
  { label: 'Modelo',           tipo: 'abrir_url',     icone: '🏗️' },
  { label: 'Problemas',        tipo: 'abrir_url',     icone: '⚠️' },
  { label: 'Vistas',           tipo: 'abrir_url',     icone: '👁️' },
  { label: 'Interferências',   tipo: 'abrir_url',     icone: '🚧' },
  { label: '',                 tipo: 'vazio' },
  { label: 'DesktopConnector', tipo: 'abrir_arquivo', icone: '🗂️' },
  { label: 'Membros',          tipo: 'abrir_url',     icone: '👥' },
  { label: 'Configurações',    tipo: 'abrir_url',     icone: '⚙️' }
];

// ---------- Estado ----------
let fullConfig = null;
let root = null;
let stack = [];
let page = 0;
let navDir = 'none';
let busy = false;

let editMode = false;
let view = 'grid';        // 'grid' | 'form'
let editing = null;       // { node, isNew, index }
let editingTipo = 'acao';
let delArmed = false;
let dragSrc = null;
let tmplWork = [];        // cópia de trabalho do modelo (editor de modelo)
let npWork = [];          // campos do modelo ao criar novo projeto
let capturing = false;    // capturando o atalho nas Configurações
let pendingCombo = null;  // atalho capturado, ainda não salvo
let settingsData = { atalho: '', autostart: false };

// ---------- Elementos ----------
const body = document.body;
const panel = document.getElementById('panel');
const backdrop = document.getElementById('backdrop');
const gridEl = document.getElementById('grid');
const editorEl = document.getElementById('editor');
const breadcrumbEl = document.getElementById('breadcrumb');
const pageindEl = document.getElementById('pageind');
const hintEl = document.getElementById('hint');
const editbtn = document.getElementById('editbtn');
const editbadge = document.getElementById('editbadge');
const btnTmpl = document.getElementById('btn-tmpl');
const btnNewProj = document.getElementById('btn-newproj');
const titlebarClose = document.getElementById('titlebar-close');
let curMode = 'launcher';

// ---------- Utilitários ----------
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function current() { return stack[stack.length - 1]; }
function kids() { return (current() && Array.isArray(current().filhos)) ? current().filhos : []; }
function pageCount() { return Math.max(1, Math.ceil(kids().length / SLOTS)); }

function normalizeFilhos(folder) {
  const a = folder && folder.filhos;
  if (!Array.isArray(a)) return;
  while (a.length && a[a.length - 1] == null) a.pop();
}

function toast(msg) {
  let t = document.getElementById('sd-toast');
  if (!t) { t = document.createElement('div'); t.id = 'sd-toast'; t.className = 'sd-toast'; body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1500);
}

// Aplica as opções de interface (tamanho / posição / fundo) salvas no config.
function applyUI() {
  const ui = (fullConfig && fullConfig.ui) || {};
  const tam = ui.tamanho || 'medio';
  const pos = ui.posicao || 'centro';
  const fun = ui.fundo || 'escuro';
  body.classList.remove('size-pequeno', 'size-medio', 'size-grande', 'pos-centro', 'pos-embaixo', 'bg-escuro', 'bg-leve', 'bg-nenhum');
  body.classList.add('size-' + tam, 'pos-' + pos, 'bg-' + fun);
}

// Janela cheia (launcher) quando navegando; pequena e móvel quando editando/configurando.
function applyWindowMode() {
  const want = (editMode || view !== 'grid') ? 'float' : 'launcher';
  body.classList.toggle('mode-float', want === 'float');
  if (want !== curMode) { curMode = want; window.api.setMode(want); }
}

// Permite colar (Ctrl+V) uma imagem direto no campo: salva e usa o caminho.
// Se for texto/URL, deixa colar normalmente.
function attachImagePaste(inputEl) {
  if (!inputEl) return;
  inputEl.addEventListener('paste', async (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) {
      if (it.type && it.type.indexOf('image') === 0) {
        e.preventDefault();
        const file = it.getAsFile();
        if (!file) return;
        const dataUrl = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
        const p = await window.api.savePastedImage(dataUrl);
        if (p) { inputEl.value = p; toast('Imagem colada ✓'); }
        return;
      }
    }
  });
}

// ---------- Ícone ----------
function iconHTML(tile) {
  const ic = tile.icone;
  if (ic) {
    if (/[\\/]/.test(ic) || /^https?:/i.test(ic)) {
      const src = /^https?:/i.test(ic) ? ic : 'file:///' + ic.replace(/\\/g, '/');
      return `<img class="tile__img" src="${esc(src)}" alt="">`;
    }
    return esc(ic);
  }
  if (tile.tipo === 'pasta') return '📁';
  const t = tile.acao && tile.acao.tipo;
  if (t === 'abrir_url') return '🌐';
  if (t === 'abrir_arquivo') return '📄';
  if (t === 'copiar_texto') return '📋';
  if (t === 'executar_comando') return '⚙️';
  return '⚡';
}

// ---------- Render da grade ----------
function render() {
  const all = kids();
  const pages = pageCount();
  if (page >= pages) page = pages - 1;
  if (page < 0) page = 0;

  // Breadcrumb
  breadcrumbEl.innerHTML = '';
  if (stack.length > 1) {
    stack.forEach((node, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'breadcrumb__sep';
        breadcrumbEl.appendChild(sep);
      }
      const item = document.createElement('span');
      const isLast = i === stack.length - 1;
      item.className = 'breadcrumb__item' + (isLast ? ' breadcrumb__item--current' : '');
      item.textContent = node.label || 'Início';
      if (!isLast) item.addEventListener('click', () => goToDepth(i));
      breadcrumbEl.appendChild(item);
    });
  }

  gridEl.classList.remove('nav-in', 'nav-out', 'nav-none');
  void gridEl.offsetWidth;
  gridEl.classList.add(navDir === 'in' ? 'nav-in' : navDir === 'out' ? 'nav-out' : 'nav-none');
  navDir = 'none';

  const start = page * SLOTS;
  let html = '';
  for (let i = 0; i < SLOTS; i++) {
    const gi = start + i;
    const key = SLOT_KEYS[i].toUpperCase();
    const item = all[gi];
    if (item) {
      const isFolder = item.tipo === 'pasta';
      html += `<div class="tile ${isFolder ? 'tile--folder' : ''}" data-index="${gi}" ${editMode ? 'draggable="true"' : ''}>
        <span class="tile__key">${key}</span>
        <div class="tile__icon">${iconHTML(item)}</div>
        <div class="tile__label" title="${esc(item.label)}">${esc(item.label)}</div>
        ${isFolder ? '<span class="tile__chevron">›</span>' : ''}
      </div>`;
    } else if (editMode) {
      html += `<div class="tile tile--add" data-add="${gi}">
        <span class="tile__key">${key}</span><div class="tile__icon">＋</div></div>`;
    } else {
      html += `<div class="tile tile--hole"><span class="tile__key">${key}</span></div>`;
    }
  }
  gridEl.innerHTML = html;

  pageindEl.textContent = pages > 1 ? `Página ${page + 1} de ${pages}  ·  Tab / → muda de página` : '';
  if (editMode) hintEl.textContent = stack.length > 1 ? 'Clique pra editar · arraste pra mover · Esc volta' : 'Clique pra editar · arraste pra mover';
  else hintEl.textContent = stack.length > 1 ? 'Esc volta' : 'Esc fecha';

  const hasModel = Array.isArray(current().modelo) && current().modelo.length > 0;
  btnTmpl.style.display = editMode ? '' : 'none';
  btnNewProj.style.display = (editMode && hasModel) ? '' : 'none';
}

// ---------- Navegação ----------
function goToDepth(i) {
  leaveForm();
  stack = stack.slice(0, i + 1);
  page = 0; navDir = 'out';
  render();
}

function activateIndex(gi, el) {
  const tile = kids()[gi];
  if (!tile) return;
  if (tile.tipo === 'pasta') {
    stack.push(tile); page = 0; navDir = 'in'; render();
  } else {
    if (busy) return;
    busy = true;
    if (el) el.classList.add('tile--pressed');
    setTimeout(() => window.api.runAction(tile.acao), 200);
  }
}

function activateByKey(k) {
  const i = SLOT_KEYS.indexOf(k.toLowerCase());
  if (i < 0) return;
  const gi = page * SLOTS + i;
  const el = gridEl.querySelector(`.tile[data-index="${gi}"]`);
  activateIndex(gi, el);
}

function back() {
  if (stack.length > 1) { stack.pop(); page = 0; navDir = 'out'; render(); }
  else closeWithAnim();
}

function nextPage() { if (page < pageCount() - 1) { page++; navDir = 'none'; render(); } }
function prevPage() { if (page > 0) { page--; navDir = 'none'; render(); } }

function closeWithAnim() {
  if (busy) return;
  busy = true;
  body.classList.remove('is-visible');
  body.classList.add('is-hiding');
  setTimeout(() => window.api.doHide(), 140);
}

// ---------- Reordenar (arrastar) ----------
function moveItem(from, to) {
  if (from === to) return;
  const a = current().filhos;
  while (a.length <= Math.max(from, to)) a.push(null);
  const tmp = a[to] != null ? a[to] : null;
  a[to] = a[from];
  a[from] = tmp;
  normalizeFilhos(current());
  window.api.saveConfig(fullConfig);
  render();
}

// ---------- Modo edição ----------
function toggleEdit() {
  if (view === 'form') leaveForm();
  editMode = !editMode;
  window.api.setEditMode(editMode);
  editbtn.classList.toggle('is-on', editMode);
  editbtn.textContent = editMode ? '✓ Concluir' : '✏️ Editar';
  editbadge.classList.toggle('is-on', editMode);
  showGrid();
}

function showGrid() {
  leaveForm();
  render();
  applyWindowMode();
  panel.focus();
}

function leaveForm() {
  if (editing && editing.isNew) {
    const a = current().filhos;
    if (Array.isArray(a) && a[editing.index] === editing.node) a[editing.index] = null;
    normalizeFilhos(current());
  }
  editing = null; delArmed = false;
  editorEl.classList.remove('is-on');
  editorEl.innerHTML = '';
  gridEl.style.display = '';
  view = 'grid';
}

function addAt(index) {
  const parent = current();
  if (!Array.isArray(parent.filhos)) parent.filhos = [];
  while (parent.filhos.length <= index) parent.filhos.push(null);
  const node = { tipo: 'acao', label: '', icone: '', acao: { tipo: 'abrir_url', url: '' } };
  parent.filhos[index] = node;
  openForm(node, true, index);
}

function openForm(node, isNew, index) {
  if (!node) return;
  editing = { node, isNew, index };
  delArmed = false;
  view = 'form';
  gridEl.style.display = 'none';
  editorEl.classList.add('is-on');
  buildForm(node);
  applyWindowMode();
}

// ---------- Formulário ----------
function buildForm(node) {
  editingTipo = node.tipo === 'pasta' ? 'pasta' : 'acao';
  editorEl.innerHTML = `
    <div class="frow">
      <label class="flabel">Nome</label>
      <input id="f-nome" class="finput" type="text" placeholder="Ex.: Projeto 3" value="${esc(node.label || '')}">
    </div>
    <div class="frow">
      <label class="flabel">Ícone</label>
      <div class="frow-inline">
        <input id="f-icone" class="finput" type="text" placeholder="Emoji, link de imagem, ou Ctrl+V uma imagem" value="${esc(node.icone || '')}">
        <button type="button" id="f-img" class="fbtn">Imagem/GIF...</button>
      </div>
      <div class="fhint">Dica: cole um emoji, cole o link de uma imagem/GIF, ou copie uma imagem e dê <b>Ctrl+V</b> aqui.</div>
      <div class="emojis" id="f-emojis">${EMOJIS.map(e => `<button type="button" data-e="${e}">${e}</button>`).join('')}</div>
    </div>
    <div class="frow">
      <label class="flabel">Tipo do botão</label>
      <div class="seg">
        <button type="button" class="seg__btn ${editingTipo === 'acao' ? 'is-sel' : ''}" data-tipo="acao"><span class="em">⚡</span> Ação</button>
        <button type="button" class="seg__btn folder ${editingTipo === 'pasta' ? 'is-sel' : ''}" data-tipo="pasta"><span class="em">📁</span> Pasta</button>
      </div>
    </div>
    <div id="f-acao-wrap"></div>
    <div class="formbtns">
      <button type="button" id="f-salvar" class="fbtn primary">Salvar</button>
      <button type="button" id="f-cancelar" class="fbtn">Cancelar</button>
      <button type="button" id="f-entrar" class="fbtn ghost" style="display:none">Entrar na pasta →</button>
      <span class="spacer"></span>
      <button type="button" id="f-apagar" class="fbtn danger" style="display:none">Apagar</button>
    </div>`;

  renderAcaoArea(node);

  document.getElementById('f-emojis').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    document.getElementById('f-icone').value = b.dataset.e;
  });
  document.getElementById('f-img').addEventListener('click', async () => {
    const p = await window.api.pickImage();
    if (p) document.getElementById('f-icone').value = p;
  });
  attachImagePaste(document.getElementById('f-icone'));
  editorEl.querySelectorAll('.seg__btn').forEach(b => {
    b.addEventListener('click', () => {
      editingTipo = b.dataset.tipo;
      editorEl.querySelectorAll('.seg__btn').forEach(x => x.classList.toggle('is-sel', x === b));
      renderAcaoArea(node);
    });
  });
  document.getElementById('f-salvar').addEventListener('click', saveForm);
  document.getElementById('f-cancelar').addEventListener('click', () => showGrid());
  document.getElementById('f-entrar').addEventListener('click', enterFolder);
  const apagar = document.getElementById('f-apagar');
  if (!editing.isNew) {
    apagar.style.display = '';
    apagar.addEventListener('click', () => {
      if (!delArmed) {
        delArmed = true; apagar.textContent = 'Confirmar apagar?';
        setTimeout(() => { if (delArmed) { delArmed = false; apagar.textContent = 'Apagar'; } }, 3000);
        return;
      }
      doDelete();
    });
  }

  const nome = document.getElementById('f-nome');
  nome.focus(); nome.select();
}

function renderAcaoArea(node) {
  const wrap = document.getElementById('f-acao-wrap');
  const entrar = document.getElementById('f-entrar');
  if (editingTipo === 'pasta') {
    wrap.innerHTML = `<div class="fhint">📁 Uma pasta abre mais botões dentro dela. Salve e clique em “Entrar na pasta” para adicionar botões aqui dentro.</div>`;
    entrar.style.display = '';
    return;
  }
  entrar.style.display = 'none';
  const ac = node.acao || { tipo: 'abrir_url' };
  const sel = ac.tipo || 'abrir_url';
  wrap.innerHTML = `
    <div class="frow">
      <label class="flabel">O que esse botão faz?</label>
      <select id="f-acaotipo" class="fselect">
        ${ACOES.map(a => `<option value="${a.v}" ${a.v === sel ? 'selected' : ''}>${a.t}</option>`).join('')}
      </select>
    </div>
    <div id="f-fields"></div>`;
  renderFields(sel, ac);
  document.getElementById('f-acaotipo').addEventListener('change', (e) => {
    renderFields(e.target.value, { tipo: e.target.value });
  });
}

function renderFields(tipo, ac) {
  const f = document.getElementById('f-fields');
  if (!f) return;
  if (tipo === 'abrir_url') {
    f.innerHTML = `<div class="frow"><label class="flabel">Endereço (URL)</label>
      <input id="fa-url" class="finput" type="text" placeholder="https://..." value="${esc(ac.url || '')}"></div>`;
  } else if (tipo === 'abrir_arquivo') {
    f.innerHTML = `<div class="frow"><label class="flabel">Programa / arquivo / pasta</label>
      <div class="frow-inline">
        <input id="fa-caminho" class="finput" type="text" placeholder="C:\\...\\programa.exe" value="${esc(ac.caminho || '')}">
        <button type="button" id="fa-procurar" class="fbtn">Procurar...</button>
      </div></div>
      <div class="frow"><label class="flabel">Argumentos (opcional)</label>
      <input id="fa-args" class="finput" type="text" placeholder="(deixe vazio se não precisar)" value="${esc(ac.argumentos || '')}"></div>`;
    document.getElementById('fa-procurar').addEventListener('click', async () => {
      const p = await window.api.pickFile();
      if (p) document.getElementById('fa-caminho').value = p;
    });
  } else if (tipo === 'executar_comando') {
    f.innerHTML = `<div class="frow"><label class="flabel">Comando</label>
      <input id="fa-cmd" class="finput" type="text" placeholder="Ex.: start ms-screenclip:" value="${esc(ac.comando || '')}"></div>
      <div class="frow"><label class="flabel">Onde roda</label>
      <select id="fa-shell" class="fselect">
        <option value="cmd" ${ac.shell !== 'powershell' ? 'selected' : ''}>CMD</option>
        <option value="powershell" ${ac.shell === 'powershell' ? 'selected' : ''}>PowerShell</option>
      </select></div>`;
  } else if (tipo === 'copiar_texto') {
    f.innerHTML = `<div class="frow"><label class="flabel">Texto a copiar</label>
      <textarea id="fa-texto" class="ftext" placeholder="Texto que vai pra área de transferência">${esc(ac.texto || '')}</textarea></div>`;
  } else if (tipo === 'enviar_teclas') {
    f.innerHTML = `<div class="frow"><label class="flabel">Teclas</label>
      <input id="fa-teclas" class="finput" type="text" placeholder="Ex.: ^c  (Ctrl+C)" value="${esc(ac.teclas || '')}">
      <div class="fhint">Formato SendKeys: ^ = Ctrl, + = Shift, % = Alt. Ex.: ^s salva · {ENTER} enter.</div></div>`;
  }
}

function buildAcaoObject() {
  const tipo = document.getElementById('f-acaotipo').value;
  if (tipo === 'abrir_url') return { tipo, url: val('fa-url') };
  if (tipo === 'abrir_arquivo') {
    const o = { tipo, caminho: val('fa-caminho') };
    const a = val('fa-args'); if (a) o.argumentos = a;
    return o;
  }
  if (tipo === 'executar_comando') return { tipo, comando: val('fa-cmd'), shell: document.getElementById('fa-shell').value };
  if (tipo === 'copiar_texto') return { tipo, texto: val('fa-texto') };
  if (tipo === 'enviar_teclas') return { tipo, teclas: val('fa-teclas') };
  return { tipo: 'abrir_url', url: '' };
}

function applyForm(node) {
  node.label = val('f-nome') || 'Sem nome';
  const ic = val('f-icone'); if (ic) node.icone = ic; else delete node.icone;
  if (editingTipo === 'pasta') {
    node.tipo = 'pasta';
    if (!Array.isArray(node.filhos)) node.filhos = [];
    delete node.acao;
  } else {
    node.tipo = 'acao';
    delete node.filhos;
    node.acao = buildAcaoObject();
  }
}

async function saveForm() {
  applyForm(editing.node);
  editing.isNew = false;
  await window.api.saveConfig(fullConfig);
  showGrid();
  toast('Salvo ✓');
}

async function enterFolder() {
  const node = editing.node;
  editingTipo = 'pasta';
  applyForm(node);
  editing.isNew = false;
  await window.api.saveConfig(fullConfig);
  leaveForm();
  stack.push(node); page = 0; navDir = 'in';
  render(); panel.focus();
}

async function doDelete() {
  const a = current().filhos;
  if (Array.isArray(a)) a[editing.index] = null;
  normalizeFilhos(current());
  editing.isNew = false;
  await window.api.saveConfig(fullConfig);
  showGrid();
  toast('Apagado');
}

// ---------- Modelo de projeto ----------
function openTemplateEditor() {
  const folder = current();
  tmplWork = Array.isArray(folder.modelo) ? folder.modelo.map(x => ({ ...x })) : [];
  view = 'tmpl';
  gridEl.style.display = 'none';
  editorEl.classList.add('is-on');
  btnTmpl.style.display = 'none'; btnNewProj.style.display = 'none';
  renderTemplateEditor();
  applyWindowMode();
}

function renderTemplateEditor() {
  const rows = tmplWork.map((f, i) => `
    <div class="trow" data-i="${i}">
      <input class="finput tm-label" type="text" placeholder="Nome do campo" value="${esc(f.label || '')}">
      <select class="fselect tm-tipo">
        <option value="abrir_url" ${(f.tipo !== 'abrir_arquivo' && f.tipo !== 'vazio') ? 'selected' : ''}>Site (link)</option>
        <option value="abrir_arquivo" ${f.tipo === 'abrir_arquivo' ? 'selected' : ''}>Pasta / arquivo</option>
        <option value="vazio" ${f.tipo === 'vazio' ? 'selected' : ''}>Espaço vazio</option>
      </select>
      <button type="button" class="fbtn tm-up" title="Subir">↑</button>
      <button type="button" class="fbtn tm-down" title="Descer">↓</button>
      <button type="button" class="fbtn danger tm-del" title="Remover">✕</button>
    </div>`).join('');
  editorEl.innerHTML = `
    <div class="flabel" style="margin-bottom:10px">Modelo de projeto de <b>${esc(current().label)}</b> — os campos que todo projeto novo vai ter:</div>
    <div id="tm-rows">${rows || '<div class="fhint">Nenhum campo ainda. Adicione ou use o modelo Autodesk.</div>'}</div>
    <div class="frow-inline" style="margin-top:10px">
      <button type="button" id="tm-add" class="fbtn">＋ Adicionar campo</button>
      <button type="button" id="tm-preset" class="fbtn ghost">Usar modelo Autodesk</button>
    </div>
    <div class="formbtns">
      <button type="button" id="tm-salvar" class="fbtn primary">Salvar modelo</button>
      <button type="button" id="tm-cancelar" class="fbtn">Cancelar</button>
    </div>`;

  document.getElementById('tm-add').onclick = () => { syncTmpl(); tmplWork.push({ label: '', tipo: 'abrir_url' }); renderTemplateEditor(); };
  document.getElementById('tm-preset').onclick = () => { tmplWork = AUTODESK_MODEL.map(x => ({ ...x })); renderTemplateEditor(); };
  document.getElementById('tm-salvar').onclick = saveTemplate;
  document.getElementById('tm-cancelar').onclick = () => showGrid();
  editorEl.querySelectorAll('.trow').forEach(row => {
    const i = +row.dataset.i;
    row.querySelector('.tm-up').onclick = () => { syncTmpl(); if (i > 0) { const t = tmplWork[i - 1]; tmplWork[i - 1] = tmplWork[i]; tmplWork[i] = t; } renderTemplateEditor(); };
    row.querySelector('.tm-down').onclick = () => { syncTmpl(); if (i < tmplWork.length - 1) { const t = tmplWork[i + 1]; tmplWork[i + 1] = tmplWork[i]; tmplWork[i] = t; } renderTemplateEditor(); };
    row.querySelector('.tm-del').onclick = () => { syncTmpl(); tmplWork.splice(i, 1); renderTemplateEditor(); };
  });
}

function syncTmpl() {
  editorEl.querySelectorAll('#tm-rows .trow').forEach(row => {
    const i = +row.dataset.i;
    if (!tmplWork[i]) return;
    tmplWork[i].label = row.querySelector('.tm-label').value.trim();
    tmplWork[i].tipo = row.querySelector('.tm-tipo').value;
  });
}

async function saveTemplate() {
  syncTmpl();
  current().modelo = tmplWork.filter(f => f.label || f.tipo === 'vazio');
  await window.api.saveConfig(fullConfig);
  showGrid();
  toast('Modelo salvo ✓');
}

// ---------- Novo projeto pelo modelo ----------
function openNewProject() {
  const folder = current();
  npWork = Array.isArray(folder.modelo) ? folder.modelo : [];
  if (!npWork.length) { toast('Defina um modelo primeiro (botão Modelo)'); return; }
  view = 'newproj';
  gridEl.style.display = 'none';
  editorEl.classList.add('is-on');
  btnTmpl.style.display = 'none'; btnNewProj.style.display = 'none';
  renderNewProject();
  applyWindowMode();
}

function renderNewProject() {
  const fields = npWork.map((f, i) => {
    if (f.tipo === 'vazio') return '';
    const isFolder = f.tipo === 'abrir_arquivo';
    return `<div class="frow">
      <label class="flabel">${f.icone ? esc(f.icone) + ' ' : ''}${esc(f.label)}${isFolder ? ' (pasta)' : ' (link)'}</label>
      <div class="frow-inline">
        <input id="np-f-${i}" class="finput" type="text" placeholder="${isFolder ? 'C:\\\\...\\\\pasta' : 'https://...'}">
        ${isFolder ? `<button type="button" class="fbtn np-folder" data-i="${i}">Procurar pasta...</button>` : ''}
      </div>
    </div>`;
  }).join('');
  editorEl.innerHTML = `
    <div class="frow">
      <label class="flabel">Nome do projeto</label>
      <input id="np-nome" class="finput" type="text" placeholder="Ex.: REPIR-CID">
    </div>
    <div class="frow">
      <label class="flabel">Ícone (opcional)</label>
      <input id="np-icone" class="finput" type="text" placeholder="Cole um emoji" value="🏢">
    </div>
    <div class="flabel" style="margin:6px 0 2px">Links e pastas do projeto:</div>
    ${fields}
    <div class="formbtns">
      <button type="button" id="np-salvar" class="fbtn primary">Criar projeto</button>
      <button type="button" id="np-cancelar" class="fbtn">Cancelar</button>
    </div>`;

  editorEl.querySelectorAll('.np-folder').forEach(b => {
    b.onclick = async () => { const p = await window.api.pickFolder(); if (p) document.getElementById('np-f-' + b.dataset.i).value = p; };
  });
  document.getElementById('np-salvar').onclick = saveNewProject;
  document.getElementById('np-cancelar').onclick = () => showGrid();
  attachImagePaste(document.getElementById('np-icone'));
  document.getElementById('np-nome').focus();
}

async function saveNewProject() {
  const name = val('np-nome') || 'Novo projeto';
  const icone = val('np-icone');
  const children = npWork.map((f, i) => {
    if (f.tipo === 'vazio') return null;
    const v = val('np-f-' + i);
    const node = { tipo: 'acao', label: f.label };
    if (f.icone) node.icone = f.icone;
    if (f.tipo === 'abrir_arquivo') node.acao = { tipo: 'abrir_arquivo', caminho: v };
    else node.acao = { tipo: 'abrir_url', url: v };
    return node;
  });
  const folderNode = { tipo: 'pasta', label: name, filhos: children };
  if (icone) folderNode.icone = icone;
  const parent = current();
  if (!Array.isArray(parent.filhos)) parent.filhos = [];
  let idx = parent.filhos.findIndex(x => x == null);
  if (idx < 0) idx = parent.filhos.length;
  parent.filhos[idx] = folderNode;
  await window.api.saveConfig(fullConfig);
  showGrid();
  toast('Projeto criado ✓');
}

// ---------- Configurações ----------
function openSettingsView(data) {
  if (data) settingsData = { atalho: data.atalho || '', autostart: !!data.autostart };
  pendingCombo = null; capturing = false;
  view = 'settings';
  gridEl.style.display = 'none';
  editorEl.classList.add('is-on');
  btnTmpl.style.display = 'none'; btnNewProj.style.display = 'none';
  renderSettings();
  applyWindowMode();
}

function prettyAccel(a) {
  return String(a || '').replace(/Control/g, 'Ctrl').replace(/Super/g, 'Win').split('+').join(' + ');
}

function mainKey(e) {
  const k = e.key;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return null;
  if (k === ' ') return 'Space';
  if (/^[a-z]$/i.test(k)) return k.toUpperCase();
  if (/^[0-9]$/.test(k)) return k;
  if (/^F\d{1,2}$/.test(k)) return k;
  const map = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Return', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown' };
  if (map[k]) return map[k];
  if (k.length === 1) return k.toUpperCase();
  return null;
}

function captureKey(e) {
  e.preventDefault();
  const key = mainKey(e);
  if (!key) return; // só apertou modificador; espera a tecla principal
  const isF = /^F\d{1,2}$/.test(key);
  if (!(e.ctrlKey || e.altKey || e.metaKey) && !isF) {
    setCaptureMsg('Use Ctrl, Alt ou Win junto com a tecla (ou uma tecla F).');
    return;
  }
  const mods = [];
  if (e.ctrlKey) mods.push('Control');
  if (e.shiftKey) mods.push('Shift');
  if (e.altKey) mods.push('Alt');
  if (e.metaKey) mods.push('Super');
  pendingCombo = mods.concat(key).join('+');
  capturing = false;
  renderSettings();
}

function setCaptureMsg(m) { const el = document.getElementById('set-msg'); if (el) el.textContent = m; }

function renderSettings() {
  const cur = pendingCombo || settingsData.atalho;
  const ui = (fullConfig && fullConfig.ui) || {};
  const tam = ui.tamanho || 'medio', pos = ui.posicao || 'centro', fun = ui.fundo || 'escuro';
  const seg = (k, v, sel, label) => `<button type="button" class="seg__btn ${v === sel ? 'is-sel' : ''}" data-ui="${k}" data-val="${v}">${label}</button>`;
  editorEl.innerHTML = `
    <div class="frow">
      <label class="flabel">Atalho para abrir o painel</label>
      <div class="frow-inline">
        <div class="keycap ${capturing ? 'rec' : ''}" id="set-key">${capturing ? 'Aperte as teclas…' : esc(prettyAccel(cur) || '—')}</div>
        <button type="button" id="set-rec" class="fbtn">${capturing ? 'Cancelar' : 'Mudar atalho'}</button>
      </div>
      <div class="fhint" id="set-msg">Use Ctrl, Alt ou Win + uma tecla. Ex.: Ctrl + Espaço, Alt + Q.</div>
    </div>
    <div class="frow">
      <label class="flabel" style="cursor:pointer">
        <input type="checkbox" id="set-auto" ${settingsData.autostart ? 'checked' : ''} style="vertical-align:-2px;margin-right:8px">
        Iniciar junto com o Windows
      </label>
    </div>
    <div class="overlay__divider" style="margin:4px 0 14px"></div>
    <div class="frow">
      <label class="flabel">Tamanho do painel</label>
      <div class="seg">
        ${seg('tamanho', 'pequeno', tam, 'Pequeno')}
        ${seg('tamanho', 'medio', tam, 'Médio')}
        ${seg('tamanho', 'grande', tam, 'Grande')}
      </div>
    </div>
    <div class="frow">
      <label class="flabel">Posição</label>
      <div class="seg">
        ${seg('posicao', 'centro', pos, 'Centro')}
        ${seg('posicao', 'embaixo', pos, 'Embaixo')}
      </div>
    </div>
    <div class="frow">
      <label class="flabel">Fundo (foco)</label>
      <div class="seg">
        ${seg('fundo', 'escuro', fun, 'Escuro')}
        ${seg('fundo', 'leve', fun, 'Leve')}
        ${seg('fundo', 'nenhum', fun, 'Nenhum')}
      </div>
    </div>
    <div class="fhint">As opções de interface valem no painel cheio — abra com o atalho pra ver.</div>
    <div class="formbtns">
      <button type="button" id="set-salvar" class="fbtn primary">Salvar e fechar</button>
      <button type="button" id="set-fechar" class="fbtn">Fechar</button>
    </div>`;

  document.getElementById('set-rec').onclick = () => {
    capturing = !capturing;
    if (capturing) pendingCombo = null;
    renderSettings();
    panel.focus();
  };
  editorEl.querySelectorAll('[data-ui]').forEach(b => {
    b.onclick = async () => {
      const k = b.dataset.ui, v = b.dataset.val;
      if (!fullConfig.ui) fullConfig.ui = {};
      fullConfig.ui[k] = v;
      editorEl.querySelectorAll('[data-ui="' + k + '"]').forEach(x => x.classList.toggle('is-sel', x === b));
      applyUI();
      await window.api.saveConfig(fullConfig);
    };
  });
  document.getElementById('set-salvar').onclick = saveSettings;
  document.getElementById('set-fechar').onclick = () => closeWithAnim();
  panel.focus();
}

async function saveSettings() {
  const auto = document.getElementById('set-auto').checked;
  if (auto !== settingsData.autostart) {
    await window.api.setAutostart(auto);
    settingsData.autostart = auto;
  }
  if (pendingCombo && pendingCombo !== settingsData.atalho) {
    const r = await window.api.setHotkey(pendingCombo);
    if (!(r && r.ok)) { setCaptureMsg('Esse atalho está em uso por outro programa. Tente outro.'); return; }
    settingsData.atalho = pendingCombo; pendingCombo = null;
  }
  closeWithAnim();
}

// ---------- Teclado ----------
window.addEventListener('keydown', (e) => {
  if (capturing) { captureKey(e); return; }
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select';

  if ((e.ctrlKey || e.metaKey) && (e.key === 'e' || e.key === 'E')) {
    e.preventDefault(); toggleEdit(); return;
  }

  if (typing || view !== 'grid') {
    if (e.key === 'Escape') { e.preventDefault(); showGrid(); }
    return;
  }

  if (busy) { e.preventDefault(); return; }

  if (editMode) {
    if (e.key === 'Escape' || e.key === 'Backspace') {
      e.preventDefault();
      if (stack.length > 1) { stack.pop(); page = 0; navDir = 'out'; render(); }
      else toggleEdit();
    }
    return;
  }

  const k = e.key;
  if (k === 'Escape') { e.preventDefault(); back(); return; }
  if (k === 'Backspace') { e.preventDefault(); back(); return; }
  if (k === 'Tab') { e.preventDefault(); if (e.shiftKey) prevPage(); else nextPage(); return; }
  if (k === 'ArrowRight') { e.preventDefault(); nextPage(); return; }
  if (k === 'ArrowLeft') { e.preventDefault(); prevPage(); return; }
  if (k === 'Home') { e.preventDefault(); stack = [root]; page = 0; navDir = 'out'; render(); return; }
  if (k.length === 1 && SLOT_KEYS.includes(k.toLowerCase())) { e.preventDefault(); activateByKey(k); }
});

// ---------- Mouse ----------
gridEl.addEventListener('click', (e) => {
  if (view !== 'grid') return;
  const add = e.target.closest('.tile--add');
  if (add && editMode) { addAt(parseInt(add.dataset.add, 10)); return; }
  const tile = e.target.closest('.tile[data-index]');
  if (!tile) return;
  const idx = parseInt(tile.dataset.index, 10);
  if (editMode) openForm(kids()[idx], false, idx);
  else activateIndex(idx, tile);
});
backdrop.addEventListener('click', () => { if (!editMode) closeWithAnim(); });
editbtn.addEventListener('click', toggleEdit);
btnTmpl.addEventListener('click', openTemplateEditor);
btnNewProj.addEventListener('click', openNewProject);
titlebarClose.addEventListener('click', () => closeWithAnim());

// ---------- Arrastar pra reordenar ----------
gridEl.addEventListener('dragstart', (e) => {
  if (!editMode) return;
  const t = e.target.closest('.tile[data-index]');
  if (!t) { e.preventDefault(); return; }
  dragSrc = parseInt(t.dataset.index, 10);
  e.dataTransfer.effectAllowed = 'move';
  t.classList.add('dragging');
});
gridEl.addEventListener('dragover', (e) => {
  if (editMode && dragSrc != null) e.preventDefault();
});
gridEl.addEventListener('drop', (e) => {
  if (!editMode || dragSrc == null) return;
  e.preventDefault();
  const cell = e.target.closest('[data-index],[data-add]');
  if (cell) {
    const to = parseInt(cell.dataset.index != null ? cell.dataset.index : cell.dataset.add, 10);
    moveItem(dragSrc, to);
  }
  dragSrc = null;
});
gridEl.addEventListener('dragend', () => {
  dragSrc = null;
  gridEl.querySelectorAll('.dragging').forEach(x => x.classList.remove('dragging'));
});

// ---------- Ponte com o main ----------
// Ao esconder, volta pro início e fica invisível — evita "flash" do estado anterior ao reabrir.
function resetHidden() {
  if (!root) return;
  capturing = false; busy = false;
  editMode = false; view = 'grid'; editing = null;
  window.api.setEditMode(false);
  editbtn.classList.remove('is-on'); editbtn.textContent = '✏️ Editar';
  editbadge.classList.remove('is-on');
  editorEl.classList.remove('is-on'); editorEl.innerHTML = '';
  gridEl.style.display = '';
  stack = [root]; page = 0; navDir = 'none';
  curMode = 'launcher'; body.classList.remove('mode-float', 'is-visible', 'is-hiding');
  applyUI();
  render();
}

window.api.onReset(() => resetHidden());

window.api.onOpen((config) => {
  fullConfig = config;
  root = config.raiz;
  stack = [root];
  page = 0; navDir = 'none'; busy = false;

  editMode = false; view = 'grid'; editing = null;
  curMode = 'launcher';
  window.api.setEditMode(false);
  editbtn.classList.remove('is-on'); editbtn.textContent = '✏️ Editar';
  editbadge.classList.remove('is-on');
  editorEl.classList.remove('is-on'); editorEl.innerHTML = '';
  gridEl.style.display = '';
  body.classList.remove('mode-float');
  applyUI();

  body.classList.remove('is-hiding');
  panel.style.animation = 'none'; backdrop.style.animation = 'none';
  void panel.offsetWidth;
  panel.style.animation = ''; backdrop.style.animation = '';
  body.classList.add('is-visible');

  render();
  panel.focus();
});

window.api.onHide(() => closeWithAnim());
window.api.onSettings((data) => openSettingsView(data));
window.api.onEditMode(() => { if (!editMode) toggleEdit(); });

'use strict';

const PER_PAGE = 10; // teclas 1..9 e 0

const EMOJIS = ['🌐','📄','📁','📂','💻','📊','📝','🏠','🏢','🏗️','🔧','📧','☁️','▶️','🤖','👤','⚡','📋','⬇️','✂️','🅰️','🟦','🧮','🗂️','📌','⭐','🔗','⚙️'];
const ACOES = [
  { v: 'abrir_url',        t: 'Abrir site' },
  { v: 'abrir_arquivo',    t: 'Abrir programa / arquivo / pasta' },
  { v: 'executar_comando', t: 'Rodar comando' },
  { v: 'copiar_texto',     t: 'Copiar texto' },
  { v: 'enviar_teclas',    t: 'Enviar teclas' }
];

// ---------- Estado ----------
let fullConfig = null;
let root = null;
let stack = [];
let page = 0;
let query = '';
let navDir = 'none';
let busy = false;

let editMode = false;
let view = 'grid';        // 'grid' | 'form'
let editing = null;       // { node, isNew, parent }
let editingTipo = 'acao';
let delArmed = false;

// ---------- Elementos ----------
const body = document.body;
const panel = document.getElementById('panel');
const backdrop = document.getElementById('backdrop');
const gridEl = document.getElementById('grid');
const editorEl = document.getElementById('editor');
const breadcrumbEl = document.getElementById('breadcrumb');
const searchbarEl = document.getElementById('searchbar');
const searchtextEl = document.getElementById('searchtext');
const pageindEl = document.getElementById('pageind');
const hintEl = document.getElementById('hint');
const editbtn = document.getElementById('editbtn');
const editbadge = document.getElementById('editbadge');

// ---------- Utilitários ----------
function norm(s) {
  return String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function current() { return stack[stack.length - 1]; }

function children() {
  const kids = (current() && current().filhos) ? current().filhos : [];
  if (!query) return kids;
  const q = norm(query);
  return kids.filter(k => norm(k.label).includes(q));
}
function pageCount() { return Math.max(1, Math.ceil(children().length / PER_PAGE)); }
function keyLabel(i) { return i === 9 ? '0' : String(i + 1); }
function keyToIndex(k) { return k === '0' ? 9 : (parseInt(k, 10) - 1); }

function toast(msg) {
  let t = document.getElementById('sd-toast');
  if (!t) { t = document.createElement('div'); t.id = 'sd-toast'; t.className = 'sd-toast'; body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1500);
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
  const kids = children();
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

  // Busca
  if (query) { searchbarEl.classList.add('is-active'); searchtextEl.textContent = query; }
  else { searchbarEl.classList.remove('is-active'); }

  // Tiles
  const start = page * PER_PAGE;
  const slice = kids.slice(start, start + PER_PAGE);

  gridEl.classList.remove('nav-in', 'nav-out', 'nav-none');
  void gridEl.offsetWidth;
  gridEl.classList.add(navDir === 'in' ? 'nav-in' : navDir === 'out' ? 'nav-out' : 'nav-none');
  navDir = 'none';

  const addTile = `<div class="tile tile--add" data-add="1">
    <div class="tile__icon">＋</div><div class="tile__label">Adicionar</div></div>`;

  if (kids.length === 0) {
    gridEl.innerHTML = editMode ? addTile :
      `<div class="tile tile--empty"><div class="tile__icon">📂</div>
       <div class="tile__label">${query ? 'Nada encontrado' : 'Pasta vazia'}</div></div>`;
  } else {
    let html = slice.map((tile, i) => {
      const isFolder = tile.tipo === 'pasta';
      return `<div class="tile ${isFolder ? 'tile--folder' : ''}" data-index="${start + i}">
        <span class="tile__number">${keyLabel(i)}</span>
        <div class="tile__icon">${iconHTML(tile)}</div>
        <div class="tile__label" title="${esc(tile.label)}">${esc(tile.label)}</div>
        ${isFolder ? '<span class="tile__chevron">›</span>' : ''}
      </div>`;
    }).join('');
    if (editMode && page === pages - 1) html += addTile;
    gridEl.innerHTML = html;
  }

  // Rodapé
  pageindEl.textContent = pages > 1 ? `Página ${page + 1} de ${pages}  ·  Tab / → muda de página` : '';
  if (editMode) hintEl.textContent = stack.length > 1 ? 'Clique pra editar · Esc volta' : 'Clique pra editar';
  else hintEl.textContent = stack.length > 1 ? 'Esc volta' : 'Esc fecha';
}

// ---------- Navegação ----------
function goToDepth(i) {
  leaveForm();
  stack = stack.slice(0, i + 1);
  page = 0; query = ''; navDir = 'out';
  render();
}

function activateIndex(globalIdx, el) {
  const tile = children()[globalIdx];
  if (!tile) return;
  if (tile.tipo === 'pasta') {
    stack.push(tile); page = 0; query = ''; navDir = 'in'; render();
  } else {
    if (busy) return;
    busy = true;
    if (el) el.classList.add('tile--pressed');
    setTimeout(() => window.api.runAction(tile.acao), 110);
  }
}

function activateByKey(k) {
  const idx = keyToIndex(k);
  if (idx < 0 || idx > 9) return;
  const globalIdx = page * PER_PAGE + idx;
  const el = gridEl.querySelector(`.tile[data-index="${globalIdx}"]`);
  activateIndex(globalIdx, el);
}

function back() {
  if (stack.length > 1) { stack.pop(); page = 0; query = ''; navDir = 'out'; render(); }
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

// ---------- Modo edição ----------
function toggleEdit() {
  if (view === 'form') leaveForm();
  editMode = !editMode;
  window.api.setEditMode(editMode);
  editbtn.classList.toggle('is-on', editMode);
  editbtn.textContent = editMode ? '✓ Concluir' : '✏️ Editar';
  editbadge.classList.toggle('is-on', editMode);
  query = '';
  showGrid();
}

function showGrid() {
  leaveForm();
  render();
  panel.focus();
}

function leaveForm() {
  if (editing && editing.isNew) {
    const p = editing.parent;
    const i = p.filhos.indexOf(editing.node);
    if (i >= 0) p.filhos.splice(i, 1);
  }
  editing = null; delArmed = false;
  editorEl.classList.remove('is-on');
  editorEl.innerHTML = '';
  gridEl.style.display = '';
  view = 'grid';
}

function addNew() {
  const parent = current();
  if (!Array.isArray(parent.filhos)) parent.filhos = [];
  const node = { tipo: 'acao', label: '', icone: '', acao: { tipo: 'abrir_url', url: '' } };
  parent.filhos.push(node);
  openForm(node, true);
}

function openForm(node, isNew) {
  if (!node) return;
  editing = { node, isNew, parent: current() };
  delArmed = false;
  view = 'form';
  gridEl.style.display = 'none';
  editorEl.classList.add('is-on');
  buildForm(node);
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
      <input id="f-icone" class="finput" type="text" placeholder="Cole um emoji (ou um caminho de imagem)" value="${esc(node.icone || '')}">
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
  editorEl.querySelectorAll('.seg__btn').forEach(b => {
    b.addEventListener('click', () => {
      editingTipo = b.dataset.tipo;
      editorEl.querySelectorAll('.seg__btn').forEach(x => x.classList.toggle('is-sel', x === b));
      renderAcaoArea(node);
    });
  });
  document.getElementById('f-salvar').addEventListener('click', saveForm);
  document.getElementById('f-cancelar').addEventListener('click', () => { showGrid(); });
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
  stack.push(node); page = 0; query = ''; navDir = 'in';
  render(); panel.focus();
}

async function doDelete() {
  const p = editing.parent;
  const i = p.filhos.indexOf(editing.node);
  if (i >= 0) p.filhos.splice(i, 1);
  editing.isNew = false; // já removido; não remover de novo no leaveForm
  await window.api.saveConfig(fullConfig);
  showGrid();
  toast('Apagado');
}

// ---------- Teclado ----------
window.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select';

  if ((e.ctrlKey || e.metaKey) && (e.key === 'e' || e.key === 'E')) {
    e.preventDefault(); toggleEdit(); return;
  }

  if (typing || view === 'form') {
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
  if (k === 'Escape') { e.preventDefault(); if (query) { query = ''; render(); } else back(); return; }
  if (k === 'Backspace') { e.preventDefault(); if (query) { query = query.slice(0, -1); page = 0; render(); } else back(); return; }
  if (k === 'Tab') { e.preventDefault(); if (e.shiftKey) prevPage(); else nextPage(); return; }
  if (k === 'ArrowRight') { e.preventDefault(); nextPage(); return; }
  if (k === 'ArrowLeft') { e.preventDefault(); prevPage(); return; }
  if (k === 'Home' || k === '`') { e.preventDefault(); stack = [root]; page = 0; query = ''; navDir = 'out'; render(); return; }
  if (/^[0-9]$/.test(k)) { e.preventDefault(); activateByKey(k); return; }
  if (k.length === 1 && /\p{L}/u.test(k)) { query += k.toLowerCase(); page = 0; render(); }
});

// ---------- Mouse ----------
gridEl.addEventListener('click', (e) => {
  if (view !== 'grid') return;
  const el = e.target.closest('.tile');
  if (!el) return;
  if (el.classList.contains('tile--add')) { addNew(); return; }
  if (el.classList.contains('tile--empty')) return;
  const idx = parseInt(el.dataset.index, 10);
  if (editMode) openForm(children()[idx], false);
  else activateIndex(idx, el);
});
backdrop.addEventListener('click', () => { if (!editMode) closeWithAnim(); });
editbtn.addEventListener('click', toggleEdit);

// ---------- Ponte com o main ----------
window.api.onOpen((config) => {
  fullConfig = config;
  root = config.raiz;
  stack = [root];
  page = 0; query = ''; navDir = 'none'; busy = false;

  editMode = false; view = 'grid'; editing = null;
  window.api.setEditMode(false);
  editbtn.classList.remove('is-on'); editbtn.textContent = '✏️ Editar';
  editbadge.classList.remove('is-on');
  editorEl.classList.remove('is-on'); editorEl.innerHTML = '';
  gridEl.style.display = '';

  body.classList.remove('is-hiding');
  panel.style.animation = 'none'; backdrop.style.animation = 'none';
  void panel.offsetWidth;
  panel.style.animation = ''; backdrop.style.animation = '';
  body.classList.add('is-visible');

  render();
  panel.focus();
});

window.api.onHide(() => closeWithAnim());

import { FIELDS, PAGE, layoutPage, fileNameFor, splitLines } from './layout.js';
import { buildPdf, drawPreview, makeMeasure } from './render.js';
import {
  loadDb, saveDb, blankEntry, sampleEntry, uid, putFile, getFile, collectGarbage,
  buildBackup, parseBackup,
} from './db.js';
import {
  loadFonts, loadLogos, loadPictos, toBitmap, normalizePhoto, guessRole, storeFont,
  clearStoredFonts, FONT_ROLES,
} from './assets.js';
import { makeEntry, writeZip } from '../../js/zip.js';

const { PDFLib, fontkit } = globalThis;
const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  entries: [],
  currentId: null,
  fonts: null,      // { source, name, regular, semibold, bold }
  measure: null,
  families: null,   // noms des FontFace pour l'aperçu
  logos: {},        // { 1: {bytes,url}, 2: … }
  pictos: {},       // { 'picto-…': bytes }
  bitmaps: new Map(), // clé → ImageBitmap (aperçu)
  busy: false,
};

// ------------------------------------------------------------ utilitaires
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function download(bytes, name, type) {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}h${p(d.getMinutes())}`;
}

function formatSize(n) {
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} Mo`;
  return `${Math.max(1, Math.round(n / 1e3))} ko`;
}

const current = () => state.entries.find((e) => e.id === state.currentId) || null;
const titleOf = (e) => splitLines(e.titre).join(' ') || 'Fiche sans titre';

// ------------------------------------------------------------ enregistrement
const statusEl = $('#save-status');
function persist() {
  try {
    saveDb({ entries: state.entries });
    const d = new Date();
    statusEl.textContent = `Enregistré dans ce navigateur à ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    statusEl.classList.remove('error');
  } catch (e) {
    console.error(e);
    statusEl.textContent = '⚠ Enregistrement local impossible (stockage plein ?). Faites une sauvegarde dans un fichier.';
    statusEl.classList.add('error');
  }
}
const persistSoon = debounce(persist, 300);

// ------------------------------------------------------------ liste des fiches
const listEl = $('#entries');

function warningsFor(entry) {
  if (!state.measure) return [];
  try { return layoutPage(entry, state.measure).warnings; } catch { return []; }
}

function renderList() {
  listEl.textContent = '';
  state.entries.forEach((e, i) => {
    const warns = warningsFor(e);
    const badges = [
      el('span', { class: 'badge', text: `Logo ${e.logo}` }),
      e.photo ? el('span', { class: 'badge ok', text: 'Image' }) : el('span', { class: 'badge off', text: 'Sans image' }),
      e.annex ? el('span', { class: 'badge ok', text: `+ PDF${e.annex.pages ? ` ${e.annex.pages} p.` : ''}` }) : null,
      warns.length ? el('span', { class: 'badge warn', title: warns.map((w) => w.message).join('\n'), text: `⚠ ${warns.length}` }) : null,
    ];
    const li = el('li', { class: 'entry' + (e.id === state.currentId ? ' active' : ''), 'data-id': e.id },
      el('input', {
        type: 'checkbox', class: 'sel', 'aria-label': `Cocher « ${titleOf(e)} »`, checked: e.selected,
        onchange: (ev) => { e.selected = ev.target.checked; persistSoon(); updateSelectionInfo(); },
      }),
      el('button', { type: 'button', class: 'entry-main', onclick: () => selectEntry(e.id) },
        el('span', { class: 'num', text: String(i + 1) }),
        el('span', { class: 'entry-text' },
          el('span', { class: 'entry-title', text: titleOf(e) }),
          el('span', { class: 'badges' }, badges),
        ),
      ),
      el('span', { class: 'row-actions' },
        el('button', { type: 'button', class: 'icon', title: 'Télécharger le PDF de cette fiche', 'aria-label': 'Télécharger le PDF', onclick: () => generate([e]) }, 'PDF'),
        el('button', { type: 'button', class: 'icon', title: 'Monter', 'aria-label': 'Monter', disabled: i === 0, onclick: () => move(e.id, -1) }, '↑'),
        el('button', { type: 'button', class: 'icon', title: 'Descendre', 'aria-label': 'Descendre', disabled: i === state.entries.length - 1, onclick: () => move(e.id, 1) }, '↓'),
        el('button', { type: 'button', class: 'icon', title: 'Dupliquer', 'aria-label': 'Dupliquer', onclick: () => duplicate(e.id) }, '⧉'),
        el('button', { type: 'button', class: 'icon danger', title: 'Supprimer', 'aria-label': 'Supprimer', onclick: () => removeEntry(e.id) }, '✕'),
      ),
    );
    listEl.append(li);
  });
  $('#count').textContent = `(${state.entries.length})`;
  $('#empty').hidden = state.entries.length > 0;
  updateSelectionInfo();
}

// Simple et fiable : on reconstruit la liste (quelques dizaines de lignes au plus).
const updateRow = () => renderList();
const updateRowSoon = debounce(updateRow, 250);

function updateSelectionInfo() {
  const n = state.entries.filter((e) => e.selected).length;
  $('#sel-count').textContent = n ? `${n} cochée${n > 1 ? 's' : ''}` : '';
  const all = $('#check-all');
  all.checked = n > 0 && n === state.entries.length;
  all.indeterminate = n > 0 && n < state.entries.length;
  $('#btn-gen-sel').disabled = n === 0;
  $('#btn-gen-sel').textContent = n ? `Générer les fiches cochées (${n})` : 'Générer les fiches cochées';
  $('#btn-gen-all').disabled = state.entries.length === 0;
}

function selectEntry(id) {
  state.currentId = id;
  renderList();
  renderForm();
  renderPreview();
}

function addEntry(entry) {
  state.entries.push(entry);
  persist();
  selectEntry(entry.id);
  const first = $('#form textarea');
  if (first) first.focus();
}

function duplicate(id) {
  const src = state.entries.find((e) => e.id === id);
  if (!src) return;
  // Les fichiers (image, PDF annexe) sont partagés : ils ne sont supprimés que s'ils ne sont plus utilisés.
  const copy = { ...structuredClone(src), id: uid('fiche'), selected: false, updated: Date.now() };
  const idx = state.entries.indexOf(src);
  state.entries.splice(idx + 1, 0, copy);
  persist();
  selectEntry(copy.id);
}

function move(id, delta) {
  const i = state.entries.findIndex((e) => e.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= state.entries.length) return;
  const [e] = state.entries.splice(i, 1);
  state.entries.splice(j, 0, e);
  persist();
  renderList();
}

async function removeEntry(id) {
  const e = state.entries.find((x) => x.id === id);
  if (!e) return;
  if (!confirm(`Supprimer la fiche « ${titleOf(e)} » ?`)) return;
  const idx = state.entries.indexOf(e);
  state.entries.splice(idx, 1);
  if (state.currentId === id) state.currentId = (state.entries[idx] || state.entries[idx - 1] || {}).id || null;
  persist();
  selectEntry(state.currentId);
  collectGarbage(state.entries).catch(console.warn);
}

// ------------------------------------------------------------ formulaire
const formEl = $('#form');

function renderForm() {
  const e = current();
  formEl.textContent = '';
  formEl.hidden = !e;
  $('#form-empty').hidden = !!e;
  if (!e) return;

  const onText = (key) => (ev) => {
    e[key] = ev.target.value;
    e.updated = Date.now();
    persistSoon();
    renderPreviewSoon();
    updateRowSoon(e); // titre et alertes de longueur dans la liste
  };

  const field = (f) => el('div', { class: 'field' },
    el('label', { for: `f-${f.key}`, text: f.label }),
    el('textarea', { id: `f-${f.key}`, rows: String(f.rows), spellcheck: 'true', lang: 'fr', oninput: onText(f.key) }),
    el('p', { class: 'hint', text: f.hint }),
  );

  // --- Titre + nom du fichier
  const titreField = field(FIELDS[0]);
  formEl.append(el('fieldset', {},
    el('legend', { text: 'Titre et nom du fichier' }),
    titreField,
    el('div', { class: 'field' },
      el('label', { for: 'f-fichier', text: 'Nom du fichier PDF (facultatif)' }),
      el('input', { id: 'f-fichier', type: 'text', placeholder: fileNameFor({ ...e, fichier: '' }), oninput: (ev) => { e.fichier = ev.target.value; persistSoon(); } }),
    ),
  ));

  // --- Visuels
  const logoOptions = [1, 2].map((n) => {
    const logo = state.logos[n];
    return el('label', { class: 'logo-option' + (logo ? '' : ' missing') },
      el('input', {
        type: 'radio', name: 'logo', value: String(n), checked: e.logo === n,
        onchange: () => { e.logo = n; persist(); renderPreview(); updateRow(e); },
      }),
      logo ? el('img', { src: logo.url, alt: '' }) : el('span', { class: 'logo-missing', text: '?' }),
      el('span', { text: logo ? `Logo ${n}` : `Logo ${n} (absent : déposez logos/logo-${n}.png ou .jpg)` }),
    );
  });

  formEl.append(el('fieldset', {},
    el('legend', { text: 'Visuels' }),
    el('div', { class: 'field' },
      el('span', { class: 'label', text: 'Image en haut à droite (carré)' }),
      dropZone({
        accept: 'image/*',
        label: e.photo ? `${e.photo.name} (${formatSize(e.photo.size)})` : 'Glissez une image ici ou cliquez pour la choisir',
        thumbKey: e.photo ? e.photo.id : null,
        onFile: (file) => setPhoto(e, file),
        onClear: e.photo ? () => { e.photo = null; persist(); renderForm(); renderPreview(); updateRow(e); collectGarbage(state.entries).catch(console.warn); } : null,
      }),
      el('p', { class: 'hint', text: 'L’image est recadrée pour remplir le carré (centrée). Sans image, le carré gris est conservé.' }),
    ),
    el('div', { class: 'field' },
      el('span', { class: 'label', text: 'Logo dans le cercle rouge' }),
      el('div', { class: 'logo-options' }, logoOptions),
    ),
  ));

  // --- Rubriques
  formEl.append(el('fieldset', {},
    el('legend', { text: 'Rubriques' }),
    FIELDS.slice(1).map(field),
  ));

  // --- PDF annexe
  formEl.append(el('fieldset', {},
    el('legend', { text: 'PDF à ajouter après la page de titre' }),
    el('div', { class: 'field' },
      dropZone({
        accept: 'application/pdf,.pdf',
        label: e.annex ? `${e.annex.name} — ${e.annex.pages || '?'} page${e.annex.pages > 1 ? 's' : ''} (${formatSize(e.annex.size)})` : 'Glissez un PDF ici ou cliquez pour le choisir',
        onFile: (file) => setAnnex(e, file),
        onClear: e.annex ? () => { e.annex = null; persist(); renderForm(); renderPreview(); updateRow(e); collectGarbage(state.entries).catch(console.warn); } : null,
      }),
      el('p', { class: 'hint', text: 'Facultatif. Toutes ses pages sont ajoutées à la suite de la page de titre générée.' }),
    ),
  ));

  for (const f of FIELDS) formEl.querySelector(`#f-${f.key}`).value = e[f.key] || '';
  formEl.querySelector('#f-fichier').value = e.fichier || '';
}

function dropZone({ accept, label, onFile, onClear, thumbKey }) {
  const input = el('input', { type: 'file', accept, class: 'visually-hidden' });
  input.addEventListener('change', () => { if (input.files[0]) onFile(input.files[0]); input.value = ''; });
  const zone = el('label', { class: 'drop' + (onClear ? ' filled' : '') }, input);
  if (thumbKey) {
    const c = el('canvas', { class: 'thumb', width: '96', height: '96' });
    bitmapFor(thumbKey).then((bmp) => {
      if (!bmp) return;
      const ctx = c.getContext('2d');
      const s = Math.max(96 / bmp.width, 96 / bmp.height);
      ctx.drawImage(bmp, (96 - bmp.width * s) / 2, (96 - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
    });
    zone.append(c);
  }
  zone.append(el('span', { class: 'drop-label', text: label }));
  ['dragenter', 'dragover'].forEach((t) => zone.addEventListener(t, (ev) => { ev.preventDefault(); zone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => zone.addEventListener(t, () => zone.classList.remove('over')));
  zone.addEventListener('drop', (ev) => {
    ev.preventDefault();
    const f = ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (f) onFile(f);
  });
  const wrap = el('div', { class: 'drop-wrap' }, zone);
  if (onClear) wrap.append(el('button', { type: 'button', class: 'ghost small danger', onclick: onClear }, 'Retirer'));
  return wrap;
}

async function setPhoto(e, file) {
  try {
    statusEl.textContent = 'Préparation de l’image…';
    const bytes = await normalizePhoto(file);
    const id = uid('img');
    await putFile(id, { name: file.name, type: 'image/jpeg', bytes });
    e.photo = { id, name: file.name, size: bytes.length };
    e.updated = Date.now();
    persist();
    if (current() === e) renderForm();
    renderPreview();
    updateRow(e);
    collectGarbage(state.entries).catch(console.warn);
  } catch (err) {
    alert(err.message || String(err));
    statusEl.textContent = '';
  }
}

async function setAnnex(e, file) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let pages = 0;
    try {
      const doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
      pages = doc.getPageCount();
    } catch {
      throw new Error(`« ${file.name} » n’est pas un PDF lisible.`);
    }
    const id = uid('pdf');
    await putFile(id, { name: file.name, type: 'application/pdf', bytes });
    e.annex = { id, name: file.name, size: bytes.length, pages };
    e.updated = Date.now();
    persist();
    if (current() === e) renderForm();
    renderPreview();
    updateRow(e);
    collectGarbage(state.entries).catch(console.warn);
  } catch (err) {
    alert(err.message || String(err));
  }
}

// ------------------------------------------------------------ aperçu
const canvas = $('#preview');

async function bitmapFor(key) {
  if (state.bitmaps.has(key)) return state.bitmaps.get(key);
  let bytes = null;
  if (key.startsWith('picto-')) bytes = state.pictos[key];
  else if (key.startsWith('logo-')) bytes = (state.logos[key.slice(5)] || {}).bytes;
  else { const f = await getFile(key).catch(() => null); bytes = f && f.bytes; }
  if (!bytes) return null;
  const bmp = await toBitmap(bytes).catch(() => null);
  if (bmp) state.bitmaps.set(key, bmp);
  return bmp;
}

let previewToken = 0;
async function renderPreview() {
  const e = current();
  const token = ++previewToken;
  const warnEl = $('#warnings');
  $('#btn-gen-one').disabled = !e;
  if (!e || !state.measure) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    warnEl.textContent = '';
    $('#annex-note').textContent = '';
    return;
  }
  const images = {};
  for (const k of Object.keys(state.pictos)) images[k] = await bitmapFor(k);
  images.logo = await bitmapFor(`logo-${e.logo}`);
  if (e.photo) images.photo = await bitmapFor(e.photo.id);
  if (token !== previewToken) return; // une saisie plus récente a pris le relais

  const width = canvas.parentElement.clientWidth || 400;
  const scale = (width * (window.devicePixelRatio || 1)) / PAGE.width;
  const { warnings } = drawPreview(canvas, e, { measure: state.measure, images, families: state.families, scale });

  warnEl.textContent = '';
  for (const w of warnings) warnEl.append(el('li', { text: w.message }));
  $('#annex-note').textContent = e.annex
    ? `+ ${e.annex.pages || '?'} page${e.annex.pages > 1 ? 's' : ''} du PDF « ${e.annex.name} » ajoutée${e.annex.pages > 1 ? 's' : ''} à la suite.`
    : '';
}
const renderPreviewSoon = debounce(renderPreview, 120);
new ResizeObserver(debounce(renderPreview, 100)).observe($('.sheet'));

// ------------------------------------------------------------ génération
const genStatus = $('#gen-status');

async function pdfFor(entry) {
  const images = { ...state.pictos };
  const logo = state.logos[entry.logo];
  if (logo) images.logo = logo.bytes;
  if (entry.photo) {
    const f = await getFile(entry.photo.id);
    if (f) images.photo = f.bytes;
  }
  let annex = null;
  if (entry.annex) {
    const f = await getFile(entry.annex.id);
    if (!f) throw new Error(`PDF annexe introuvable pour « ${titleOf(entry)} » : rechargez-le.`);
    annex = f.bytes;
  }
  return buildPdf({
    entry, images, annex, PDFLib, fontkit,
    fonts: state.fonts, measure: state.measure, title: titleOf(entry),
  });
}

async function generate(list) {
  if (state.busy || !list.length) return;
  state.busy = true;
  document.body.classList.add('busy');
  genStatus.classList.remove('error');
  const warned = [];
  try {
    const files = [];
    const used = new Set();
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      genStatus.textContent = `Génération ${i + 1} / ${list.length} : ${titleOf(entry)}…`;
      const { bytes, warnings } = await pdfFor(entry);
      if (warnings.length) warned.push(titleOf(entry));
      let name = fileNameFor(entry, `fiche-${state.entries.indexOf(entry) + 1}`);
      let n = 2;
      while (used.has(name.toLowerCase())) name = name.replace(/(-\d+)?\.pdf$/, `-${n++}.pdf`);
      used.add(name.toLowerCase());
      files.push({ name, bytes });
    }
    if (files.length === 1) {
      download(files[0].bytes, files[0].name, 'application/pdf');
    } else {
      const entries = [];
      const d = new Date();
      const modTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
      const modDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
      for (const f of files) entries.push(await makeEntry({ name: f.name, flags: 0x0800, modTime, modDate }, f.bytes, { forceStore: true }));
      download(writeZip(entries), `fiches_${stamp()}.zip`, 'application/zip');
    }
    genStatus.textContent = `${files.length} PDF généré${files.length > 1 ? 's' : ''}.`
      + (warned.length ? ` ⚠ Texte trop long dans : ${warned.join(', ')}.` : '');
  } catch (err) {
    console.error(err);
    genStatus.textContent = `Erreur : ${err.message || err}`;
    genStatus.classList.add('error');
  } finally {
    state.busy = false;
    document.body.classList.remove('busy');
  }
}

// ------------------------------------------------------------ polices
let faceGen = 0;
async function applyFonts(fonts) {
  state.fonts = fonts;
  state.measure = makeMeasure(fontkit, fonts);
  const gen = ++faceGen;
  const families = {};
  for (const r of FONT_ROLES) {
    const fam = `Fiches-${r.key}-${gen}`;
    const face = new FontFace(fam, fonts[r.key]);
    await face.load();
    document.fonts.add(face);
    families[r.key] = fam;
  }
  state.families = families;
  const banner = $('#font-banner');
  banner.hidden = fonts.source !== 'secours';
  $('#font-banner-text').textContent = 'Les polices Zeitung Pro ne sont pas installées : aperçu et PDF utilisent la police de secours Mulish.';
  $('#font-current').textContent = fonts.source === 'secours' ? fonts.name
    : `${fonts.name} (${fonts.source === 'navigateur' ? 'importée dans ce navigateur' : 'dossier fonts/ du site'})`;
}

async function reloadFonts() {
  await applyFonts(await loadFonts());
  renderList();
  renderPreview();
}

function openFontsDialog() {
  $('#font-msg').textContent = '';
  $('#font-roles').textContent = '';
  $('#fonts-dialog').showModal();
}

$('#font-input').addEventListener('change', async (ev) => {
  const files = [...ev.target.files];
  ev.target.value = '';
  const found = {};
  const rolesEl = $('#font-roles');
  rolesEl.textContent = '';
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const role = guessRole(fontkit, bytes, f.name);
    if (role && !found[role]) found[role] = { name: f.name, bytes };
    rolesEl.append(el('li', { text: `${f.name} → ${role ? FONT_ROLES.find((r) => r.key === role).label : 'ignoré (graisse non utilisée)'}` }));
  }
  for (const [role, f] of Object.entries(found)) await storeFont(role, f.name, f.bytes);
  const missing = [];
  for (const r of FONT_ROLES) if (!(await getFile('font:' + r.key))) missing.push(r.label);
  $('#font-msg').textContent = missing.length
    ? `Il manque encore : ${missing.join(', ')}. Ajoutez ces fichiers pour activer Zeitung Pro.`
    : 'Polices Zeitung Pro enregistrées dans ce navigateur ✓';
  await reloadFonts();
});

$('#btn-font-clear').addEventListener('click', async () => {
  await clearStoredFonts();
  $('#font-msg').textContent = 'Polices importées oubliées.';
  await reloadFonts();
});
$('#btn-fonts').addEventListener('click', openFontsDialog);
$('#btn-banner-fonts').addEventListener('click', openFontsDialog);

// ------------------------------------------------------------ sauvegarde / restauration
$('#btn-backup').addEventListener('click', async () => {
  try {
    const json = await buildBackup(state.entries);
    download(new TextEncoder().encode(json), `fiches-pdf_sauvegarde_${stamp()}.json`, 'application/json');
  } catch (err) {
    alert(`Sauvegarde impossible : ${err.message || err}`);
  }
});

$('#btn-restore').addEventListener('click', () => $('#restore-input').click());
$('#restore-input').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const { entries, files } = parseBackup(await file.text());
    const msg = `Restaurer « ${file.name} » ?\n\n${entries.length} fiche${entries.length > 1 ? 's' : ''} dans la sauvegarde.\n`
      + `Les ${state.entries.length} fiche${state.entries.length > 1 ? 's' : ''} actuelle${state.entries.length > 1 ? 's' : ''} seront remplacée${state.entries.length > 1 ? 's' : ''}.`;
    if (!confirm(msg)) return;
    for (const [id, f] of Object.entries(files)) await putFile(id, f);
    for (const e of entries) {
      if (e.photo && !files[e.photo.id] && !(await getFile(e.photo.id))) e.photo = null;
      if (e.annex && !files[e.annex.id] && !(await getFile(e.annex.id))) e.annex = null;
    }
    state.entries = entries;
    state.bitmaps.clear();
    state.currentId = entries[0] ? entries[0].id : null;
    persist();
    selectEntry(state.currentId);
    collectGarbage(state.entries).catch(console.warn);
  } catch (err) {
    alert(err.message || String(err));
  }
});

// ------------------------------------------------------------ actions générales
$('#btn-new').addEventListener('click', () => addEntry(blankEntry()));
$('#check-all').addEventListener('change', (ev) => {
  for (const e of state.entries) e.selected = ev.target.checked;
  persist();
  renderList();
});
$('#btn-gen-sel').addEventListener('click', () => generate(state.entries.filter((e) => e.selected)));
$('#btn-gen-all').addEventListener('click', () => generate(state.entries));
$('#btn-gen-one').addEventListener('click', () => { const e = current(); if (e) generate([e]); });

// ------------------------------------------------------------ démarrage
async function init() {
  if (!PDFLib || !fontkit) {
    document.body.prepend(el('p', { class: 'banner error', text: 'Les librairies PDF n’ont pas pu être chargées (dossier vendor/).' }));
    return;
  }
  const db = loadDb();
  if (db) {
    state.entries = db.entries;
  } else {
    state.entries = [sampleEntry()];
    persist();
  }
  state.currentId = state.entries[0] ? state.entries[0].id : null;

  const [fonts, logos, pictos] = await Promise.all([loadFonts(), loadLogos(), loadPictos()]);
  state.logos = logos;
  state.pictos = pictos;
  await applyFonts(fonts);

  renderList();
  renderForm();
  renderPreview();
  if (db) statusEl.textContent = 'Fiches rechargées depuis ce navigateur';
}

init().catch((err) => {
  console.error(err);
  document.body.prepend(el('p', { class: 'banner error', text: `Erreur au démarrage : ${err.message || err}` }));
});

// Interface de l'éditeur de textes IDML.

import { openIdml, IdmlError, storyGroup, storyLocation } from './idml.js';
import { exportIdml, exportFileName } from './writer.js';
import {
  toDisplay, fromDisplay, paragraphText, paragraphOriginal, delta, formatPct, isPieceModified,
  isParagraphModified, storyStats, cleanEdits, countModifiedParagraphs, fingerprint, serializeEdits, importEdits,
  OVERFLOW_THRESHOLD,
} from './state.js';
import { reportHtml, reportText } from './report.js';
import * as store from './storage.js';

// ---------------------------------------------------------------- utilitaires DOM
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const SVG = 'http://www.w3.org/2000/svg';

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}

const cssId = (id) => (window.CSS && CSS.escape ? CSS.escape(id) : id.replace(/[^\w-]/g, '\\$&'));
const supportsFieldSizing = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('field-sizing', 'content');

function autoGrow(ta) {
  if (supportsFieldSizing) return;
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
}

function toast(message, { warn = false, duration = 6000 } = {}) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.toggle('warn', warn);
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, duration);
}

function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const baseName = (n) => n.replace(/\.idml$/i, '');
const norm = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[  ]/g, ' ').toLowerCase();

// ---------------------------------------------------------------- état
const state = {
  doc: null,
  edits: new Map(),
  projectId: null,
  saveTimer: null,
  lastFocused: null,
  selected: null,
};

// ---------------------------------------------------------------- accueil
function showError(err) {
  const box = $('#error');
  box.replaceChildren();
  const isKnown = err instanceof IdmlError;
  box.append(h('strong', { text: isKnown ? err.message : `Erreur inattendue : ${err.message || err}` }));
  if (isKnown && err.hint) box.append(h('span', { text: err.hint }));
  box.hidden = false;
}

async function refreshProjects() {
  const list = await store.listProjects();
  const ul = $('#project-list');
  ul.replaceChildren();
  $('#projects').hidden = !list.length;
  for (const p of list) {
    const date = new Date(p.updatedAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
    ul.append(h('li', {},
      h('span', { class: 'name', text: p.fileName }),
      h('span', { class: 'meta', text: `${p.count} segment(s) modifié(s) · ${date}` }),
      h('button', { type: 'button', class: 'primary', text: 'Reprendre', onclick: () => resumeProject(p.id) }),
      h('button', {
        type: 'button', text: 'Supprimer', class: 'danger',
        onclick: async () => {
          if (!confirm(`Supprimer le travail en cours sur « ${p.fileName} » de cet ordinateur ?\nLes modifications non exportées seront perdues.`)) return;
          await store.deleteProject(p.id);
          refreshProjects();
        },
      }),
    ));
  }
}

async function resumeProject(id) {
  const p = await store.getProject(id);
  if (!p || !p.bytes) {
    showError(new IdmlError('Le fichier d’origine n’est plus disponible dans ce navigateur.', 'Déposez à nouveau le fichier .idml : vos modifications enregistrées seront restaurées automatiquement.'));
    return;
  }
  await loadBytes(new Uint8Array(p.bytes), p.fileName);
}

async function handleFile(file) {
  $('#error').hidden = true;
  if (!file) return;
  const dz = $('#dropzone');
  dz.classList.add('busy');
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await loadBytes(bytes, file.name);
  } catch (e) {
    console.error(e);
    showError(e);
  } finally {
    dz.classList.remove('busy');
  }
}

async function loadBytes(bytes, fileName) {
  try {
    const doc = await openIdml(bytes, fileName);
    const id = fingerprint(bytes);
    const existing = await store.getProject(id);
    state.doc = doc;
    state.projectId = id;
    state.edits = cleanEdits(doc, new Map(Object.entries((existing && existing.edits) || {})));
    if (!existing || !existing.bytes) {
      await store.saveProject({ id, fileName, bytes: bytes.slice().buffer, edits: Object.fromEntries(state.edits), updatedAt: Date.now() });
    }
    openEditor();
    if (state.edits.size) toast(`Vos modifications précédentes ont été restaurées (${countModifiedParagraphs(doc, state.edits)} paragraphe(s)).`);
  } catch (e) {
    console.error(e);
    showError(e);
  }
}

// ---------------------------------------------------------------- éditeur : plan
function storyLabelText(story) {
  const txt = story.paragraphs.map((p) => paragraphText(p, state.edits)).join(' ').replace(/\s+/g, ' ').trim();
  return txt;
}

function wrapLines(text, maxChars, maxLines) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
    else { lines.push(cur); cur = w; if (lines.length >= maxLines) break; }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && lines.join(' ').length < text.length) lines[maxLines - 1] = lines[maxLines - 1].replace(/.?$/, '…');
  return lines.map((l) => (l.length > maxChars ? l.slice(0, Math.max(1, maxChars - 1)) + '…' : l));
}

function frameLabel(g, f, page) {
  const story = state.doc.storiesById.get(f.storyId);
  g.querySelectorAll('.fr-label, .fr-clip').forEach((n) => n.remove());
  if (!story || !story.paragraphs.length) return;
  const fs = page.width / 38;
  const pad = fs * 0.4;
  const badge = story.number ? fs * 1.6 : 0;
  let text = storyLabelText(story);
  if (f.chainIndex > 0) text = `(suite ${f.chainIndex + 1}/${f.chainLength}) ${text}`;
  const maxChars = Math.max(3, Math.floor((f.w - pad * 2 - badge) / (fs * 0.55)));
  const maxLines = Math.max(1, Math.min(5, Math.floor((f.h - pad) / (fs * 1.2))));
  const lines = wrapLines(text, maxChars, maxLines);
  const clip = s('svg', { class: 'fr-clip', x: f.x, y: f.y, width: Math.max(f.w, 1), height: Math.max(f.h, 1) },
    s('text', { class: 'fr-label', 'font-size': fs },
      lines.map((l, i) => s('tspan', { x: pad + badge, y: pad + fs * (i + 0.9) * 1.15 }, l))));
  g.insertBefore(clip, g.querySelector('.fr-badge'));
}

function renderPlan() {
  const plan = $('#plan');
  plan.replaceChildren();
  const { doc } = state;
  let masterTitleDone = false;
  for (const page of doc.pages) {
    if (page.isMaster && !masterTitleDone) {
      plan.append(h('p', { class: 'plan-group-title', text: 'Gabarits (s’appliquent à toutes les pages qui les utilisent)' }));
      masterTitleDone = true;
    }
    const svg = s('svg', { viewBox: `0 0 ${page.width} ${page.height}`, role: 'img', 'aria-label': `Plan schématique — ${page.label}` });
    svg.append(s('rect', { class: 'pg-border', x: 0, y: 0, width: page.width, height: page.height }));
    const frames = doc.frames.filter((f) => f.pageId === page.id);
    const order = { shape: 0, image: 1, text: 2 };
    frames.sort((a, b) => order[a.kind] - order[b.kind]);
    for (const f of frames) {
      const pts = f.pagePoints.map((p) => p.join(',')).join(' ');
      if (f.kind !== 'text') {
        svg.append(s('polygon', { class: `fr fr-${f.kind}`, points: pts }, s('title', {}, f.kind === 'image' ? 'Image' : 'Forme')));
        continue;
      }
      const story = doc.storiesById.get(f.storyId);
      const editable = !!(story && story.paragraphs.length);
      const g = s('g', { class: `fr fr-text${editable ? ' editable' : ' empty'}`, 'data-story-id': f.storyId, 'data-frame-id': f.id });
      g.append(s('polygon', { points: pts }));
      if (editable) {
        g.append(s('title', {}, `Bloc ${story.number}${f.chainLength > 1 ? ` (cadre ${f.chainIndex + 1}/${f.chainLength})` : ''} — cliquer pour modifier`));
        const fs = page.width / 38;
        const r = fs * 0.75;
        g.append(s('g', { class: 'fr-badge' },
          s('circle', { cx: f.x + r + fs * 0.25, cy: f.y + r + fs * 0.25, r }),
          s('text', { x: f.x + r + fs * 0.25, y: f.y + r + fs * 0.25, 'font-size': fs * 0.9 }, String(story.number))));
        frameLabel(g, f, page);
        g.addEventListener('click', () => selectStory(f.storyId, 'plan'));
      } else {
        g.append(s('title', {}, 'Bloc texte vide'));
      }
      svg.append(g);
    }
    plan.append(h('figure', { class: 'page-plan', 'data-page-id': page.id }, h('figcaption', { text: page.label }), svg));
  }
  const offPage = doc.stories.filter((x) => !x.pageId);
  if (offPage.length) {
    plan.append(h('p', { class: 'plan-group-title', text: `${offPage.length} texte(s) hors page (voir en bas de la liste)` }));
  }
}

function refreshFrames(storyId) {
  const story = state.doc.storiesById.get(storyId);
  const st = storyStats(story, state.edits);
  for (const g of $$(`.fr-text[data-story-id="${cssId(storyId)}"]`)) {
    g.classList.toggle('modified', st.modified > 0);
    g.classList.toggle('alert', st.modified > 0 && st.alert);
    const f = state.doc.frames.find((x) => x.id === g.dataset.frameId);
    const page = state.doc.pagesById.get(f.pageId);
    if (page) frameLabel(g, f, page);
  }
}

// ---------------------------------------------------------------- éditeur : textes
function describeSegment(pc) {
  const parts = [];
  parts.push(pc.charStyle && pc.charStyle !== 'sans style' ? `style « ${pc.charStyle} »` : 'sans style de caractère');
  if (pc.overrides.length) parts.push(pc.overrides.join(', '));
  if (pc.wrappers.length) parts.push(pc.wrappers.join(', '));
  return parts.join(' · ');
}

function renderInvisibles(container, text) {
  container.replaceChildren();
  if (!/[  \t\u2028]/.test(text)) { container.hidden = true; return; }
  const map = { ' ': '°', ' ': '·', '\t': '⇥', '\u2028': '↲' };
  for (const part of text.split(/([  \t\u2028])/)) {
    if (map[part]) container.append(h('span', { class: 'm', title: { ' ': 'espace insécable', ' ': 'espace fine insécable', '\t': 'tabulation', '\u2028': 'saut de ligne forcé' }[part], text: map[part] }));
    else if (part) container.append(part);
  }
  container.prepend(h('span', { text: 'Caractères invisibles : ' }));
  container.hidden = false;
}

function makeTextarea(pc, paraEl, para) {
  const ta = h('textarea', {
    class: 'piece',
    rows: 1,
    spellcheck: 'true',
    lang: 'fr',
    'data-piece-id': pc.id,
    'aria-label': para.simple ? `Paragraphe (style ${para.paraStyle})` : `Segment : ${describeSegment(pc)}`,
  });
  ta.value = toDisplay(state.edits.has(pc.id) ? state.edits.get(pc.id) : pc.original);
  ta.classList.toggle('modified', isPieceModified(pc, state.edits));
  ta.addEventListener('input', () => onPieceInput(pc, ta, paraEl, para));
  ta.addEventListener('focus', () => {
    state.lastFocused = ta;
    selectStory(pc.storyId, 'text');
    renderInvisibles($('.invisibles', paraEl), paragraphText(para, state.edits));
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      insertAtCursor(ta, '↲');
    }
  });
  return ta;
}

function insertAtCursor(ta, before, after = '') {
  const { selectionStart: a, selectionEnd: b, value } = ta;
  ta.value = value.slice(0, a) + before + value.slice(a, b) + after + value.slice(b);
  const pos = a + before.length + (b - a);
  ta.setSelectionRange(pos, pos);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.focus();
}

function buildParagraph(para) {
  const paraEl = h('div', { class: 'para', 'data-para-id': para.id, 'data-story-id': para.storyId });
  const count = h('span', { class: 'para-count' });
  const revert = h('button', { type: 'button', class: 'para-revert', text: 'Revenir à l’original', title: 'Annuler les modifications de ce paragraphe', onclick: () => revertParagraph(para, paraEl) });
  const head = h('div', { class: 'para-head' },
    h('span', { class: 'para-style', text: `¶ ${para.paraStyle || 'sans style'}` }),
    para.context ? h('span', { class: 'para-ctx', text: para.context }) : null,
    !para.simple ? h('span', { class: 'para-badge', text: `${para.pieces.length} segment(s) de mise en forme` }) : null,
    count, revert);
  paraEl.append(head);

  if (para.simple) {
    paraEl.append(makeTextarea(para.pieces[0], paraEl, para));
  } else {
    const segs = h('div', { class: 'segments' });
    let n = 0;
    for (const item of para.items) {
      if (item.type === 'token') {
        segs.append(h('span', { class: 'token', title: 'Élément non textuel conservé tel quel', text: `[${item.label}]` }));
      } else {
        const pc = item.piece;
        n++;
        const styled = (pc.charStyle && pc.charStyle !== 'sans style') || pc.overrides.length || pc.wrappers.length;
        segs.append(h('div', { class: 'seg' },
          h('span', { class: `seg-style${styled ? ' styled' : ''}` }, h('span', { class: 'seg-n', text: `segment ${n}/${para.pieces.length}` }), describeSegment(pc), h('span', { class: 'seg-space' })),
          makeTextarea(pc, paraEl, para)));
      }
    }
    paraEl.append(segs);
    paraEl.append(h('p', { class: 'seg-note', text: 'Ce paragraphe mélange plusieurs mises en forme : chaque segment garde la sienne. Modifiez le texte segment par segment (pensez aux espaces en début ou fin de segment). Les segments ne sont jamais fusionnés.' }));
  }
  paraEl.append(h('div', { class: 'invisibles', hidden: true }));
  paraEl.append(h('div', { class: 'original', hidden: true }));
  updateParagraph(para, paraEl);
  return paraEl;
}

function updateSpaceHints(paraEl) {
  for (const seg of $$('.seg', paraEl)) {
    const v = $('textarea', seg).value;
    const hints = [];
    if (/^[   \t]/.test(v)) hints.push('␣ espace au début');
    if (/[   \t]$/.test(v)) hints.push('␣ espace à la fin');
    $('.seg-space', seg).textContent = hints.join(' · ');
  }
}

function updateParagraph(para, paraEl) {
  updateSpaceHints(paraEl);
  const cur = paragraphText(para, state.edits);
  const orig = paragraphOriginal(para);
  const d = delta(orig, cur);
  const modified = isParagraphModified(para, state.edits);
  const count = $('.para-count', paraEl);
  count.textContent = modified ? `${d.current} car. (${d.original} à l’origine, ${formatPct(d.pct)})` : `${d.current} car.`;
  count.classList.toggle('alert', modified && d.alert);
  count.title = modified && d.alert ? `Plus de +${OVERFLOW_THRESHOLD} % : le texte risque de déborder du bloc.` : '';
  paraEl.classList.toggle('modified', modified);
  paraEl.classList.toggle('alert', modified && d.alert);
  $('.para-revert', paraEl).disabled = !modified;
  const o = $('.original', paraEl);
  o.hidden = !modified;
  o.textContent = modified ? toDisplay(orig).replace(/\n/g, ' ¶ ') : '';
}

function updateStoryHeader(story) {
  const card = document.getElementById(`story-${story.id}`);
  if (!card) return;
  const st = storyStats(story, state.edits);
  const total = $('.story-total', card);
  total.textContent = st.modified
    ? `${st.modified} paragraphe(s) modifié(s) · total ${st.current} car. (${formatPct(st.pct)})${st.alert ? ' ⚠ débordement possible' : ''}`
    : `${st.current} car.`;
  total.classList.toggle('alert', st.modified > 0 && st.alert);
}

function onPieceInput(pc, ta, paraEl, para) {
  autoGrow(ta);
  const value = fromDisplay(ta.value);
  if (value === pc.original) state.edits.delete(pc.id);
  else state.edits.set(pc.id, value);
  ta.classList.toggle('modified', isPieceModified(pc, state.edits));
  updateParagraph(para, paraEl);
  renderInvisibles($('.invisibles', paraEl), paragraphText(para, state.edits));
  const story = state.doc.storiesById.get(pc.storyId);
  updateStoryHeader(story);
  refreshFrames(pc.storyId);
  updateDocInfo();
  scheduleSave();
}

function revertParagraph(para, paraEl) {
  for (const pc of para.pieces) state.edits.delete(pc.id);
  for (const ta of $$('textarea.piece', paraEl)) {
    const pc = state.doc.piecesById.get(ta.dataset.pieceId);
    ta.value = toDisplay(pc.original);
    ta.classList.remove('modified');
    autoGrow(ta);
  }
  updateParagraph(para, paraEl);
  updateStoryHeader(state.doc.storiesById.get(para.storyId));
  refreshFrames(para.storyId);
  updateDocInfo();
  scheduleSave();
}

function renderTexts() {
  const { doc } = state;
  const root = $('#texts');
  root.replaceChildren();
  const groups = new Map();
  for (const story of doc.stories) {
    const g = storyGroup(doc, story);
    if (!groups.has(g.key)) groups.set(g.key, { ...g, stories: [] });
    groups.get(g.key).stories.push(story);
  }
  const sorted = [...groups.values()].sort((a, b) => a.order - b.order);
  if (!sorted.length) root.append(h('p', { class: 'empty-state', text: 'Aucun texte modifiable dans ce document.' }));
  for (const g of sorted) {
    const section = h('section', { class: 'page-group', 'data-group': g.key }, h('h2', { text: g.label }));
    for (const story of g.stories) {
      const chain = story.frames.length > 1 ? ` · chaîné sur ${story.frames.length} blocs` : '';
      const card = h('article', { class: 'story', id: `story-${story.id}`, 'data-story-id': story.id },
        h('div', { class: 'story-head', onclick: () => selectStory(story.id, 'text') },
          h('h3', {}, h('span', { class: 'story-num', text: String(story.number) }), `Bloc ${story.number}`),
          h('span', { class: 'story-loc', text: `${storyLocation(doc, story)}${chain}` }),
          h('span', { class: 'story-total' })));
      for (const para of story.paragraphs) card.append(buildParagraph(para));
      section.append(card);
    }
    root.append(section);
  }
  for (const story of doc.stories) updateStoryHeader(story);
  if (!supportsFieldSizing) requestAnimationFrame(() => $$('textarea.piece').forEach(autoGrow));
}

// ---------------------------------------------------------------- sélection plan <-> textes
function selectStory(storyId, from) {
  if (state.selected !== storyId) {
    $$('.fr-text.active').forEach((g) => g.classList.remove('active'));
    $$('.story.selected').forEach((c) => c.classList.remove('selected'));
    state.selected = storyId;
  }
  const frames = $$(`.fr-text[data-story-id="${cssId(storyId)}"]`);
  frames.forEach((g) => g.classList.add('active'));
  const card = document.getElementById(`story-${storyId}`);
  if (card) card.classList.add('selected');

  if (from === 'plan' && card) {
    card.classList.remove('flash');
    void card.offsetWidth; // relance l'animation
    card.classList.add('flash');
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const first = $('textarea.piece', card);
    if (first) first.focus({ preventScroll: true });
  } else if (from === 'text' && frames.length) {
    const fig = frames[0].closest('figure');
    if (fig) {
      const plan = $('#plan');
      const r = fig.getBoundingClientRect();
      const pr = plan.getBoundingClientRect();
      if (r.top < pr.top || r.bottom > pr.bottom) fig.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
}

// ---------------------------------------------------------------- recherche et filtres
function applyFilters() {
  const q = norm($('#search').value.trim());
  const onlyMod = $('#only-modified').checked;
  let matches = 0;
  const matchedStories = new Set();
  for (const paraEl of $$('.para')) {
    const story = state.doc.storiesById.get(paraEl.dataset.storyId);
    const para = story.paragraphs.find((p) => p.id === paraEl.dataset.paraId);
    const textMatch = !q || norm(paragraphText(para, state.edits)).includes(q) || norm(paragraphOriginal(para)).includes(q);
    const modMatch = !onlyMod || isParagraphModified(para, state.edits);
    const show = textMatch && modMatch;
    paraEl.classList.toggle('hidden-by-filter', !show);
    paraEl.classList.toggle('search-match', !!q && show);
    if (show) { matches++; matchedStories.add(story.id); }
  }
  for (const card of $$('.story')) card.classList.toggle('hidden-by-filter', !matchedStories.has(card.dataset.storyId));
  for (const sec of $$('.page-group')) sec.classList.toggle('hidden-by-filter', !$('.story:not(.hidden-by-filter)', sec));
  $$('.fr-text').forEach((g) => g.classList.toggle('match', !!q && matchedStories.has(g.dataset.storyId)));
  const active = q || onlyMod;
  $('#search-count').textContent = active ? `${matches} paragraphe(s)` : '';
  let empty = $('#texts .empty-state.filter');
  if (active && !matches) {
    if (!empty) $('#texts').append(h('p', { class: 'empty-state filter', text: 'Aucun texte ne correspond.' }));
  } else if (empty) empty.remove();
}

function nextMatch() {
  const visible = $$('.para.search-match');
  if (!visible.length) return;
  const cur = state.lastFocused && state.lastFocused.closest('.para');
  const idx = visible.indexOf(cur);
  const next = visible[(idx + 1) % visible.length];
  next.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const ta = $('textarea.piece', next);
  if (ta) ta.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- sauvegarde
function scheduleSave() {
  $('#save-status').textContent = 'Enregistrement…';
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveNow, 400);
}

async function saveNow() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  if (!state.projectId) return;
  const at = await store.saveEdits(state.projectId, Object.fromEntries(cleanEdits(state.doc, state.edits)));
  $('#save-status').textContent = at
    ? `✓ Enregistré sur cet ordinateur à ${new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
    : '⚠ Sauvegarde locale impossible : exportez vos modifications en JSON';
}

// ---------------------------------------------------------------- en-tête
function updateDocInfo() {
  const { doc } = state;
  const n = countModifiedParagraphs(doc, state.edits);
  const info = $('#doc-info');
  info.replaceChildren(
    h('strong', { text: doc.fileName }),
    ` · ${doc.pages.filter((p) => !p.isMaster).length} page(s) · ${doc.stories.length} bloc(s) de texte · `,
    h('span', { text: n ? `${n} paragraphe(s) modifié(s)` : 'aucune modification' }),
  );
}

function openEditor() {
  $('#home').hidden = true;
  $('#editor').hidden = false;
  $('#doc-info').hidden = false;
  $('#actions').hidden = false;
  $('#search').value = '';
  $('#only-modified').checked = false;
  state.selected = null;
  state.lastFocused = null;
  updateDocInfo();
  renderPlan();
  renderTexts();
  for (const s0 of state.doc.stories) refreshFrames(s0.id);
  applyFilters();
  $('#save-status').textContent = state.edits.size ? '✓ Modifications restaurées' : '';
  document.title = `${state.doc.fileName} — Textes InDesign`;
}

async function closeEditor() {
  if (state.saveTimer) await saveNow();
  state.doc = null;
  state.edits = new Map();
  state.projectId = null;
  $('#editor').hidden = true;
  $('#doc-info').hidden = true;
  $('#actions').hidden = true;
  $('#home').hidden = false;
  $('#plan').replaceChildren();
  $('#texts').replaceChildren();
  $('#error').hidden = true;
  document.title = 'Textes InDesign';
  refreshProjects();
}

// ---------------------------------------------------------------- exports
async function doExport() {
  const { doc } = state;
  const n = countModifiedParagraphs(doc, state.edits);
  if (!n && !confirm('Aucun texte n’a été modifié. Télécharger quand même une copie du fichier ?')) return;
  const btn = $('#btn-export');
  btn.disabled = true;
  try {
    if (state.saveTimer) await saveNow();
    const { bytes, check } = await exportIdml(doc, state.edits);
    const name = exportFileName(doc.fileName);
    download(name, bytes, 'application/vnd.adobe.indesign-idml-package');
    const alerts = doc.stories.flatMap((st) => st.paragraphs).filter((p) => isParagraphModified(p, state.edits) && delta(paragraphOriginal(p), paragraphText(p, state.edits)).alert).length;
    let msg = `« ${name} » téléchargé et vérifié : ${check.modified} story(s) modifiée(s), ${check.identical} fichier(s) recopié(s) à l’identique.`;
    if (alerts) msg += ` ⚠ ${alerts} paragraphe(s) à plus de +${OVERFLOW_THRESHOLD} % : envoyez aussi le récapitulatif au graphiste.`;
    toast(msg, { warn: alerts > 0, duration: 10000 });
  } catch (e) {
    console.error(e);
    toast(`Export impossible : ${e.message}`, { warn: true, duration: 12000 });
  } finally {
    btn.disabled = false;
  }
}

function doReport(kind) {
  const { doc } = state;
  const exportName = exportFileName(doc.fileName);
  if (kind === 'html') download(`${baseName(doc.fileName)}_recapitulatif_${today()}.html`, reportHtml(doc, state.edits, { exportName }), 'text/html;charset=utf-8');
  else download(`${baseName(doc.fileName)}_recapitulatif_${today()}.txt`, '﻿' + reportText(doc, state.edits, { exportName }).replace(/\n/g, '\r\n'), 'text/plain;charset=utf-8');
}

function doJsonExport() {
  const json = serializeEdits(state.doc, state.edits);
  download(`${baseName(state.doc.fileName)}_modifications_${today()}.json`, JSON.stringify(json, null, 2), 'application/json');
}

async function doJsonImport(file) {
  try {
    const json = JSON.parse(await file.text());
    const { edits, result } = importEdits(state.doc, json, state.edits);
    state.edits = edits;
    renderTexts();
    for (const s0 of state.doc.stories) refreshFrames(s0.id);
    applyFilters();
    updateDocInfo();
    scheduleSave();
    let msg = `${result.applied} modification(s) importée(s).`;
    if (!result.sameFile) msg += ' (Le fichier JSON provient d’une autre version du document.)';
    if (result.conflicts.length) msg += ` ${result.conflicts.length} ignorée(s) car le texte d’origine a changé.`;
    if (result.unknown) msg += ` ${result.unknown} ignorée(s) car le texte n’existe plus.`;
    toast(msg, { warn: result.conflicts.length + result.unknown > 0, duration: 10000 });
  } catch (e) {
    toast(`Import impossible : ${e.message}`, { warn: true });
  }
}

function showAdvanced() {
  const { doc } = state;
  const body = $('#advanced-body');
  body.replaceChildren();
  body.append(h('h3', { text: 'Textes ignorés' }));
  if (!doc.ignored.length) body.append(h('p', { text: 'Aucun : toutes les stories contiennent du texte.' }));
  else {
    body.append(h('p', { text: 'Ces stories ne contiennent pas de texte modifiable (blocs vides, ancrages, codes techniques). Elles sont conservées telles quelles.' }));
    body.append(h('table', {},
      h('tr', {}, h('th', { text: 'Story' }), h('th', { text: 'Fichier' }), h('th', { text: 'Raison' }), h('th', { text: 'Emplacement' })),
      doc.ignored.map((i) => h('tr', {}, h('td', {}, h('code', { text: i.id })), h('td', {}, h('code', { text: i.file })), h('td', { text: i.reason }), h('td', { text: { page: 'sur une page', master: 'gabarit', pasteboard: 'table de montage', unplaced: 'non placée' }[i.placement] || '' })))));
  }
  const off = doc.stories.filter((x) => !x.pageId);
  body.append(h('h3', { text: 'Textes hors page' }));
  body.append(h('p', { text: off.length ? `${off.length} texte(s) sont sur la table de montage ou non placés : ils n’apparaissent pas dans le PDF final, mais restent modifiables (en bas de la liste).` : 'Aucun.' }));
  body.append(h('h3', { text: 'Gabarits' }));
  body.append(h('p', { text: 'Les textes des gabarits (en-têtes, pieds de page…) s’appliquent à toutes les pages qui utilisent ce gabarit, sauf si le graphiste les a remplacés localement sur une page.' }));
  body.append(h('h3', { text: 'Fichier' }));
  body.append(h('p', { text: `${doc.zip.entries.length} fichiers dans l’archive IDML, ${doc.allStories.length} stories, ${doc.frames.length} objets dans les pages. Empreinte : ${fingerprint(doc.bytes)}.` }));
  body.append(h('p', { text: 'À l’export, seules les stories modifiées sont réécrites (uniquement le contenu des balises Content) ; tous les autres fichiers sont recopiés octet pour octet, et le fichier produit est relu et vérifié avant le téléchargement.' }));
  body.append(h('h3', { text: 'Réinitialiser' }));
  body.append(h('button', {
    type: 'button', class: 'danger', text: 'Effacer toutes mes modifications',
    onclick: () => {
      if (!confirm('Effacer toutes les modifications de ce document ? Cette action est irréversible (pensez à exporter en JSON avant).')) return;
      state.edits = new Map();
      renderTexts();
      for (const s0 of doc.stories) refreshFrames(s0.id);
      applyFilters();
      updateDocInfo();
      scheduleSave();
      $('#advanced').close();
    },
  }));
  $('#advanced').showModal();
}

// ---------------------------------------------------------------- initialisation
function init() {
  if (typeof DecompressionStream === 'undefined') {
    showError(new IdmlError('Ce navigateur est trop ancien pour cet outil.', 'Utilisez une version récente de Firefox, Chrome, Edge ou Safari (2023 ou plus récent).'));
  }

  const dz = $('#dropzone');
  const input = $('#file-input');
  dz.addEventListener('click', () => input.click());
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { handleFile(input.files[0]); input.value = ''; });
  ['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, () => dz.classList.remove('over')));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer.files || [])];
    if (files.length > 1) toast('Un seul fichier à la fois : seul le premier est ouvert.');
    handleFile(files[0]);
  });
  // Empêche le navigateur d'ouvrir un fichier lâché à côté de la zone
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  $('#btn-export').addEventListener('click', doExport);
  const menuBtn = $('#btn-menu');
  const menu = $('#menu');
  const closeMenu = () => { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); };
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    menuBtn.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', closeMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  menu.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    closeMenu();
    if (action === 'report-html') doReport('html');
    else if (action === 'report-txt') doReport('txt');
    else if (action === 'json-export') doJsonExport();
    else if (action === 'json-import') $('#json-input').click();
    else if (action === 'advanced') showAdvanced();
    else if (action === 'close') closeEditor();
  });
  $('#json-input').addEventListener('change', (e) => { if (e.target.files[0]) doJsonImport(e.target.files[0]); e.target.value = ''; });

  let searchTimer;
  $('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(applyFilters, 150); });
  $('#search').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyFilters(); nextMatch(); } });
  $('#only-modified').addEventListener('change', applyFilters);

  for (const b of $$('[data-insert]')) {
    b.addEventListener('mousedown', (e) => e.preventDefault()); // garde le focus dans le champ
    b.addEventListener('click', () => {
      const ta = state.lastFocused;
      if (!ta || !document.body.contains(ta)) { toast('Cliquez d’abord dans un champ de texte.'); return; }
      insertAtCursor(ta, b.dataset.insert, b.dataset.insertAfter || '');
    });
  }

  const flush = () => { if (state.saveTimer) saveNow(); };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  refreshProjects();
}

init();

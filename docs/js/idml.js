// Lecture d'un fichier IDML : pages, géométrie des blocs, stories et paragraphes.

import { readZip, entryData, ZipError } from './zip.js';
import { parseXml, rootElement, elements, child, findAll, descendants, XmlError } from './xml.js';

export const IDML_MIMETYPE = 'application/vnd.adobe.indesign-idml-package';

/** Représentation interne : "\n" = nouveau paragraphe (<Br/>), U+2028 = saut de ligne forcé. */
export const PARAGRAPH_BREAK = '\n';

export class IdmlError extends Error {
  constructor(message, hint = '') {
    super(message);
    this.hint = hint;
  }
}

const HINT_EXPORT = "Dans InDesign : Fichier > Enregistrer sous… > Format : « InDesign Markup (IDML) ». Envoyez ensuite le fichier .idml obtenu.";

// ---------------------------------------------------------------- détection du format
const INDD_GUID = [0x06, 0x06, 0xed, 0xf5, 0xd8, 0x1d, 0x46, 0xe5, 0xbd, 0x31, 0xef, 0xe7, 0xfe, 0x74, 0xb7, 0x1d];

export function sniffFormat(bytes) {
  if (bytes.length >= 16 && INDD_GUID.every((b, i) => bytes[i] === b)) return 'indd';
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5)) return 'zip';
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
  const head = new TextDecoder().decode(bytes.subarray(0, 200)).replace(/^﻿/, '').trimStart();
  if (head.startsWith('<?xml') || head.startsWith('<')) return 'xml';
  return 'unknown';
}

// ---------------------------------------------------------------- géométrie
const IDENTITY = [1, 0, 0, 1, 0, 0];

export function parseMatrix(s) {
  if (!s) return IDENTITY;
  const v = s.trim().split(/\s+/).map(Number);
  return v.length === 6 && v.every(Number.isFinite) ? v : IDENTITY;
}

/** compose(P, C) appliqué à p = P(C(p)). Matrices IDML : x' = a x + c y + tx ; y' = b x + d y + ty. */
export function compose(P, C) {
  const [a, b, c, d, tx, ty] = P;
  const [a2, b2, c2, d2, tx2, ty2] = C;
  return [
    a * a2 + c * b2,
    b * a2 + d * b2,
    a * c2 + c * d2,
    b * c2 + d * d2,
    a * tx2 + c * ty2 + tx,
    b * tx2 + d * ty2 + ty,
  ];
}

export function apply(M, [x, y]) {
  return [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
}

function bbox(points) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [x, y] of points) {
    if (x < x1) x1 = x; if (x > x2) x2 = x;
    if (y < y1) y1 = y; if (y > y2) y2 = y;
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Points d'ancrage du tracé d'un objet (coordonnées internes de l'objet). */
function pathPoints(el) {
  const props = child(el, 'Properties');
  if (!props) return null;
  const geom = child(props, 'PathGeometry');
  if (!geom) return null;
  const pts = [];
  for (const pp of findAll(geom, 'PathPointType')) {
    const a = (pp.attrs.Anchor || '').trim().split(/\s+/).map(Number);
    if (a.length === 2 && a.every(Number.isFinite)) pts.push(a);
  }
  return pts.length ? pts : null;
}

const TEXT_ITEMS = new Set(['TextFrame', 'EndnoteTextFrame']);
const GRAPHIC_ITEMS = new Set(['Rectangle', 'Oval', 'Polygon', 'GraphicLine']);
const GRAPHIC_CONTENT = new Set(['Image', 'PDF', 'EPS', 'ImportedPage', 'WMF', 'PICT', 'SVG', 'EPSText']);

function parseBounds(s) {
  const v = (s || '').trim().split(/\s+/).map(Number);
  if (v.length !== 4 || !v.every(Number.isFinite)) return null;
  const [top, left, bottom, right] = v;
  return [[left, top], [right, top], [right, bottom], [left, bottom]];
}

function decodeIdmlName(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * Analyse un spread (ou gabarit). Renvoie les pages et les objets avec
 * leur géométrie en coordonnées du spread.
 */
export function parseSpread(xml, { spreadIndex = 0, isMaster = false } = {}) {
  const doc = parseXml(xml);
  const spreadEl = elements(rootElement(doc)).find((e) => e.name === 'Spread' || e.name === 'MasterSpread') || rootElement(doc);
  const pages = [];
  const items = [];
  const masterLabel = isMaster
    ? `${spreadEl.attrs.NamePrefix || ''}-${spreadEl.attrs.BaseName || spreadEl.attrs.Name || ''}`.replace(/^-/, '')
    : '';

  const visit = (el, M) => {
    for (const c of elements(el)) {
      if (c.name === 'Properties') continue;
      const M2 = compose(M, parseMatrix(c.attrs.ItemTransform));
      if (c.name === 'Page') {
        const corners = parseBounds(c.attrs.GeometricBounds);
        if (corners) {
          const rect = bbox(corners.map((p) => apply(M2, p)));
          pages.push({
            id: c.attrs.Self,
            name: c.attrs.Name || String(pages.length + 1),
            rect,
            width: rect.w,
            height: rect.h,
            spreadIndex,
            isMaster,
            masterLabel,
          });
        }
        continue;
      }
      const pts = pathPoints(c);
      if (pts && (TEXT_ITEMS.has(c.name) || GRAPHIC_ITEMS.has(c.name))) {
        const spreadPts = pts.map((p) => apply(M2, p));
        const base = { points: spreadPts, box: bbox(spreadPts), spreadIndex };
        if (TEXT_ITEMS.has(c.name)) {
          items.push({
            ...base,
            id: c.attrs.Self,
            kind: 'text',
            storyId: c.attrs.ParentStory,
            prev: c.attrs.PreviousTextFrame,
            next: c.attrs.NextTextFrame,
          });
        } else {
          let hasGraphic = false;
          for (const d of descendants(c)) if (GRAPHIC_CONTENT.has(d.name)) { hasGraphic = true; break; }
          items.push({ ...base, id: c.attrs.Self, kind: hasGraphic ? 'image' : 'shape' });
          // Texte sur un tracé
          for (const tp of elements(c)) {
            if (tp.name === 'TextPath' && tp.attrs.ParentStory) {
              items.push({ ...base, id: tp.attrs.Self || `${c.attrs.Self}-path`, kind: 'text', storyId: tp.attrs.ParentStory, prev: tp.attrs.PreviousTextFrame, next: tp.attrs.NextTextFrame });
            }
          }
        }
      }
      visit(c, M2);
    }
  };
  visit(spreadEl, IDENTITY);

  // Rattachement de chaque objet à une page (centre contenu, sinon plus grand recouvrement).
  for (const it of items) {
    const cx = it.box.x + it.box.w / 2;
    const cy = it.box.y + it.box.h / 2;
    let page = pages.find((p) => cx >= p.rect.x && cx <= p.rect.x + p.rect.w && cy >= p.rect.y && cy <= p.rect.y + p.rect.h);
    if (!page) {
      let best = 0;
      for (const p of pages) {
        const o = overlap(it.box, p.rect);
        if (o > best) { best = o; page = p; }
      }
    }
    it.pageId = page ? page.id : null;
    const ox = page ? page.rect.x : 0;
    const oy = page ? page.rect.y : 0;
    it.x = it.box.x - ox;
    it.y = it.box.y - oy;
    it.w = it.box.w;
    it.h = it.box.h;
    it.pagePoints = it.points.map(([x, y]) => [x - ox, y - oy]);
  }
  return { pages, items, masterLabel };
}

// ---------------------------------------------------------------- stories
const ACE_LABELS = {
  3: 'fin de style imbriqué',
  4: 'n° de note',
  7: 'retrait jusqu’ici',
  8: 'tabulation de retrait droit',
  18: 'n° de page',
  19: 'marqueur de section',
};

const SKIP_SILENTLY = new Set([
  'Properties', 'XMLAttribute', 'XMLInstruction', 'XMLComment', 'StoryPreference', 'InCopyExportOption',
  'HyperlinkTextDestination', 'ParagraphDestination', 'Bookmark', 'PageReference', 'IndexMarker',
]);
const DESCEND = new Set(['Story', 'ParagraphStyleRange', 'CharacterStyleRange', 'HyperlinkTextSource', 'XMLElement', 'Change', 'HiddenText', 'CrossReferenceSource']);
const ANCHORED = new Set(['TextFrame', 'Rectangle', 'Oval', 'Polygon', 'GraphicLine', 'Group', 'Button', 'EPS', 'PDF', 'Image', 'MultiStateObject', 'EndnoteTextFrame']);

export function styleName(ref, kind) {
  if (!ref) return '';
  let s = ref.replace(/^(CharacterStyle|ParagraphStyle)\//, '');
  s = decodeIdmlName(s).replace(/^\$ID\//, '');
  if (s === '[No character style]') return kind === 'char' ? 'sans style' : s;
  if (s === '[No paragraph style]') return 'sans style';
  if (s === 'NormalParagraphStyle') return 'Paragraphe standard';
  return s;
}

function describeOverrides(csr) {
  const out = [];
  const a = csr.attrs;
  if (a.FontStyle) out.push(a.FontStyle);
  if (a.PointSize) out.push(`${+a.PointSize} pt`);
  if (a.Position && a.Position !== 'Normal') out.push(a.Position === 'Superscript' || a.Position === 'OTSuperscript' ? 'exposant' : a.Position === 'Subscript' || a.Position === 'OTSubscript' ? 'indice' : a.Position);
  if (a.Underline === 'true') out.push('souligné');
  if (a.StrikeThru === 'true') out.push('barré');
  if (a.Capitalization && a.Capitalization !== 'Normal') out.push(a.Capitalization === 'AllCaps' ? 'capitales' : a.Capitalization === 'SmallCaps' ? 'petites capitales' : a.Capitalization);
  if (a.FillColor) out.push(`couleur ${styleName(a.FillColor.replace(/^Color\//, ''))}`);
  const props = child(csr, 'Properties');
  if (props) {
    const font = child(props, 'AppliedFont');
    if (font) out.push((font.children.find((c) => c.type === 'text') || {}).text || 'police');
  }
  const known = new Set(['AppliedCharacterStyle', 'FontStyle', 'PointSize', 'Position', 'Underline', 'StrikeThru', 'Capitalization', 'FillColor']);
  const others = Object.keys(a).filter((k) => !known.has(k));
  if (others.length || (props && elements(props).some((e) => e.name !== 'AppliedFont'))) out.push('autre mise en forme locale');
  return out;
}

/**
 * Extrait les paragraphes et les segments de texte modifiables d'une story.
 * Chaque segment ("piece") correspond à un nœud texte dans un élément <Content>,
 * avec sa position exacte dans le XML source.
 */
export function extractStory(xml, file = '') {
  const doc = parseXml(xml);
  const root = rootElement(doc);
  const storyEl = root.name === 'Story' ? root : elements(root).find((e) => e.name === 'Story');
  if (!storyEl) throw new IdmlError(`Story introuvable dans ${file}`);
  const storyId = storyEl.attrs.Self;

  const pieces = [];
  const stream = []; // ordre du document : pièce ou '\n' (<Br/>)
  const anchoredStories = [];
  const tokens = { count: 0 };
  let paraCounter = 0;

  const newParagraph = (context, paraStyle) => ({
    id: `${storyId}#p${paraCounter++}`,
    storyId,
    context,
    paraStyle,
    items: [],
    deferred: [],
  });

  function run(nodes, context, outParagraphs, startStyle) {
    let current = newParagraph(context, startStyle);
    const flush = () => {
      outParagraphs.push(current, ...current.deferred);
      current.deferred = [];
      current = newParagraph(context, current.paraStyle);
    };
    const addToken = (label) => { current.items.push({ type: 'token', label }); tokens.count++; };

    const visit = (node, st) => {
      if (node.type !== 'el') return;
      const name = node.name;
      if (name === 'ParagraphStyleRange') {
        const ps = styleName(node.attrs.AppliedParagraphStyle, 'para');
        if (!current.items.length) current.paraStyle = ps;
        node.children.forEach((c) => visit(c, { ...st, paraStyle: ps }));
        return;
      }
      if (name === 'CharacterStyleRange') {
        const charStyle = styleName(node.attrs.AppliedCharacterStyle, 'char');
        const overrides = describeOverrides(node);
        const propsEl = child(node, 'Properties');
        const styleKey = JSON.stringify([node.attrs, propsEl ? xml.slice(propsEl.start, propsEl.end) : '', st.wrappers]);
        node.children.forEach((c) => visit(c, { ...st, charStyle, overrides, styleKey }));
        return;
      }
      if (name === 'HyperlinkTextSource' || name === 'CrossReferenceSource') {
        node.children.forEach((c) => visit(c, { ...st, wrappers: [...st.wrappers, name === 'HyperlinkTextSource' ? 'lien' : 'renvoi'] }));
        return;
      }
      if (name === 'Change') {
        if (node.attrs.ChangeType === 'DeletedText') { addToken('texte supprimé (suivi des modifications)'); return; }
        node.children.forEach((c) => visit(c, { ...st, wrappers: [...st.wrappers, 'modif. suivie'] }));
        return;
      }
      if (name === 'Content') {
        const openTag = xml.slice(node.start, node.openEnd);
        const base = {
          storyId, file, openTag, charStyle: st.charStyle, overrides: st.overrides, styleKey: st.styleKey,
          paraStyle: st.paraStyle, wrappers: st.wrappers, paragraphId: current.id,
        };
        const textNodes = node.children.filter((c) => c.type === 'text');
        if (node.selfClosing || !node.children.length) {
          const p = { ...base, id: `${storyId}:${pieces.length}`, start: node.selfClosing ? node.start : node.openEnd, end: node.selfClosing ? node.end : node.openEnd, selfClosing: !!node.selfClosing, original: '' };
          pieces.push(p); stream.push(p); current.items.push({ type: 'piece', piece: p });
          return;
        }
        for (const c of node.children) {
          if (c.type === 'text') {
            const p = { ...base, id: `${storyId}:${pieces.length}`, start: c.start, end: c.end, selfClosing: false, original: c.text.replace(/\r\n?/g, '\n') };
            pieces.push(p); stream.push(p); current.items.push({ type: 'piece', piece: p });
          } else if (c.type === 'pi') {
            const code = c.target === 'ACE' ? parseInt(c.data, 10) : NaN;
            addToken(ACE_LABELS[code] || (c.target === 'ACE' ? `caractère spécial (ACE ${c.data.trim()})` : `instruction ${c.target}`));
            stream.push(`\u0000pi`);
          } else if (c.type === 'cdata') {
            addToken('bloc CDATA');
          }
        }
        if (!textNodes.length) { /* uniquement des codes spéciaux : rien d'éditable */ }
        return;
      }
      if (name === 'Br') {
        stream.push(PARAGRAPH_BREAK);
        flush();
        return;
      }
      if (name === 'Table') {
        addToken('tableau');
        const rows = Number(node.attrs.BodyRowCount || 0) + Number(node.attrs.HeaderRowCount || 0) + Number(node.attrs.FooterRowCount || 0);
        for (const cell of elements(node)) {
          if (cell.name !== 'Cell') continue;
          const [col, row] = (cell.attrs.Name || '0:0').split(':').map(Number);
          const ctx = `Tableau — ligne ${row + 1}${rows ? `/${rows}` : ''}, colonne ${col + 1}`;
          stream.push('\u0000cell');
          run(cell.children, ctx, current.deferred, st.paraStyle);
        }
        return;
      }
      if (name === 'Footnote' || name === 'Endnote') {
        addToken(name === 'Footnote' ? 'note de bas de page' : 'note de fin');
        stream.push('\u0000note');
        run(node.children, name === 'Footnote' ? 'Note de bas de page' : 'Note de fin', current.deferred, st.paraStyle);
        stream.push('\u0000/note');
        return;
      }
      if (name === 'Note') { addToken('note éditoriale InDesign'); return; }
      if (name === 'TextVariableInstance') { addToken(`variable « ${node.attrs.ResultText || node.attrs.Name || ''} »`); return; }
      if (ANCHORED.has(name)) {
        for (const d of [node, ...descendants(node)]) if (d.attrs.ParentStory) anchoredStories.push(d.attrs.ParentStory);
        addToken(name === 'TextFrame' ? 'bloc texte ancré' : name === 'Group' ? 'groupe ancré' : 'objet ancré');
        return;
      }
      if (SKIP_SILENTLY.has(name)) return;
      if (DESCEND.has(name) || findAll(node, 'Content').length) {
        const wrappers = name === 'XMLElement' ? [...st.wrappers, 'balise XML'] : st.wrappers;
        node.children.forEach((c) => visit(c, { ...st, wrappers }));
      }
    };

    const st0 = { paraStyle: startStyle, charStyle: '', overrides: [], styleKey: '', wrappers: [] };
    nodes.forEach((n) => visit(n, st0));
    outParagraphs.push(current, ...current.deferred);
  }

  const all = [];
  run(storyEl.children, '', all, '');

  for (const p of all) {
    p.pieces = p.items.filter((i) => i.type === 'piece').map((i) => i.piece);
    p.visible = p.pieces.some((x) => /\S/.test(x.original));
    p.simple = p.items.length === 1 && p.pieces.length === 1;
    for (const pc of p.pieces) pc.paragraphId = p.id;
  }
  const paragraphs = all.filter((p) => p.visible);
  paragraphs.forEach((p, i) => { p.index = i; });

  return { id: storyId, file, xml, paragraphs, allParagraphs: all, pieces, stream, anchoredStories, tokenCount: tokens.count };
}

/** Texte d'une story dans l'ordre du document, avec des modifications éventuelles. */
export function streamText(story, edits = null) {
  return story.stream.map((s) => (typeof s === 'string' ? s : edits && edits.has(s.id) ? edits.get(s.id) : s.original)).join('');
}

/** Toutes les balises ouvrantes sauf Content/Br : sert à vérifier que la structure est intacte. */
export function structureSignature(xml) {
  const doc = parseXml(xml);
  const out = [];
  for (const d of descendants(doc)) {
    if (d.name === 'Content' || d.name === 'Br') continue;
    out.push(xml.slice(d.start, d.openEnd));
  }
  return out;
}

// ---------------------------------------------------------------- document complet
const decoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: false });

function compareKeys(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? -Infinity;
    const y = b[i] ?? -Infinity;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function orderChain(frames) {
  if (frames.length < 2) return frames;
  const byId = new Map(frames.map((f) => [f.id, f]));
  const start = frames.find((f) => !f.prev || f.prev === 'n' || !byId.has(f.prev)) || frames[0];
  const out = [];
  const seen = new Set();
  for (let f = start; f && !seen.has(f.id); f = byId.get(f.next)) { out.push(f); seen.add(f.id); }
  for (const f of frames) if (!seen.has(f.id)) out.push(f);
  return out;
}

/**
 * Ouvre un fichier IDML (ArrayBuffer ou Uint8Array).
 */
export async function openIdml(input, fileName = 'document.idml') {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const format = sniffFormat(bytes);
  if (format === 'indd') {
    throw new IdmlError('Ce fichier est un document InDesign natif (.indd), pas un fichier IDML.', HINT_EXPORT);
  }
  if (format === 'pdf') throw new IdmlError('Ce fichier est un PDF, pas un fichier IDML.', HINT_EXPORT);
  if (format === 'xml') throw new IdmlError('Ce fichier est un fichier XML isolé (InCopy .icml ou extrait .idms ?), pas un paquet IDML.', HINT_EXPORT);
  if (format !== 'zip') throw new IdmlError("Ce fichier n'est pas un fichier IDML valide.", HINT_EXPORT);

  let zip;
  try { zip = readZip(bytes); } catch (e) {
    throw new IdmlError(`Archive illisible : ${e.message}`, 'Le fichier est peut-être incomplet (téléchargement interrompu). Demandez un nouvel export IDML.');
  }
  const byName = new Map(zip.entries.map((e) => [e.name, e]));
  const mt = byName.get('mimetype');
  if (!mt) throw new IdmlError("Ce fichier ZIP n'est pas un fichier IDML (entrée « mimetype » absente).", HINT_EXPORT);
  const mtText = decoder.decode(await entryData(mt)).trim();
  if (mtText !== IDML_MIMETYPE) {
    throw new IdmlError(`Type de fichier inattendu : « ${mtText} ». Un fichier IDML est attendu.`, mtText.includes('idap') || mtText.includes('incopy') ? 'Il s’agit probablement d’un fichier InCopy. ' + HINT_EXPORT : HINT_EXPORT);
  }
  const dmEntry = byName.get('designmap.xml');
  if (!dmEntry) throw new IdmlError('Fichier IDML incomplet : designmap.xml absent.', HINT_EXPORT);

  const readText = async (name) => {
    const e = byName.get(name);
    if (!e) return null;
    return decoder.decode(await entryData(e));
  };

  try {
    const designmap = parseXml(await readText('designmap.xml'));
    const dm = rootElement(designmap);
    const srcList = (tag) => elements(dm).filter((e) => e.name === tag).map((e) => e.attrs.src).filter(Boolean);
    const spreadFiles = srcList('idPkg:Spread');
    const masterFiles = srcList('idPkg:MasterSpread');
    let storyFiles = srcList('idPkg:Story');
    for (const e of zip.entries) {
      if (/^Stories\/.+\.xml$/.test(e.name) && !storyFiles.includes(e.name)) storyFiles.push(e.name);
    }
    storyFiles = storyFiles.filter((f) => byName.has(f));

    // Dimensions par défaut (préférences du document)
    let defaultSize = null;
    const prefsXml = await readText(srcList('idPkg:Preferences')[0] || 'Resources/Preferences.xml');
    if (prefsXml) {
      const dp = findAll(parseXml(prefsXml), 'DocumentPreference')[0];
      if (dp && dp.attrs.PageWidth) defaultSize = { width: +dp.attrs.PageWidth, height: +dp.attrs.PageHeight };
    }

    const pages = [];
    const frames = [];
    let order = 0;
    const loadSpreads = async (files, isMaster) => {
      for (let i = 0; i < files.length; i++) {
        const xml = await readText(files[i]);
        if (!xml) continue;
        const res = parseSpread(xml, { spreadIndex: (isMaster ? 10000 : 0) + i, isMaster });
        for (const p of res.pages) {
          p.order = order++;
          if (!(p.width > 0 && p.height > 0) && defaultSize) { p.width = defaultSize.width; p.height = defaultSize.height; }
          p.label = isMaster ? `Gabarit ${res.masterLabel}${res.pages.length > 1 ? ` (${res.pages.indexOf(p) === 0 ? 'gauche' : 'droite'})` : ''}` : `Page ${p.name}`;
          pages.push(p);
        }
        for (const it of res.items) { it.isMaster = isMaster; frames.push(it); }
      }
    };
    await loadSpreads(spreadFiles, false);
    await loadSpreads(masterFiles, true);
    const pagesById = new Map(pages.map((p) => [p.id, p]));

    // Stories
    const stories = [];
    const ignored = [];
    for (const f of storyFiles) {
      const xml = await readText(f);
      const s = extractStory(xml, f);
      stories.push(s);
    }
    const storiesById = new Map(stories.map((s) => [s.id, s]));
    const hostOf = new Map();
    for (const s of stories) for (const a of s.anchoredStories) if (!hostOf.has(a)) hostOf.set(a, s.id);

    for (const s of stories) {
      s.frames = orderChain(frames.filter((f) => f.kind === 'text' && f.storyId === s.id));
      s.frames.forEach((f, i) => { f.chainIndex = i; f.chainLength = s.frames.length; });
    }

    const keyCache = new Map();
    const storyKey = (s, depth = 0) => {
      if (keyCache.has(s.id)) return keyCache.get(s.id);
      let key;
      const first = s.frames[0];
      if (first && first.pageId) {
        const p = pagesById.get(first.pageId);
        key = [p.isMaster ? 1 : 0, p.order, Math.round(first.y * 10) / 10, Math.round(first.x * 10) / 10];
        s.pageId = p.id;
        s.placement = p.isMaster ? 'master' : 'page';
      } else if (first) {
        key = [2, first.spreadIndex, first.box.y, first.box.x];
        s.placement = 'pasteboard';
      } else if (hostOf.has(s.id) && depth < 20) {
        const host = storiesById.get(hostOf.get(s.id));
        key = [...storyKey(host, depth + 1), 5, stories.indexOf(s)];
        s.pageId = host.pageId;
        s.placement = host.placement;
        s.anchoredIn = host.id;
      } else {
        key = [3, stories.indexOf(s)];
        s.placement = 'unplaced';
      }
      keyCache.set(s.id, key);
      return key;
    };
    stories.forEach((s) => { s.sortKey = storyKey(s); });

    const editable = [];
    for (const s of stories) {
      if (!s.paragraphs.length) {
        ignored.push({ id: s.id, file: s.file, reason: s.tokenCount ? 'aucun texte (uniquement des objets ou codes spéciaux)' : 'story vide', placement: s.placement });
      } else {
        editable.push(s);
      }
    }
    editable.sort((a, b) => compareKeys(a.sortKey, b.sortKey));
    editable.forEach((s, i) => { s.order = i; s.number = i + 1; });

    // Libellé de chaque frame (premiers mots) pour le plan
    for (const f of frames) {
      if (f.kind !== 'text') continue;
      const s = storiesById.get(f.storyId);
      f.editable = !!(s && s.paragraphs.length);
    }

    const piecesById = new Map();
    for (const s of editable) for (const p of s.paragraphs) for (const pc of p.pieces) piecesById.set(pc.id, pc);

    return {
      fileName,
      bytes,
      zip,
      entriesByName: byName,
      pages: pages.filter((p) => p.isMaster ? frames.some((f) => f.pageId === p.id) : true),
      pagesById,
      frames,
      stories: editable,
      allStories: stories,
      storiesById,
      piecesById,
      ignored,
      defaultSize,
    };
  } catch (e) {
    if (e instanceof IdmlError) throw e;
    if (e instanceof XmlError || e instanceof ZipError) {
      throw new IdmlError(`Fichier IDML endommagé : ${e.message}`, 'Demandez un nouvel export IDML depuis InDesign.');
    }
    throw e;
  }
}

/** Libellé lisible de la position d'une story. */
export function storyLocation(doc, s) {
  const pagesOf = [...new Set(s.frames.map((f) => f.pageId).filter(Boolean))].map((id) => doc.pagesById.get(id));
  if (s.anchoredIn) {
    const host = doc.storiesById.get(s.anchoredIn);
    return `ancré dans le bloc ${host && host.number ? host.number : ''}`.trim();
  }
  if (!pagesOf.length) return s.placement === 'pasteboard' ? 'table de montage (hors page)' : 'non placé dans la mise en page';
  return pagesOf.map((p) => p.label).join(', ');
}

/** Clé du groupe d'affichage (page) d'une story. */
export function storyGroup(doc, s) {
  if (s.pageId) {
    const p = doc.pagesById.get(s.pageId);
    return { key: p.id, label: p.label, order: p.order };
  }
  if (s.placement === 'pasteboard') return { key: '__pasteboard', label: 'Table de montage (hors page)', order: 1e6 };
  return { key: '__unplaced', label: 'Textes non placés', order: 1e6 + 1 };
}

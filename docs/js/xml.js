// Analyseur XML minimal qui conserve la position (offset) de chaque nœud
// dans le texte source. Cela permet de remplacer uniquement le texte situé
// entre <Content> et </Content> sans resérialiser le reste du document.

export class XmlError extends Error {}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, ent) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return ENTITIES[ent] ?? m;
  });
}

/** Échappe un texte pour l'insérer dans un élément XML. */
export function escapeText(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Saut de ligne forcé / séparateur de paragraphe Unicode : encodés pour rester lisibles
    .replace(/\u2028/g, '&#x2028;').replace(/\u2029/g, '&#x2029;');
}

/** Retire les caractères interdits en XML 1.0 (caractères de contrôle, etc.). */
export function stripInvalidXmlChars(s) {
  // Autorisés : \t \n \r, U+0020–U+D7FF, U+E000–U+FFFD, U+10000–U+10FFFF
  return s.replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, '');
}

const NAME_RE = /[^\s/>=]+/y;
const ATTR_RE = /\s*([^\s/>=]+)\s*=\s*("([^"]*)"|'([^']*)')/y;

/**
 * Analyse un document XML.
 * Nœuds produits :
 *   élément : { type:'el', name, attrs, start, end, openEnd, closeStart, selfClosing, children, parent }
 *   texte   : { type:'text', start, end, raw, text }
 *   PI      : { type:'pi', start, end, target, data }
 *   autres  : { type:'comment'|'cdata'|'doctype', start, end, text }
 * `openEnd` = position juste après la balise ouvrante ; `closeStart` = début de la balise fermante.
 */
export function parseXml(src) {
  const root = { type: 'root', children: [], start: 0, end: src.length };
  const stack = [root];
  let i = 0;
  const n = src.length;

  const top = () => stack[stack.length - 1];
  const push = (node) => { node.parent = top(); top().children.push(node); };

  while (i < n) {
    const lt = src.indexOf('<', i);
    const textEnd = lt < 0 ? n : lt;
    if (textEnd > i) {
      const raw = src.slice(i, textEnd);
      if (stack.length > 1) push({ type: 'text', start: i, end: textEnd, raw, text: decodeEntities(raw) });
      else if (raw.trim() && raw.replace(/^﻿/, '').trim()) throw new XmlError(`Texte hors de l'élément racine (position ${i}).`);
    }
    if (lt < 0) break;
    i = lt;

    if (src.startsWith('<?', i)) {
      const e = src.indexOf('?>', i + 2);
      if (e < 0) throw new XmlError('Instruction de traitement non terminée.');
      const body = src.slice(i + 2, e);
      const m = /^(\S+)\s*([\s\S]*)$/.exec(body) || [null, body, ''];
      const node = { type: 'pi', start: i, end: e + 2, target: m[1], data: m[2] };
      if (stack.length > 1) push(node);
      i = e + 2;
    } else if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i + 4);
      if (e < 0) throw new XmlError('Commentaire non terminé.');
      if (stack.length > 1) push({ type: 'comment', start: i, end: e + 3, text: src.slice(i + 4, e) });
      i = e + 3;
    } else if (src.startsWith('<![CDATA[', i)) {
      const e = src.indexOf(']]>', i + 9);
      if (e < 0) throw new XmlError('Section CDATA non terminée.');
      push({ type: 'cdata', start: i, end: e + 3, text: src.slice(i + 9, e) });
      i = e + 3;
    } else if (src.startsWith('<!', i)) {
      // DOCTYPE (éventuellement avec sous-ensemble interne entre crochets)
      let j = i + 2, depth = 0;
      for (; j < n; j++) {
        const ch = src[j];
        if (ch === '[') depth++;
        else if (ch === ']') depth--;
        else if (ch === '>' && depth <= 0) break;
      }
      i = j + 1;
    } else if (src[i + 1] === '/') {
      const e = src.indexOf('>', i);
      if (e < 0) throw new XmlError('Balise fermante non terminée.');
      const name = src.slice(i + 2, e).trim();
      const el = top();
      if (el.type !== 'el' || el.name !== name) {
        throw new XmlError(`Balise fermante inattendue </${name}> (position ${i}).`);
      }
      el.closeStart = i;
      el.end = e + 1;
      stack.pop();
      i = e + 1;
    } else {
      NAME_RE.lastIndex = i + 1;
      const nm = NAME_RE.exec(src);
      if (!nm) throw new XmlError(`Balise invalide (position ${i}).`);
      const el = { type: 'el', name: nm[0], attrs: {}, start: i, children: [] };
      let j = NAME_RE.lastIndex;
      for (;;) {
        ATTR_RE.lastIndex = j;
        const am = ATTR_RE.exec(src);
        if (!am) break;
        el.attrs[am[1]] = decodeEntities(am[3] ?? am[4]);
        j = ATTR_RE.lastIndex;
      }
      while (j < n && /\s/.test(src[j])) j++;
      if (src.startsWith('/>', j)) {
        el.selfClosing = true;
        el.openEnd = el.closeStart = j + 2;
        el.end = j + 2;
        if (stack.length === 1 && root.children.some((c) => c.type === 'el')) throw new XmlError('Plusieurs éléments racines.');
        push(el);
        i = j + 2;
      } else if (src[j] === '>') {
        el.openEnd = j + 1;
        if (stack.length === 1 && root.children.some((c) => c.type === 'el')) throw new XmlError('Plusieurs éléments racines.');
        push(el);
        stack.push(el);
        i = j + 1;
      } else {
        throw new XmlError(`Balise <${el.name}> mal formée (position ${i}).`);
      }
    }
  }
  if (stack.length > 1) throw new XmlError(`Élément <${top().name}> non fermé.`);
  if (!root.children.some((c) => c.type === 'el')) throw new XmlError('Document XML vide.');
  return root;
}

// ---------------------------------------------------------------- aides de parcours
export function elements(node) {
  return (node.children || []).filter((c) => c.type === 'el');
}

export function child(node, name) {
  return elements(node).find((c) => c.name === name) || null;
}

export function rootElement(doc) {
  return elements(doc)[0];
}

/** Parcours en profondeur de tous les éléments descendants. */
export function* descendants(node) {
  for (const c of node.children || []) {
    if (c.type === 'el') {
      yield c;
      yield* descendants(c);
    }
  }
}

export function findAll(node, name) {
  const out = [];
  for (const d of descendants(node)) if (d.name === name) out.push(d);
  return out;
}

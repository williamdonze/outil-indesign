// Modèle des modifications (indépendant de l'interface, donc testable).
// Les modifications sont une Map : identifiant de segment -> nouveau texte.

import { crc32 } from './zip.js';
import { normalizeInput } from './writer.js';

export const OVERFLOW_THRESHOLD = 10; // % d'augmentation au-delà duquel on alerte

/** Saut de ligne forcé (U+2028) affiché de façon visible dans les champs. */
export const LINE_BREAK_DISPLAY = '↲';

export function toDisplay(text) {
  return text.replace(/\u2028/g, LINE_BREAK_DISPLAY);
}

export function fromDisplay(text) {
  return normalizeInput(text.replace(/↲/g, '\u2028'));
}

export function pieceText(piece, edits) {
  return edits.has(piece.id) ? edits.get(piece.id) : piece.original;
}

export function paragraphText(paragraph, edits) {
  return paragraph.pieces.map((p) => pieceText(p, edits)).join('');
}

export function paragraphOriginal(paragraph) {
  return paragraph.pieces.map((p) => p.original).join('');
}

/** Nombre de caractères (points de code), sauts de paragraphe exclus. */
export function charCount(text) {
  let n = 0;
  for (const ch of text) if (ch !== '\n') n++;
  return n;
}

export function delta(original, current) {
  const o = charCount(original);
  const c = charCount(current);
  const diff = c - o;
  const pct = o === 0 ? (c === 0 ? 0 : Infinity) : (diff / o) * 100;
  return { original: o, current: c, diff, pct, alert: pct > OVERFLOW_THRESHOLD };
}

export function formatPct(pct) {
  if (pct === Infinity) return 'nouveau';
  const r = Math.round(pct * 10) / 10;
  return `${r > 0 ? '+' : ''}${String(r).replace('.', ',')} %`;
}

export function isPieceModified(piece, edits) {
  return edits.has(piece.id) && edits.get(piece.id) !== piece.original;
}

export function isParagraphModified(paragraph, edits) {
  return paragraph.pieces.some((p) => isPieceModified(p, edits));
}

export function storyStats(story, edits) {
  let o = '', c = '';
  let modified = 0;
  for (const p of story.paragraphs) {
    o += paragraphOriginal(p) + '\n';
    c += paragraphText(p, edits) + '\n';
    if (isParagraphModified(p, edits)) modified++;
  }
  return { ...delta(o, c), modified };
}

/** Retire les entrées identiques à l'original. */
export function cleanEdits(doc, edits) {
  const out = new Map();
  for (const [id, text] of edits) {
    const pc = doc.piecesById.get(id);
    if (pc && text !== pc.original) out.set(id, text);
  }
  return out;
}

export function countModifiedParagraphs(doc, edits) {
  let n = 0;
  for (const s of doc.stories) for (const p of s.paragraphs) if (isParagraphModified(p, edits)) n++;
  return n;
}

export function fingerprint(bytes) {
  return `${crc32(bytes).toString(16).padStart(8, '0')}-${bytes.length}`;
}

// ---------------------------------------------------------------- JSON
export const JSON_FORMAT = 'outil-indesign/modifications';

export function serializeEdits(doc, edits, date = new Date()) {
  const clean = cleanEdits(doc, edits);
  const items = {};
  for (const [id, text] of clean) {
    const pc = doc.piecesById.get(id);
    items[id] = { original: pc.original, texte: text };
  }
  return {
    format: JSON_FORMAT,
    version: 1,
    fichier: { nom: doc.fileName, empreinte: fingerprint(doc.bytes) },
    date: date.toISOString(),
    modifications: items,
  };
}

/**
 * Applique un JSON exporté précédemment.
 * Une modification n'est appliquée que si le texte original correspond,
 * pour éviter d'écraser un texte que le graphiste aurait changé entre-temps.
 */
export function importEdits(doc, json, edits) {
  if (!json || json.format !== JSON_FORMAT || typeof json.modifications !== 'object') {
    throw new Error("Ce fichier JSON n'est pas un export de modifications de cet outil.");
  }
  const next = new Map(edits);
  const result = { applied: 0, conflicts: [], unknown: 0, sameFile: json.fichier && json.fichier.empreinte === fingerprint(doc.bytes) };
  for (const [id, item] of Object.entries(json.modifications)) {
    if (!item || typeof item.texte !== 'string') continue;
    const pc = doc.piecesById.get(id);
    if (!pc) { result.unknown++; continue; }
    if (typeof item.original === 'string' && item.original !== pc.original) {
      result.conflicts.push({ id, expected: item.original, actual: pc.original, wanted: item.texte });
      continue;
    }
    next.set(id, normalizeInput(item.texte));
    result.applied++;
  }
  return { edits: cleanEdits(doc, next), result };
}

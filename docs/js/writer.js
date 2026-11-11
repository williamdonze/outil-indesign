// Réécriture d'un IDML : seules les balises <Content> des stories modifiées changent.

import { readZip, writeZip, makeEntry, entryData, physicalOrder } from './zip.js';
import { escapeText, stripInvalidXmlChars } from './xml.js';
import { extractStory, streamText, structureSignature, IDML_MIMETYPE, PARAGRAPH_BREAK } from './idml.js';

export class ExportError extends Error {}

/** Normalise un texte saisi : fins de ligne, caractères interdits en XML. */
export function normalizeInput(text) {
  return stripInvalidXmlChars(String(text).replace(/\r\n?/g, '\n'));
}

/** Modifications effectives (différentes de l'original) pour une story. */
export function storyEdits(story, edits) {
  const out = new Map();
  for (const pc of story.pieces) {
    if (!edits.has(pc.id)) continue;
    const t = normalizeInput(edits.get(pc.id));
    if (t !== pc.original) out.set(pc.id, t);
  }
  return out;
}

/**
 * Produit le nouveau XML d'une story. Tout ce qui est hors du texte des
 * balises <Content> modifiées est recopié tel quel.
 * Un "\n" dans le texte devient un nouveau paragraphe :
 *   </Content><Br/><Content>  (même CharacterStyleRange, donc mêmes styles)
 */
export function rewriteStoryXml(story, effective) {
  const changed = story.pieces.filter((p) => effective.has(p.id)).sort((a, b) => a.start - b.start);
  if (!changed.length) return story.xml;
  const src = story.xml;
  let out = '';
  let pos = 0;
  for (const pc of changed) {
    const text = effective.get(pc.id);
    const parts = text.split(PARAGRAPH_BREAK).map(escapeText);
    const closeOpen = `</Content><Br/>${pc.openTag === '<Content/>' || pc.openTag.endsWith('/>') ? '<Content>' : pc.openTag}`;
    let replacement = parts.join(closeOpen);
    if (pc.selfClosing) replacement = `<Content>${replacement}</Content>`;
    out += src.slice(pos, pc.start) + replacement;
    pos = pc.end;
  }
  return out + src.slice(pos);
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { ignoreBOM: true });

/**
 * Construit le fichier IDML modifié.
 * @param doc   document renvoyé par openIdml
 * @param edits Map pieceId -> texte (représentation interne)
 * @returns { bytes, changedFiles, check }
 */
export async function exportIdml(doc, edits) {
  const newXml = new Map(); // nom de fichier -> { xml, story, effective }
  for (const s of doc.allStories) {
    const effective = storyEdits(s, edits);
    if (!effective.size) continue;
    newXml.set(s.file, { xml: rewriteStoryXml(s, effective), story: s, effective });
  }

  const ordered = physicalOrder(doc.zip);
  const mimetype = ordered.find((e) => e.name === 'mimetype');
  const rest = ordered.filter((e) => e !== mimetype);

  const outEntries = [];
  // 1. mimetype : première entrée, non compressée
  if (mimetype.method === 0) outEntries.push(mimetype);
  else outEntries.push(await makeEntry(mimetype, await entryData(mimetype), { forceStore: true }));
  // 2. les autres, dans l'ordre d'origine
  for (const e of rest) {
    const mod = newXml.get(e.name);
    if (mod) outEntries.push(await makeEntry(e, enc.encode(mod.xml)));
    else outEntries.push(e);
  }

  const bytes = writeZip(outEntries);
  const check = await verifyExport(doc, bytes, newXml);
  return { bytes, changedFiles: [...newXml.keys()], check };
}

/**
 * Relit le fichier produit et vérifie :
 *  - mimetype en première position, non compressé, sans champ extra ;
 *  - toutes les entrées présentes, dans le même ordre ;
 *  - entrées non modifiées identiques octet pour octet (données compressées comprises) ;
 *  - stories modifiées : XML bien formé, structure (styles, attributs) identique,
 *    texte final conforme aux modifications.
 */
export async function verifyExport(doc, bytes, newXml) {
  const fail = (msg) => { throw new ExportError(`Vérification du fichier exporté échouée : ${msg}`); };
  const out = readZip(bytes);
  const phys = physicalOrder(out);
  const first = phys[0];
  if (!first || first.name !== 'mimetype') fail('« mimetype » n’est pas la première entrée.');
  if (first.method !== 0) fail('« mimetype » est compressé.');
  if (first.localOffset !== 0 || first.localExtraLen !== 0) fail('« mimetype » mal positionné.');
  if (dec.decode(await entryData(first)) !== IDML_MIMETYPE) fail('contenu de « mimetype » incorrect.');

  const origNames = physicalOrder(doc.zip).map((e) => e.name).filter((n) => n !== 'mimetype');
  const newNames = phys.slice(1).map((e) => e.name);
  if (origNames.join('\n') !== newNames.join('\n')) fail('la liste des fichiers a changé.');

  let identical = 0;
  for (const e of phys.slice(1)) {
    const orig = doc.entriesByName.get(e.name);
    if (newXml.has(e.name)) {
      const { xml, story, effective } = newXml.get(e.name);
      const got = dec.decode(await entryData(e));
      if (got !== xml) fail(`contenu inattendu pour ${e.name}.`);
      let re;
      try { re = extractStory(got, e.name); } catch (err) { fail(`${e.name} n’est plus un XML valide (${err.message}).`); }
      const a = structureSignature(story.xml);
      const b = structureSignature(got);
      if (a.length !== b.length || a.some((t, i) => t !== b[i])) fail(`la structure (styles/attributs) de ${e.name} a changé.`);
      if (streamText(re) !== streamText(story, effective)) fail(`le texte relu dans ${e.name} ne correspond pas aux modifications.`);
    } else {
      if (e.crc32 !== orig.crc32 || e.size !== orig.size || e.method !== orig.method || !sameBytes(e.raw, orig.raw)) {
        fail(`${e.name} a été modifié alors qu’il ne devait pas l’être.`);
      }
      identical++;
    }
  }
  return { ok: true, entries: phys.length, identical, modified: newXml.size };
}

/** Nom du fichier exporté : <nom_original>_textes_<AAAA-MM-JJ>.idml */
export function exportFileName(originalName, date = new Date()) {
  const base = originalName.replace(/\.idml$/i, '');
  const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `${base}_textes_${d}.idml`;
}

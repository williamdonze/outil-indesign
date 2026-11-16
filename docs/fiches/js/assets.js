/**
 * Chargement des ressources fixes du site :
 *  - polices (Zeitung Pro importées dans le navigateur, sinon déposées dans
 *    fonts/, sinon police de secours libre Mulish) ;
 *  - logos interchangeables (dossier logos/ : logo-1 et logo-2) ;
 *  - pictogrammes Implication / Matériel / Temps (dossier pictos/).
 */
import { getFile, putFile, deleteFile } from './db.js';
import { imageType } from './render.js';

export const FONT_ROLES = [
  { key: 'regular', label: 'Regular', file: 'ZeitungPro-Regular' },
  { key: 'semibold', label: 'Semibold', file: 'ZeitungPro-Semibold' },
  { key: 'bold', label: 'Bold', file: 'ZeitungPro-Bold' },
];

const FALLBACK = {
  regular: 'fonts/secours/Mulish-Medium.ttf',
  semibold: 'fonts/secours/Mulish-Bold.ttf',
  bold: 'fonts/secours/Mulish-ExtraBold.ttf',
};

async function fetchBytes(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    // GitHub Pages renvoie parfois une page HTML 404 avec un code 200 via un proxy : on vérifie.
    if (buf.length < 16 || (buf[0] === 0x3c /* < */)) return null;
    return buf;
  } catch {
    return null;
  }
}

/**
 * @returns {{ source: 'navigateur'|'dossier'|'secours', name: string, regular, semibold, bold }}
 */
export async function loadFonts() {
  // 1. polices importées dans ce navigateur
  const stored = {};
  for (const r of FONT_ROLES) {
    const f = await getFile('font:' + r.key).catch(() => null);
    if (f) stored[r.key] = f.bytes;
  }
  if (FONT_ROLES.every((r) => stored[r.key])) return { source: 'navigateur', name: 'Zeitung Pro', ...stored };

  // 2. polices déposées dans le dossier fonts/ du site
  const folder = {};
  for (const r of FONT_ROLES) {
    folder[r.key] = (await fetchBytes(`fonts/${r.file}.otf`)) || (await fetchBytes(`fonts/${r.file}.ttf`));
  }
  if (FONT_ROLES.every((r) => folder[r.key])) return { source: 'dossier', name: 'Zeitung Pro', ...folder };

  // 3. police de secours
  const fb = {};
  for (const r of FONT_ROLES) fb[r.key] = await fetchBytes(FALLBACK[r.key]);
  if (!FONT_ROLES.every((r) => fb[r.key])) throw new Error('Polices introuvables : vérifiez le dossier fonts/secours/.');
  const missing = FONT_ROLES.filter((r) => stored[r.key] || folder[r.key]).length;
  return { source: 'secours', name: 'Mulish (police de secours)', partial: missing > 0, ...fb };
}

/** Devine la graisse d'un fichier de police (nom PostScript, sinon nom de fichier). */
export function guessRole(fontkit, bytes, fileName) {
  let names = fileName || '';
  try {
    const f = fontkit.create(bytes);
    names = `${f.postscriptName || ''} ${f.subfamilyName || ''} ${fileName || ''}`;
  } catch { /* fichier illisible : on garde le nom */ }
  const n = names.toLowerCase().replace(/[\s_-]+/g, '');
  if (/italic|oblique/.test(n)) return null;
  if (/semibold|demibold|semi|demi/.test(n)) return 'semibold';
  if (/extrabold|ultrabold|black|heavy/.test(n)) return null;
  if (/bold/.test(n)) return 'bold';
  if (/regular|book|roman|normal/.test(n)) return 'regular';
  return null;
}

export async function storeFont(role, name, bytes) {
  await putFile('font:' + role, { name, type: 'font', bytes });
}

export async function clearStoredFonts() {
  for (const r of FONT_ROLES) await deleteFile('font:' + r.key);
}

/** Logos 1 et 2 : logos/logo-1.png|jpg|jpeg et logos/logo-2.png|jpg|jpeg */
export async function loadLogos() {
  const out = {};
  for (const n of [1, 2]) {
    for (const ext of ['png', 'jpg', 'jpeg']) {
      const url = `logos/logo-${n}.${ext}`;
      const bytes = await fetchBytes(url);
      if (bytes && imageType(bytes)) { out[n] = { bytes, url }; break; }
    }
  }
  return out;
}

export async function loadPictos() {
  const out = {};
  for (const k of ['implication', 'materiel', 'temps']) {
    const bytes = await fetchBytes(`pictos/${k}.png`);
    if (bytes) out[`picto-${k}`] = bytes;
  }
  return out;
}

/** Décode des octets d'image en ImageBitmap (pour l'aperçu). */
export async function toBitmap(bytes) {
  const t = imageType(bytes);
  const blob = new Blob([bytes], { type: t === 'png' ? 'image/png' : 'image/jpeg' });
  return createImageBitmap(blob);
}

/**
 * Prépare une image choisie par l'utilisateur : tout format lisible par
 * le navigateur (JPEG, PNG, HEIC sur Safari, WebP…) est converti en JPEG,
 * fond blanc, 2400 px maximum de côté.
 */
export async function normalizePhoto(file) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error(`Image illisible : ${file.name}`);
  const MAX = 2400;
  const s = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s));
  const h = Math.max(1, Math.round(bmp.height * s));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close && bmp.close();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
  return new Uint8Array(await blob.arrayBuffer());
}

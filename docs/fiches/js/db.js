/**
 * Stockage local :
 *  - la base des fiches (textes, choix du logo, références des fichiers)
 *    est enregistrée dans le localStorage du navigateur ;
 *  - les fichiers lourds (images, PDF annexes, polices importées) sont
 *    enregistrés dans IndexedDB : le localStorage est limité à ~5 Mo,
 *    trop peu pour des PDF.
 * Rien n'est envoyé sur Internet.
 */
import { FIELDS, SAMPLE } from './layout.js';

const LS_KEY = 'fichesPDF.db.v1';
const IDB_NAME = 'fichesPDF';
const IDB_STORE = 'files';

export const BACKUP_APP = 'fiches-pdf';
export const BACKUP_VERSION = 1;

export function uid(prefix = 'f') {
  const r = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${r.replace(/-/g, '').slice(0, 16)}`;
}

export function blankEntry(values = {}) {
  const e = { id: uid('fiche'), fichier: '', logo: 1, photo: null, annex: null, selected: false, updated: Date.now() };
  for (const f of FIELDS) e[f.key] = '';
  return Object.assign(e, values);
}

export function sampleEntry() {
  return blankEntry({ ...SAMPLE });
}

/** Nettoie une fiche venant du stockage ou d'une sauvegarde. */
export function normalizeEntry(raw) {
  const e = blankEntry();
  if (!raw || typeof raw !== 'object') return e;
  for (const f of FIELDS) e[f.key] = typeof raw[f.key] === 'string' ? raw[f.key] : '';
  e.id = typeof raw.id === 'string' && raw.id ? raw.id : e.id;
  e.fichier = typeof raw.fichier === 'string' ? raw.fichier : '';
  e.logo = raw.logo === 2 || raw.logo === '2' ? 2 : 1;
  e.photo = fileRef(raw.photo);
  e.annex = fileRef(raw.annex);
  if (e.annex && Number.isFinite(raw.annex.pages)) e.annex.pages = raw.annex.pages;
  e.selected = !!raw.selected;
  e.updated = Number(raw.updated) || Date.now();
  return e;
}

function fileRef(r) {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string') return null;
  return { id: r.id, name: typeof r.name === 'string' ? r.name : 'fichier', size: Number(r.size) || 0 };
}

// ------------------------------------------------------------ localStorage
export function loadDb() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return { entries: (Array.isArray(data.entries) ? data.entries : []).map(normalizeEntry) };
  } catch (e) {
    console.warn('Lecture du localStorage impossible', e);
    return null;
  }
}

export function saveDb(db) {
  localStorage.setItem(LS_KEY, JSON.stringify({ version: BACKUP_VERSION, savedAt: new Date().toISOString(), entries: db.entries }));
}

// ------------------------------------------------------------ IndexedDB
let dbPromise = null;
function idb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return idb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(IDB_STORE, mode);
    const store = t.objectStore(IDB_STORE);
    let result;
    const req = fn(store);
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

/** { name, type, bytes: Uint8Array } */
export function putFile(id, file) {
  return tx('readwrite', (s) => s.put({ name: file.name, type: file.type, bytes: file.bytes }, id));
}
export async function getFile(id) {
  const r = await tx('readonly', (s) => s.get(id));
  if (!r) return null;
  return { name: r.name, type: r.type, bytes: r.bytes instanceof Uint8Array ? r.bytes : new Uint8Array(r.bytes) };
}
export function deleteFile(id) {
  return tx('readwrite', (s) => s.delete(id));
}
export function listFileIds() {
  return tx('readonly', (s) => s.getAllKeys());
}

/** Supprime les fichiers qui ne sont plus référencés par aucune fiche. */
export async function collectGarbage(entries) {
  const used = new Set();
  for (const e of entries) {
    if (e.photo) used.add(e.photo.id);
    if (e.annex) used.add(e.annex.id);
  }
  const ids = await listFileIds();
  for (const id of ids) {
    if (String(id).startsWith('font:')) continue;
    if (!used.has(id)) await deleteFile(id);
  }
}

// ------------------------------------------------------------ sauvegarde fichier
function toBase64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
function fromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Construit le fichier de sauvegarde (.json) : fiches + images + PDF annexes. */
export async function buildBackup(entries) {
  const files = {};
  for (const e of entries) {
    for (const ref of [e.photo, e.annex]) {
      if (!ref || files[ref.id]) continue;
      const f = await getFile(ref.id);
      if (f) files[ref.id] = { name: f.name, type: f.type, data: toBase64(f.bytes) };
    }
  }
  return JSON.stringify({
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    entries,
    files,
  });
}

/** Lit un fichier de sauvegarde ; renvoie { entries, files } sans rien enregistrer. */
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Ce fichier n’est pas une sauvegarde valide (JSON illisible).'); }
  if (!data || data.app !== BACKUP_APP || !Array.isArray(data.entries)) {
    throw new Error('Ce fichier n’est pas une sauvegarde de l’outil « Fiches PDF ».');
  }
  const files = {};
  for (const [id, f] of Object.entries(data.files || {})) {
    if (f && typeof f.data === 'string') files[id] = { name: f.name || 'fichier', type: f.type || '', bytes: fromBase64(f.data) };
  }
  return { entries: data.entries.map(normalizeEntry), files };
}

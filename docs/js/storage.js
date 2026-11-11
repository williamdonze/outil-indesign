// Sauvegarde locale (IndexedDB) : le fichier d'origine et les modifications
// restent dans le navigateur, rien n'est envoyé ailleurs.

const DB_NAME = 'outil-indesign';
const STORE = 'projets';
const LS_PREFIX = 'outil-indesign:modifs:';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB indisponible')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(store, (r) => { result = r; })).catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const req2p = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

/** Enregistre (ou met à jour) un projet : { id, fileName, bytes, edits:Object, updatedAt } */
export async function saveProject(project) {
  try {
    await tx('readwrite', (store) => { store.put(project); });
    return 'indexeddb';
  } catch {
    // Repli : on garde au moins les modifications.
    try {
      localStorage.setItem(LS_PREFIX + project.id, JSON.stringify({ fileName: project.fileName, edits: project.edits, updatedAt: project.updatedAt }));
      return 'localstorage';
    } catch { return null; }
  }
}

/** Met à jour uniquement les modifications d'un projet existant. */
export async function saveEdits(id, edits) {
  const updatedAt = Date.now();
  try {
    await tx('readwrite', async (store) => {
      const p = await req2p(store.get(id));
      if (p) { p.edits = edits; p.updatedAt = updatedAt; store.put(p); }
    });
    return updatedAt;
  } catch {
    try {
      const prev = JSON.parse(localStorage.getItem(LS_PREFIX + id) || '{}');
      localStorage.setItem(LS_PREFIX + id, JSON.stringify({ ...prev, edits, updatedAt }));
      return updatedAt;
    } catch { return null; }
  }
}

export async function getProject(id) {
  try {
    const p = await tx('readonly', async (store, done) => { done(await req2p(store.get(id))); });
    if (p) return p;
  } catch { /* repli ci-dessous */ }
  try {
    const raw = localStorage.getItem(LS_PREFIX + id);
    return raw ? { id, ...JSON.parse(raw) } : null;
  } catch { return null; }
}

export async function listProjects() {
  try {
    const all = await tx('readonly', async (store, done) => { done(await req2p(store.getAll())); });
    return (all || []).map(({ id, fileName, edits, updatedAt, bytes }) => ({ id, fileName, updatedAt, count: Object.keys(edits || {}).length, size: bytes ? bytes.byteLength : 0 }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch { return []; }
}

export async function deleteProject(id) {
  try { await tx('readwrite', (store) => { store.delete(id); }); } catch { /* ignore */ }
  try { localStorage.removeItem(LS_PREFIX + id); } catch { /* ignore */ }
}

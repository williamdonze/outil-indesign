// Lecture / écriture ZIP minimale, sans dépendance.
//
// Points clés pour l'IDML :
//  - les entrées non modifiées sont recopiées avec leurs octets compressés
//    d'origine (aucune recompression), donc identiques octet pour octet ;
//  - l'entrée "mimetype" est toujours écrite en premier, sans compression
//    (méthode 0) et sans champ "extra", comme l'exige InDesign ;
//  - la (dé)compression utilise les API natives CompressionStream /
//    DecompressionStream ("deflate-raw"), disponibles dans les navigateurs
//    récents et dans Node >= 18.

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

export class ZipError extends Error {}

// ---------------------------------------------------------------- CRC-32
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

// ---------------------------------------------------------------- utilitaires
async function streamThrough(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new ZipError("Ce navigateur ne sait pas décompresser les fichiers ZIP (DecompressionStream absent). Utilisez une version récente de Firefox, Chrome, Edge ou Safari.");
  }
  return streamThrough(bytes, new DecompressionStream('deflate-raw'));
}

export async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'undefined') return null; // repli : stockage sans compression
  return streamThrough(bytes, new CompressionStream('deflate-raw'));
}

const textDecoder = new TextDecoder('utf-8');

// ---------------------------------------------------------------- lecture
/**
 * Lit la structure d'un ZIP. Les données ne sont pas décompressées ici :
 * chaque entrée garde une vue `raw` sur ses octets compressés d'origine.
 */
export function readZip(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22) throw new ZipError('Fichier trop petit pour être une archive ZIP.');

  // Recherche de la fin du répertoire central (EOCD), en partant de la fin.
  let eocd = -1;
  const minPos = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= minPos; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError("Archive ZIP invalide : fin du répertoire central introuvable.");

  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new ZipError('Archive ZIP64 non prise en charge.');
  }
  if (cdOffset + cdSize > bytes.length) throw new ZipError('Archive ZIP tronquée ou corrompue.');

  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== SIG_CENTRAL) throw new ZipError('Répertoire central ZIP corrompu.');
    const e = {
      versionMadeBy: view.getUint16(p + 4, true),
      versionNeeded: view.getUint16(p + 6, true),
      flags: view.getUint16(p + 8, true),
      method: view.getUint16(p + 10, true),
      modTime: view.getUint16(p + 12, true),
      modDate: view.getUint16(p + 14, true),
      crc32: view.getUint32(p + 16, true),
      compressedSize: view.getUint32(p + 20, true),
      size: view.getUint32(p + 24, true),
      internalAttr: view.getUint16(p + 36, true),
      externalAttr: view.getUint32(p + 38, true),
      localOffset: view.getUint32(p + 42, true),
    };
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    e.nameBytes = bytes.slice(p + 46, p + 46 + nameLen);
    e.name = textDecoder.decode(e.nameBytes);
    p += 46 + nameLen + extraLen + commentLen;

    if (e.flags & 0x1) throw new ZipError(`Entrée chiffrée non prise en charge : ${e.name}`);
    if (e.compressedSize === 0xffffffff || e.size === 0xffffffff || e.localOffset === 0xffffffff) {
      throw new ZipError('Archive ZIP64 non prise en charge.');
    }
    if (e.method !== 0 && e.method !== 8) {
      throw new ZipError(`Méthode de compression non prise en charge (${e.method}) pour ${e.name}`);
    }

    const lo = e.localOffset;
    if (lo + 30 > bytes.length || view.getUint32(lo, true) !== SIG_LOCAL) {
      throw new ZipError(`En-tête local ZIP invalide pour ${e.name}`);
    }
    const lNameLen = view.getUint16(lo + 26, true);
    const lExtraLen = view.getUint16(lo + 28, true);
    e.localExtraLen = lExtraLen;
    const dataStart = lo + 30 + lNameLen + lExtraLen;
    if (dataStart + e.compressedSize > bytes.length) throw new ZipError(`Données tronquées pour ${e.name}`);
    e.raw = bytes.subarray(dataStart, dataStart + e.compressedSize);
    entries.push(e);
  }
  return { entries, firstLocalOffset: entries.length ? Math.min(...entries.map((e) => e.localOffset)) : 0 };
}

/** Renvoie le contenu décompressé d'une entrée. */
export async function entryData(entry) {
  let data;
  if (entry.method === 0) data = entry.raw.slice();
  else data = await inflateRaw(entry.raw);
  if (data.length !== entry.size || crc32(data) !== entry.crc32) {
    throw new ZipError(`Contrôle d'intégrité (CRC) échoué pour ${entry.name}`);
  }
  return data;
}

/** Entrées dans l'ordre physique de l'archive (ordre des en-têtes locaux). */
export function physicalOrder(zip) {
  return [...zip.entries].sort((a, b) => a.localOffset - b.localOffset);
}

// ---------------------------------------------------------------- écriture
/**
 * Prépare une entrée modifiée à partir de son contenu décompressé.
 * `forceStore` : pas de compression (utilisé pour "mimetype").
 */
export async function makeEntry(template, data, { forceStore = false } = {}) {
  let method = 0;
  let raw = data;
  if (!forceStore) {
    const deflated = await deflateRaw(data);
    if (deflated && deflated.length < data.length) { method = 8; raw = deflated; }
  }
  return {
    ...template,
    method,
    raw,
    crc32: crc32(data),
    size: data.length,
    compressedSize: raw.length,
    localExtraLen: 0,
  };
}

/**
 * Écrit une archive ZIP. Les entrées sont écrites dans l'ordre donné ;
 * l'appelant doit placer "mimetype" en premier (voir writer.js).
 * Aucun champ "extra", aucun descripteur de données (bit 3 effacé).
 */
export function writeZip(entries) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = e.nameBytes || enc.encode(e.name);
    const flags = (e.flags || 0) & 0x0800; // on ne garde que le drapeau UTF-8
    const versionNeeded = e.method === 8 ? 20 : 10;
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, SIG_LOCAL, true);
    lv.setUint16(4, versionNeeded, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, e.method, true);
    lv.setUint16(10, e.modTime || 0, true);
    lv.setUint16(12, e.modDate || 0x21, true);
    lv.setUint32(14, e.crc32, true);
    lv.setUint32(18, e.raw.length, true);
    lv.setUint32(22, e.size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    parts.push(local, e.raw);

    const c = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, SIG_CENTRAL, true);
    cv.setUint16(4, e.versionMadeBy || 20, true);
    cv.setUint16(6, versionNeeded, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, e.method, true);
    cv.setUint16(12, e.modTime || 0, true);
    cv.setUint16(14, e.modDate || 0x21, true);
    cv.setUint32(16, e.crc32, true);
    cv.setUint32(20, e.raw.length, true);
    cv.setUint32(24, e.size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, e.internalAttr || 0, true);
    cv.setUint32(38, e.externalAttr || 0, true);
    cv.setUint32(42, offset, true);
    c.set(nameBytes, 46);
    central.push(c);

    offset += local.length + e.raw.length;
  }

  const cdStart = offset;
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, SIG_EOCD, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);

  const total = cdStart + cdSize + 22;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of [...parts, ...central, eocd]) { out.set(part, p); p += part.length; }
  return out;
}

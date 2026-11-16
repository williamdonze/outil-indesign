/**
 * Dessin de la liste d'éléments produite par layout.js :
 *  - buildPdf()   → PDF (pdf-lib), avec PDF annexe greffé à la suite ;
 *  - drawPreview() → aperçu dans un <canvas>.
 * Fonctionne dans le navigateur et dans Node (tests) : les librairies
 * pdf-lib et fontkit sont passées en paramètre.
 */
import { PAGE, layoutPage } from './layout.js';

export const FONT_KEYS = ['regular', 'semibold', 'bold'];

/** Type d'image d'après les premiers octets. */
export function imageType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  return null;
}

/** Police OpenType à contours CFF (fichier .otf « OTTO ») ? */
function isCff(bytes) {
  return bytes[0] === 0x4f && bytes[1] === 0x54 && bytes[2] === 0x54 && bytes[3] === 0x4f;
}

/**
 * Fonction de mesure (largeur en points) à partir des fichiers de police.
 * Même calcul que pdf-lib (somme des chasses des glyphes, sans crénage),
 * pour que l'aperçu et le PDF coupent les lignes au même endroit.
 */
export function makeMeasure(fontkit, fonts) {
  const faces = {};
  for (const k of FONT_KEYS) faces[k] = fontkit.create(fonts[k]);
  const cache = new Map();
  const measure = (text, font, size) => {
    const id = font + '|' + text;
    let units = cache.get(id);
    if (units === undefined) {
      const face = faces[font];
      const run = face.layout(text);
      units = run.glyphs.reduce((s, g) => s + g.advanceWidth, 0) / face.unitsPerEm;
      if (cache.size > 20000) cache.clear();
      cache.set(id, units);
    }
    return units * size;
  };
  measure.faces = faces;
  return measure;
}

function pdfColor(PDFLib, c) {
  if (c.cmyk) return PDFLib.cmyk(...c.cmyk);
  return PDFLib.rgb(c.rgb[0] / 255, c.rgb[1] / 255, c.rgb[2] / 255);
}

/** Rectangle de l'image selon le mode d'ajustement. */
export function fitBox(box, iw, ih, fit) {
  if (fit === 'fill' || !iw || !ih) return { x: box.x, y: box.y, w: box.w, h: box.h };
  const s = fit === 'cover' ? Math.max(box.w / iw, box.h / ih) : Math.min(box.w / iw, box.h / ih);
  const w = iw * s;
  const h = ih * s;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

const K = 0.5522847498; // approximation du cercle par 4 courbes de Bézier

/**
 * Génère le PDF d'une fiche.
 * @param {object} o
 * @param {object} o.entry   champs de la fiche
 * @param {object} o.fonts   { regular, semibold, bold } : Uint8Array
 * @param {object} o.images  { photo?, logo?, 'picto-…' } : Uint8Array (PNG ou JPEG)
 * @param {Uint8Array?} o.annex PDF à ajouter après la page de titre
 * @param {Function} o.measure  (facultatif) résultat de makeMeasure
 */
export async function buildPdf({ entry, fonts, images, annex, PDFLib, fontkit, measure, title }) {
  measure = measure || makeMeasure(fontkit, fonts);
  const { items, warnings } = layoutPage(entry, measure);

  const doc = await PDFLib.PDFDocument.create();
  doc.registerFontkit(fontkit);
  const pdfFonts = {};
  for (const k of FONT_KEYS) {
    pdfFonts[k] = await doc.embedFont(fonts[k], { subset: !isCff(fonts[k]) });
  }
  const embedded = {};
  for (const [key, bytes] of Object.entries(images || {})) {
    if (!bytes) continue;
    const t = imageType(bytes);
    if (t === 'png') embedded[key] = await doc.embedPng(bytes);
    else if (t === 'jpg') embedded[key] = await doc.embedJpg(bytes);
  }

  const page = doc.addPage([PAGE.width, PAGE.height]);
  const H = PAGE.height;
  const {
    pushGraphicsState, popGraphicsState, moveTo, lineTo, appendBezierCurve,
    closePath, clip, endPath,
  } = PDFLib;

  const clipOps = (c) => {
    if (c.type === 'rect') {
      return [moveTo(c.x, H - c.y), lineTo(c.x + c.w, H - c.y), lineTo(c.x + c.w, H - c.y - c.h), lineTo(c.x, H - c.y - c.h), closePath(), clip(), endPath()];
    }
    const cx = c.cx;
    const cy = H - c.cy;
    const r = c.r;
    const k = r * K;
    return [
      moveTo(cx + r, cy),
      appendBezierCurve(cx + r, cy + k, cx + k, cy + r, cx, cy + r),
      appendBezierCurve(cx - k, cy + r, cx - r, cy + k, cx - r, cy),
      appendBezierCurve(cx - r, cy - k, cx - k, cy - r, cx, cy - r),
      appendBezierCurve(cx + k, cy - r, cx + r, cy - k, cx + r, cy),
      closePath(), clip(), endPath(),
    ];
  };

  for (const it of items) {
    switch (it.type) {
      case 'rect':
        page.drawRectangle({ x: it.x, y: H - it.y - it.h, width: it.w, height: it.h, color: pdfColor(PDFLib, it.fill), borderWidth: 0 });
        break;
      case 'line':
        page.drawLine({ start: { x: it.x1, y: H - it.y1 }, end: { x: it.x2, y: H - it.y2 }, thickness: it.width, color: pdfColor(PDFLib, it.color) });
        break;
      case 'circle':
        if (it.fill) page.drawCircle({ x: it.cx, y: H - it.cy, size: it.r, color: pdfColor(PDFLib, it.fill), borderWidth: 0 });
        if (it.stroke) page.drawCircle({ x: it.cx, y: H - it.cy, size: it.r, borderColor: pdfColor(PDFLib, it.stroke), borderWidth: it.strokeWidth });
        break;
      case 'polygon': {
        const d = it.points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(3)} ${y.toFixed(3)}`).join(' ') + ' Z';
        page.drawSvgPath(d, { x: 0, y: H, color: pdfColor(PDFLib, it.fill), borderWidth: 0 });
        break;
      }
      case 'image': {
        const img = embedded[it.key];
        if (!img) break;
        const b = fitBox(it, img.width, img.height, it.fit);
        page.pushOperators(pushGraphicsState(), ...clipOps(it.clip));
        page.drawImage(img, { x: b.x, y: H - b.y - b.h, width: b.w, height: b.h });
        page.pushOperators(popGraphicsState());
        break;
      }
      case 'text':
        if (!it.text) break;
        page.drawText(it.text, { x: it.x, y: H - it.y, size: it.size, font: pdfFonts[it.font], color: pdfColor(PDFLib, it.color) });
        break;
      default:
        break;
    }
  }

  let annexPages = 0;
  if (annex && annex.length) {
    const src = await PDFLib.PDFDocument.load(annex, { ignoreEncryption: true });
    const copied = await doc.copyPages(src, src.getPageIndices());
    for (const p of copied) doc.addPage(p);
    annexPages = copied.length;
  }

  if (title) doc.setTitle(title);
  doc.setCreator('Fiches PDF');
  doc.setProducer('Fiches PDF (pdf-lib)');
  doc.setCreationDate(new Date());
  doc.setModificationDate(new Date());

  const bytes = await doc.save();
  return { bytes, warnings, annexPages };
}

/**
 * Aperçu sur un <canvas>. `images` : { clé: ImageBitmap | HTMLImageElement }.
 * `families` : { regular, semibold, bold } noms des FontFace chargées.
 */
export function drawPreview(canvas, entry, { measure, images, families, scale }) {
  const { items, warnings } = layoutPage(entry, measure);
  const ctx = canvas.getContext('2d');
  canvas.width = Math.round(PAGE.width * scale);
  canvas.height = Math.round(PAGE.height * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, PAGE.width, PAGE.height);
  if ('fontKerning' in ctx) ctx.fontKerning = 'none';
  ctx.textBaseline = 'alphabetic';

  const circlePath = (cx, cy, r) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); };

  for (const it of items) {
    switch (it.type) {
      case 'rect':
        ctx.fillStyle = it.fill.css;
        ctx.fillRect(it.x, it.y, it.w, it.h);
        break;
      case 'line':
        ctx.strokeStyle = it.color.css;
        ctx.lineWidth = it.width;
        ctx.beginPath(); ctx.moveTo(it.x1, it.y1); ctx.lineTo(it.x2, it.y2); ctx.stroke();
        break;
      case 'circle':
        circlePath(it.cx, it.cy, it.r);
        if (it.fill) { ctx.fillStyle = it.fill.css; ctx.fill(); }
        if (it.stroke) { ctx.strokeStyle = it.stroke.css; ctx.lineWidth = it.strokeWidth; ctx.stroke(); }
        break;
      case 'polygon':
        ctx.fillStyle = it.fill.css;
        ctx.beginPath();
        it.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath(); ctx.fill();
        break;
      case 'image': {
        const img = images[it.key];
        if (!img) break;
        const iw = img.naturalWidth || img.width;
        const ih = img.naturalHeight || img.height;
        const b = fitBox(it, iw, ih, it.fit);
        ctx.save();
        if (it.clip.type === 'rect') { ctx.beginPath(); ctx.rect(it.clip.x, it.clip.y, it.clip.w, it.clip.h); } else circlePath(it.clip.cx, it.clip.cy, it.clip.r);
        ctx.clip();
        ctx.drawImage(img, b.x, b.y, b.w, b.h);
        ctx.restore();
        break;
      }
      case 'text':
        ctx.fillStyle = it.color.css;
        ctx.font = `${it.size}px "${families[it.font]}"`;
        ctx.fillText(it.text, it.x, it.y);
        break;
      default:
        break;
    }
  }
  return { warnings };
}

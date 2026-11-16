// Tests du générateur de fiches PDF (docs/fiches).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/fiches');
const rd = (p) => new Uint8Array(fs.readFileSync(path.join(ROOT, p)));

// pdf-lib et fontkit sont des scripts UMD destinés au navigateur.
globalThis.self = globalThis;
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'vendor/pdf-lib.min.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'vendor/fontkit.min.js'), 'utf8'));
const { PDFLib, fontkit } = globalThis;

const { layoutPage, SAMPLE, HEADINGS, fileNameFor, splitLines, wrapRuns } = await import(path.join(ROOT, 'js/layout.js'));
const { buildPdf, makeMeasure, imageType, fitBox } = await import(path.join(ROOT, 'js/render.js'));
const { parseBackup, normalizeEntry, BACKUP_APP } = await import(path.join(ROOT, 'js/db.js'));

const fonts = {
  regular: rd('fonts/secours/Mulish-Medium.ttf'),
  semibold: rd('fonts/secours/Mulish-Bold.ttf'),
  bold: rd('fonts/secours/Mulish-ExtraBold.ttf'),
};
const measure = makeMeasure(fontkit, fonts);
const images = {
  logo: rd('logos/logo-1.jpg'),
  'picto-implication': rd('pictos/implication.png'),
  'picto-materiel': rd('pictos/materiel.png'),
  'picto-temps': rd('pictos/temps.png'),
};

const texts = (items) => items.filter((i) => i.type === 'text');

test('les intertitres invariables sont toujours présents', () => {
  const { items } = layoutPage({}, measure);
  const t = texts(items).map((i) => i.text);
  for (const h of Object.values(HEADINGS)) assert.ok(t.includes(h), h);
});

test('le document d’exemple tient dans ses cadres (aucune alerte)', () => {
  const { warnings } = layoutPage(SAMPLE, measure);
  assert.deepEqual(warnings, []);
});

test('positions reprises du document InDesign', () => {
  const { items } = layoutPage(SAMPLE, measure);
  const find = (s) => texts(items).find((i) => i.text.startsWith(s));
  // Lignes de base relevées dans le PDF d'origine (origine en haut à gauche).
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.1, `${a} ≠ ${b}`);
  near(find('Cartographie').y, 75.82);
  near(find('de son').y, 109.81);
  near(find('But').y, 136.68);
  near(find('Rendre').y, 151.52);
  near(find(HEADINGS.quand).y, 242.13);
  near(find('L’équipe').y, 260.93);
  near(find('Les compétences').y, 276.90);
  near(find('Individuel').y, 487.15);
  near(find('puis').y, 501.98);
  near(find('Données').y, 513.98);
  near(find('45-90').y, 488.28);
  near(find('30-60').y, 504.25);
  near(find('Etapes').y, 548.27);
  near(find('1').y, 567.07);
  near(find('Ne pas').y, 680.46);
  assert.equal(find('L’équipe').x.toFixed(2), '66.61');
  assert.equal(find('45-90').font, 'semibold');
});

test('une ligne = une puce, numérotation automatique des étapes', () => {
  const { items } = layoutPage({ quand: 'un\n\n  deux  \ntrois', etapes: '1. premier\nsecond' }, measure);
  assert.equal(items.filter((i) => i.type === 'polygon').length, 3);
  const t = texts(items).map((i) => i.text);
  assert.ok(t.includes('2'));
  assert.ok(t.some((s) => s.startsWith('. premier')), 'le « 1. » saisi n’est pas doublé');
});

test('texte trop long : alerte sur la rubrique concernée', () => {
  const { warnings } = layoutPage({ ...SAMPLE, quand: 'a\nb\nc\nd\ne\nf' }, measure);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].key, 'quand');
});

test('retour à la ligne automatique', () => {
  const runs = [{ text: 'Support visuel papier ou numérique très long pour une colonne étroite', font: 'regular', size: 10 }];
  const lines = wrapRuns(runs, 143, 143, measure);
  assert.ok(lines.length >= 2);
  for (const l of lines) assert.ok(l.reduce((s, r) => s + measure(r.text, r.font, r.size), 0) <= 143.01);
  assert.deepEqual(splitLines(' a \n\n b'), ['a', 'b']);
});

test('PDF généré : 1 page A4, puis les pages du PDF annexe', async () => {
  const { bytes } = await buildPdf({ entry: SAMPLE, fonts, images, PDFLib, fontkit, measure });
  assert.equal(String.fromCharCode(...bytes.slice(0, 5)), '%PDF-');
  const doc = await PDFLib.PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);
  const { width, height } = doc.getPage(0).getSize();
  assert.ok(Math.abs(width - 595.28) < 0.01 && Math.abs(height - 841.89) < 0.01);

  // annexe de 2 pages
  const annexDoc = await PDFLib.PDFDocument.create();
  annexDoc.addPage([300, 300]);
  annexDoc.addPage([400, 400]);
  const annex = await annexDoc.save();
  const photo = images['picto-temps'];
  const r = await buildPdf({ entry: { ...SAMPLE, logo: 2 }, fonts, images: { ...images, photo }, annex, PDFLib, fontkit, measure });
  assert.equal(r.annexPages, 2);
  const merged = await PDFLib.PDFDocument.load(r.bytes);
  assert.equal(merged.getPageCount(), 3);
  assert.equal(merged.getPage(2).getSize().width, 400);
});

test('images : type et ajustement', () => {
  assert.equal(imageType(images.logo), 'jpg');
  assert.equal(imageType(images['picto-temps']), 'png');
  const cover = fitBox({ x: 0, y: 0, w: 100, h: 100 }, 200, 100, 'cover');
  assert.deepEqual([cover.w, cover.h, cover.x], [200, 100, -50]);
  const contain = fitBox({ x: 0, y: 0, w: 100, h: 100 }, 200, 100, 'contain');
  assert.deepEqual([contain.w, contain.h, contain.y], [100, 50, 25]);
});

test('nom de fichier', () => {
  assert.equal(fileNameFor(SAMPLE), 'Cartographie-de-son-equipe.pdf');
  assert.equal(fileNameFor({ ...SAMPLE, fichier: 'Fiche n°1 l’été.pdf' }), 'Fiche-n-1-l-ete.pdf');
  assert.equal(fileNameFor({}, 'fiche-3'), 'fiche-3.pdf');
});

test('sauvegarde : lecture et contrôle', () => {
  const backup = JSON.stringify({
    app: BACKUP_APP, version: 1,
    entries: [{ id: 'fiche_a', titre: 'T', logo: '2', photo: { id: 'img_1', name: 'p.jpg', size: 3 }, extra: 1 }],
    files: { img_1: { name: 'p.jpg', type: 'image/jpeg', data: Buffer.from([1, 2, 3]).toString('base64') } },
  });
  const { entries, files } = parseBackup(backup);
  assert.equal(entries[0].logo, 2);
  assert.equal(entries[0].quand, '');
  assert.deepEqual([...files.img_1.bytes], [1, 2, 3]);
  assert.throws(() => parseBackup('{"app":"autre","entries":[]}'));
  assert.throws(() => parseBackup('pas du json'));
  assert.equal(normalizeEntry(null).logo, 1);
});

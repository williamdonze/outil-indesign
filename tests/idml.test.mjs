import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildFixture, buildZip, fixtureFiles, MIMETYPE } from './fixtures/build-fixture.mjs';
import { openIdml, IdmlError, extractStory, structureSignature, parseSpread } from '../docs/js/idml.js';
import { exportIdml, rewriteStoryXml, storyEdits, exportFileName } from '../docs/js/writer.js';
import { readZip, entryData, physicalOrder } from '../docs/js/zip.js';
import { parseXml, XmlError } from '../docs/js/xml.js';
import {
  paragraphText, delta, formatPct, serializeEdits, importEdits, fromDisplay, toDisplay, fingerprint, storyStats,
} from '../docs/js/state.js';
import { reportText, reportHtml } from '../docs/js/report.js';

const dec = new TextDecoder('utf-8', { ignoreBOM: true });
const open = (opts) => openIdml(new Uint8Array(buildFixture(opts)), 'atelier.idml');

const story = (doc, id) => doc.storiesById.get(id);
const pieceByText = (doc, text) => [...doc.piecesById.values()].find((p) => p.original === text);

/** Lecture indépendante d'un ZIP avec zlib (pour ne pas valider zip.js avec lui-même). */
function independentRead(buf) {
  const b = Buffer.from(buf);
  let eocd = b.length - 22;
  while (b.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    const method = b.readUInt16LE(p + 10);
    const csize = b.readUInt32LE(p + 20);
    const nlen = b.readUInt16LE(p + 28);
    const xlen = b.readUInt16LE(p + 30);
    const clen = b.readUInt16LE(p + 32);
    const offset = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    const start = offset + 30 + b.readUInt16LE(offset + 26) + b.readUInt16LE(offset + 28);
    const raw = b.subarray(start, start + csize);
    out.push({ name, method, offset, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
  }
  return out.sort((x, y) => x.offset - y.offset);
}

describe('lecture', () => {
  test('pages, dimensions et gabarit', async () => {
    const doc = await open();
    assert.deepEqual(doc.pages.map((p) => p.label), ['Page 1', 'Page 2', 'Page 3', 'Gabarit A-Parent']);
    for (const p of doc.pages) {
      assert.ok(Math.abs(p.width - 595.2756) < 0.01);
      assert.ok(Math.abs(p.height - 841.8898) < 0.01);
    }
    assert.ok(Math.abs(doc.defaultSize.width - 595.2756) < 0.01);
  });

  test('stories ordonnées par page puis position', async () => {
    const doc = await open();
    assert.deepEqual(doc.stories.map((s) => s.id), ['u10', 'u11', 'u16', 'u12', 'u19', 'u17', 'u14', 'u18']);
    assert.equal(story(doc, 'u11').pageId, 'pa1');
    assert.equal(story(doc, 'u16').pageId, 'pb2');
    assert.equal(story(doc, 'u14').placement, 'master');
    assert.equal(story(doc, 'u18').placement, 'pasteboard');
    assert.equal(story(doc, 'u19').anchoredIn, 'u12');
  });

  test('stories vides ignorées et signalées', async () => {
    const doc = await open();
    assert.equal(doc.storiesById.has('u13'), true);
    assert.equal(doc.stories.some((s) => s.id === 'u13'), false);
    assert.deepEqual(doc.ignored.map((i) => i.id), ['u13']);
  });

  test('paragraphes, segments et caractères spéciaux', async () => {
    const doc = await open();
    const s = story(doc, 'u11');
    assert.equal(s.paragraphs.length, 4);
    assert.equal(s.paragraphs[0].pieces[0].original, 'Le café & les croissants sont servis dès 8 h.');
    const p2 = s.paragraphs[1];
    assert.deepEqual(p2.pieces.map((p) => p.original), ['Nous vous attendons au ', '1er étage', ' de l’immeuble.']);
    assert.equal(p2.simple, false);
    assert.deepEqual(p2.pieces[1].overrides, ['Bold']);
    assert.equal(p2.pieces[1].styleKey === p2.pieces[0].styleKey, false);
    assert.equal(s.paragraphs[2].pieces[0].original, 'Horaires :\tlundi–vendredi\u2028samedi sur rendez-vous');
    assert.equal(s.paragraphs[3].pieces[0].original, 'Dernier paragraphe « avec guillemets ».');
    assert.equal(s.paragraphs[3].paraStyle, 'Corps:Dernier');
    assert.equal(s.paragraphs[3].pieces[0].charStyle, 'Accent');
  });

  test('codes spéciaux, liens, objets ancrés et tableaux', async () => {
    const doc = await open();
    const s = story(doc, 'u12');
    const p0 = s.paragraphs[0];
    assert.deepEqual(p0.items.map((i) => (i.type === 'token' ? `[${i.label}]` : i.piece.original)), ['Page ', '[n° de page]', ' — voir ', 'www.exemple.fr']);
    assert.deepEqual(p0.pieces[2].wrappers, ['lien']);
    assert.ok(s.paragraphs[1].items.some((i) => i.type === 'token' && i.label === 'bloc texte ancré'));
    const t = story(doc, 'u16');
    assert.deepEqual(t.paragraphs.map((p) => paragraphText(p, new Map())), ['A1', 'B1', 'A2', 'B2', 'Après le tableau']);
    assert.match(t.paragraphs[1].context, /ligne 1\/2, colonne 2/);
  });
});

describe('positions des blocs (plan schématique)', () => {
  test('cadres simples, chaînés, image', async () => {
    const doc = await open();
    const f = (id) => doc.frames.find((x) => x.id === id);
    const near = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} ≠ ${b}`);
    const t = f('tf10');
    assert.equal(t.pageId, 'pa1');
    near(t.x, 50); near(t.y, 40); near(t.w, 495); near(t.h, 60);
    const img = f('img1');
    assert.equal(img.kind, 'image');
    near(img.x, 147.6); near(img.y, 841.8898 / 2 - 325); near(img.w, 300); near(img.h, 150);
    // Bloc chaîné : deuxième cadre sur la page de gauche du spread 2
    const b = f('tf11b');
    assert.equal(b.pageId, 'pb2');
    near(b.x, 595.2756 - 545); near(b.y, 841.8898 / 2 - 370);
    assert.deepEqual(story(doc, 'u11').frames.map((x) => x.id), ['tf11a', 'tf11b']);
    assert.equal(b.chainIndex, 1);
  });

  test('cadre tourné dans un groupe (transformations composées)', async () => {
    const doc = await open();
    const r = doc.frames.find((x) => x.id === 'tf17');
    assert.equal(r.pageId, 'pb3');
    const near = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} ≠ ${b}`);
    near(r.x, 50); near(r.y, 100 + 841.8898 / 2); near(r.w, 50); near(r.h, 200);
  });

  test('cadre sur la table de montage', async () => {
    const doc = await open();
    const r = doc.frames.find((x) => x.id === 'tf18');
    assert.equal(r.pageId, null);
  });

  test('parseSpread seul', () => {
    const xml = `<?xml version="1.0"?><idPkg:Spread xmlns:idPkg="x"><Spread Self="s"><Page Self="p" Name="7" GeometricBounds="0 0 200 100" ItemTransform="1 0 0 1 -100 -100"/><TextFrame Self="t" ParentStory="u1" ItemTransform="2 0 0 2 -90 -90"><Properties><PathGeometry><GeometryPathType><PathPointArray><PathPointType Anchor="0 0"/><PathPointType Anchor="0 10"/><PathPointType Anchor="20 10"/><PathPointType Anchor="20 0"/></PathPointArray></GeometryPathType></PathGeometry></Properties></TextFrame></Spread></idPkg:Spread>`;
    const { pages, items } = parseSpread(xml);
    assert.equal(pages[0].name, '7');
    assert.deepEqual([items[0].x, items[0].y, items[0].w, items[0].h], [10, 10, 40, 20]);
  });
});

describe('aller-retour sans modification', () => {
  for (const opts of [{}, { dataDescriptor: false, extra: false }]) {
    test(`fichier équivalent (${JSON.stringify(opts)})`, async () => {
      const input = buildFixture(opts);
      const doc = await openIdml(new Uint8Array(input), 'atelier.idml');
      const { bytes, changedFiles, check } = await exportIdml(doc, new Map());
      assert.deepEqual(changedFiles, []);
      assert.equal(check.modified, 0);
      assert.equal(check.identical, fixtureFiles().length - 1);
      const a = independentRead(input);
      const b = independentRead(bytes);
      assert.deepEqual(b.map((e) => e.name), a.map((e) => e.name));
      for (let i = 0; i < a.length; i++) assert.ok(a[i].data.equals(b[i].data), a[i].name);
      // Les données compressées elles-mêmes sont recopiées sans recompression.
      const za = readZip(new Uint8Array(input));
      const zb = readZip(bytes);
      for (const e of zb.entries) {
        const o = za.entries.find((x) => x.name === e.name);
        assert.ok(Buffer.from(o.raw).equals(Buffer.from(e.raw)), e.name);
        assert.equal(e.crc32, o.crc32);
      }
    });
  }

  test('modification identique à l’original = pas de changement', async () => {
    const doc = await open();
    const pc = pieceByText(doc, '1er étage');
    const { changedFiles } = await exportIdml(doc, new Map([[pc.id, '1er étage']]));
    assert.deepEqual(changedFiles, []);
  });
});

describe('modification et réécriture', () => {
  test('modifie un segment, échappe le XML, conserve les styles', async () => {
    const doc = await open();
    const pc = pieceByText(doc, '1er étage');
    const edits = new Map([[pc.id, '2e étage & demi <b> "x"']]);
    const { bytes, changedFiles, check } = await exportIdml(doc, edits);
    assert.deepEqual(changedFiles, ['Stories/Story_u11.xml']);
    assert.equal(check.modified, 1);

    const files = independentRead(bytes);
    const xml = files.find((f) => f.name === 'Stories/Story_u11.xml').data.toString('utf8');
    assert.ok(xml.includes('<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]" FontStyle="Bold">\n\t\t\t\t<Content>2e étage &amp; demi &lt;b&gt; "x"</Content>'));
    // Tout le reste du XML est inchangé, caractère pour caractère.
    const orig = story(doc, 'u11').xml;
    assert.equal(xml, orig.replace('<Content>1er étage</Content>', '<Content>2e étage &amp; demi &lt;b&gt; "x"</Content>'));
    assert.deepEqual(structureSignature(xml), structureSignature(orig));

    // Les autres fichiers sont identiques octet pour octet.
    const before = independentRead(buildFixture());
    for (const f of files) {
      if (f.name === 'Stories/Story_u11.xml') continue;
      assert.ok(f.data.equals(before.find((x) => x.name === f.name).data), f.name);
    }

    // Relecture du fichier exporté
    const doc2 = await openIdml(bytes, 'x.idml');
    assert.equal(paragraphText(story(doc2, 'u11').paragraphs[1], new Map()), 'Nous vous attendons au 2e étage & demi <b> "x" de l’immeuble.');
  });

  test('caractères spéciaux : insécables, apostrophes, tabulations, saut forcé', async () => {
    const doc = await open();
    const pc = pieceByText(doc, 'Horaires :\tlundi–vendredi\u2028samedi sur rendez-vous');
    const text = 'Horaires :\tdu lundi au vendredi\u2028l’après-midi seulement\u0007';
    const { bytes } = await exportIdml(doc, new Map([[pc.id, text]]));
    const xml = independentRead(bytes).find((f) => f.name === 'Stories/Story_u11.xml').data.toString('utf8');
    assert.ok(xml.includes('<Content>Horaires :\tdu lundi au vendredi&#x2028;l’après-midi seulement</Content>'));
    const doc2 = await openIdml(bytes, 'x.idml');
    // le caractère de contrôle U+0007 (interdit en XML) est retiré
    assert.equal(story(doc2, 'u11').paragraphs[2].pieces[0].original, text.replace('\u0007', ''));
  });

  test('retour à la ligne = nouveau paragraphe (<Br/>) avec les mêmes styles', async () => {
    const doc = await open();
    const pc = pieceByText(doc, 'Dernier paragraphe « avec guillemets ».');
    const { bytes } = await exportIdml(doc, new Map([[pc.id, 'Avant-dernier.\nDernier.']]));
    const xml = independentRead(bytes).find((f) => f.name === 'Stories/Story_u11.xml').data.toString('utf8');
    assert.ok(xml.includes('<Content>Avant-dernier.</Content><Br/><Content>Dernier.</Content>'));
    const doc2 = await openIdml(bytes, 'x.idml');
    const ps = story(doc2, 'u11').paragraphs;
    assert.equal(ps.length, 5);
    assert.deepEqual(ps.slice(3).map((p) => [p.pieces[0].original, p.paraStyle, p.pieces[0].charStyle]), [
      ['Avant-dernier.', 'Corps:Dernier', 'Accent'],
      ['Dernier.', 'Corps:Dernier', 'Accent'],
    ]);
  });

  test('plusieurs stories et cellules de tableau modifiées', async () => {
    const doc = await open();
    const edits = new Map([
      [pieceByText(doc, 'B2').id, 'B2 modifié'],
      [pieceByText(doc, 'Bienvenue à l’atelier').id, 'Bienvenue !'],
      [pieceByText(doc, 'Atelier — pied de page').id, 'Pied modifié'],
      [pieceByText(doc, 'Page ').id, 'Folio '],
    ]);
    const { bytes, changedFiles } = await exportIdml(doc, edits);
    assert.deepEqual(changedFiles.sort(), ['Stories/Story_u10.xml', 'Stories/Story_u12.xml', 'Stories/Story_u14.xml', 'Stories/Story_u16.xml']);
    const xml12 = independentRead(bytes).find((f) => f.name === 'Stories/Story_u12.xml').data.toString('utf8');
    assert.ok(xml12.includes('<Content>Folio <?ACE 18?> — voir </Content>'), 'le code de numéro de page est conservé');
    const doc2 = await openIdml(bytes, 'x.idml');
    assert.equal(paragraphText(story(doc2, 'u16').paragraphs[3], new Map()), 'B2 modifié');
  });

  test('balise Content auto-fermante', () => {
    const xml = '<?xml version="1.0"?><idPkg:Story xmlns:idPkg="x"><Story Self="z"><ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/A"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/B"><Content>ok</Content><Content/></CharacterStyleRange></ParagraphStyleRange></Story></idPkg:Story>';
    const s = extractStory(xml, 'Stories/Story_z.xml');
    const empty = s.pieces[1];
    assert.equal(empty.selfClosing, true);
    const eff = storyEdits(s, new Map([[empty.id, 'nouveau']]));
    assert.equal(rewriteStoryXml(s, eff), xml.replace('<Content/>', '<Content>nouveau</Content>'));
  });

  test('BOM UTF-8 conservé', () => {
    const xml = '﻿<?xml version="1.0"?><idPkg:Story xmlns:idPkg="x"><Story Self="z"><ParagraphStyleRange><CharacterStyleRange><Content>a</Content></CharacterStyleRange></ParagraphStyleRange></Story></idPkg:Story>';
    const s = extractStory(xml);
    const out = rewriteStoryXml(s, new Map([[s.pieces[0].id, 'b']]));
    assert.equal(out, xml.replace('>a<', '>b<'));
  });
});

describe('intégrité du ZIP', () => {
  test('mimetype en premier, non compressé, sans champ extra', async () => {
    const doc = await open();
    const { bytes } = await exportIdml(doc, new Map([[pieceByText(doc, '1er étage').id, 'X']]));
    const b = Buffer.from(bytes);
    assert.equal(b.readUInt32LE(0), 0x04034b50);
    assert.equal(b.readUInt16LE(8), 0, 'méthode 0 (stockée)');
    assert.equal(b.readUInt16LE(26), 8);
    assert.equal(b.readUInt16LE(28), 0, 'pas de champ extra');
    assert.equal(b.subarray(30, 38).toString(), 'mimetype');
    assert.equal(b.subarray(38, 38 + MIMETYPE.length).toString(), MIMETYPE);
    const z = readZip(bytes);
    assert.equal(physicalOrder(z)[0].name, 'mimetype');
    for (const e of z.entries) await entryData(e); // CRC vérifiés
  });

  test('mimetype compressé ou mal placé dans la source : corrigé à l’export', async () => {
    const files = fixtureFiles();
    const mt = files.shift();
    files.push(mt); // mimetype en dernier
    const doc = await openIdml(new Uint8Array(buildZip(files)), 'x.idml');
    const { bytes } = await exportIdml(doc, new Map());
    assert.equal(physicalOrder(readZip(bytes))[0].name, 'mimetype');
    assert.equal(physicalOrder(readZip(bytes))[0].localOffset, 0);
  });

  test('archive lisible par un outil externe (python zipfile)', async (t) => {
    const doc = await open();
    const { bytes } = await exportIdml(doc, new Map([[pieceByText(doc, '1er étage').id, 'X']]));
    const dir = mkdtempSync(join(tmpdir(), 'idml-'));
    const f = join(dir, 'out.idml');
    writeFileSync(f, bytes);
    try {
      const out = execFileSync('python3', ['-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;i=z.infolist()[0];print(i.filename,i.compress_type)', f]).toString().trim();
      assert.equal(out, 'mimetype 0');
    } catch (e) {
      if (e.code === 'ENOENT') t.skip('python3 absent'); else throw e;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('erreurs', () => {
  test('fichier .indd', async () => {
    const indd = new Uint8Array(4096);
    indd.set([0x06, 0x06, 0xed, 0xf5, 0xd8, 0x1d, 0x46, 0xe5, 0xbd, 0x31, 0xef, 0xe7, 0xfe, 0x74, 0xb7, 0x1d]);
    await assert.rejects(openIdml(indd, 'doc.indd'), (e) => e instanceof IdmlError && /\.indd/.test(e.message) && /InDesign Markup \(IDML\)/.test(e.hint));
  });
  test('fichier quelconque', async () => {
    await assert.rejects(openIdml(new TextEncoder().encode('bonjour, ceci n’est pas un idml'), 'a.idml'), IdmlError);
  });
  test('PDF', async () => {
    await assert.rejects(openIdml(new TextEncoder().encode('%PDF-1.7 ...'), 'a.pdf'), /PDF/);
  });
  test('ZIP sans mimetype IDML', async () => {
    const zip = buildZip([['mimetype', 'application/zip'], ['a.txt', 'x']]);
    await assert.rejects(openIdml(new Uint8Array(zip), 'a.idml'), /Type de fichier inattendu/);
    const zip2 = buildZip([['a.txt', 'x']]);
    await assert.rejects(openIdml(new Uint8Array(zip2), 'a.idml'), /mimetype/);
  });
  test('ZIP tronqué', async () => {
    const zip = buildFixture();
    await assert.rejects(openIdml(new Uint8Array(zip.subarray(0, zip.length / 2)), 'a.idml'), IdmlError);
  });
  test('XML mal formé', () => {
    assert.throws(() => parseXml('<a><b></a>'), XmlError);
    assert.throws(() => parseXml('<a>'), XmlError);
  });
});

describe('modèle des modifications', () => {
  test('compteur et écart en %', () => {
    assert.deepEqual(delta('abcdefghij', 'abcdefghijk'), { original: 10, current: 11, diff: 1, pct: 10, alert: false });
    assert.equal(delta('abcdefghij', 'abcdefghijkl').alert, true);
    assert.equal(formatPct(12.345), '+12,3 %');
    assert.equal(formatPct(-5), '-5 %');
    assert.equal(formatPct(Infinity), 'nouveau');
    assert.equal(delta('😀', '😀😀').current, 2, 'compte les caractères, pas les unités UTF-16');
  });

  test('affichage du saut de ligne forcé', () => {
    assert.equal(toDisplay('a\u2028b'), 'a↲b');
    assert.equal(fromDisplay('a↲b\r\nc'), 'a\u2028b\nc');
  });

  test('statistiques par bloc', async () => {
    const doc = await open();
    const s = story(doc, 'u10');
    const st = storyStats(s, new Map([[s.pieces[0].id, 'Bienvenue à l’atelier de reliure']]));
    assert.equal(st.modified, 1);
    assert.equal(st.alert, true);
  });

  test('export / import JSON', async () => {
    const doc = await open();
    const pc = pieceByText(doc, '1er étage');
    const json = JSON.parse(JSON.stringify(serializeEdits(doc, new Map([[pc.id, '2e étage'], [pieceByText(doc, 'A1').id, 'A1']]))));
    assert.deepEqual(Object.keys(json.modifications), [pc.id], 'les textes inchangés ne sont pas exportés');
    assert.equal(json.fichier.empreinte, fingerprint(doc.bytes));
    const { edits, result } = importEdits(doc, json, new Map());
    assert.equal(result.applied, 1);
    assert.equal(result.sameFile, true);
    assert.equal(edits.get(pc.id), '2e étage');
    // Conflit : l'original a changé
    json.modifications[pc.id].original = 'autre chose';
    json.modifications['inconnu:1'] = { original: 'x', texte: 'y' };
    const r2 = importEdits(doc, json, new Map());
    assert.equal(r2.result.applied, 0);
    assert.equal(r2.result.conflicts.length, 1);
    assert.equal(r2.result.unknown, 1);
    assert.throws(() => importEdits(doc, { foo: 1 }, new Map()));
  });

  test('nom du fichier exporté', () => {
    assert.equal(exportFileName('Plaquette 2026.idml', new Date(2026, 10, 3)), 'Plaquette 2026_textes_2026-11-03.idml');
  });

  test('récapitulatif txt et html', async () => {
    const doc = await open();
    const edits = new Map([[pieceByText(doc, '1er étage').id, '2e étage <tout en haut>'], [pieceByText(doc, 'B1').id, 'B1']]);
    const txt = reportText(doc, edits, { exportName: 'out.idml' });
    assert.match(txt, /PAGE 1/);
    assert.match(txt, /AVANT : Nous vous attendons au 1er étage de l’immeuble\./);
    assert.match(txt, /APRÈS : Nous vous attendons au 2e étage <tout en haut> de l’immeuble\./);
    assert.match(txt, /⚠/);
    assert.doesNotMatch(txt, /PAGE 2/);
    const html = reportHtml(doc, edits);
    assert.match(html, /&lt;tout en haut&gt;/);
    assert.doesNotMatch(html, /<tout en haut>/);
  });
});

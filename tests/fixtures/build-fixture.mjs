// Génère une fixture IDML minimale (3 pages + 1 gabarit) pour les tests.
// Le ZIP est construit ici avec zlib de Node, indépendamment de docs/js/zip.js,
// avec des descripteurs de données et des champs "extra" (comme le font
// beaucoup d'outils) pour vérifier que l'application les gère.
//
// Usage : node tests/fixtures/build-fixture.mjs  -> écrit tests/fixtures/minimal.idml

import { deflateRawSync, crc32 as zcrc32 } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PKG = 'xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="18.0"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const story = (id, body) => `${HEAD}<idPkg:Story ${PKG}>
	<Story Self="${id}" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n">
		<StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="12" FrameType="TextFrameType" StoryOrientation="Horizontal" StoryDirection="LeftToRightDirection" />
		<InCopyExportOption IncludeGraphicProxies="true" IncludeAllResources="false" />
${body}
	</Story>
</idPkg:Story>
`;

const NOSTYLE = 'CharacterStyle/$ID/[No character style]';

const pathGeom = (pts) => `<Properties>
				<PathGeometry>
					<GeometryPathType PathOpen="false">
						<PathPointArray>
${pts.map(([x, y]) => `							<PathPointType Anchor="${x} ${y}" LeftDirection="${x} ${y}" RightDirection="${x} ${y}" />`).join('\n')}
						</PathPointArray>
					</GeometryPathType>
				</PathGeometry>
			</Properties>`;

const rect = (x1, y1, x2, y2) => [[x1, y1], [x1, y2], [x2, y2], [x2, y1]];

const textFrame = (self, storyId, pts, { transform = '1 0 0 1 0 0', prev = 'n', next = 'n' } = {}) => `		<TextFrame Self="${self}" ParentStory="${storyId}" PreviousTextFrame="${prev}" NextTextFrame="${next}" ContentType="TextType" ItemTransform="${transform}">
			${pathGeom(pts)}
			<TextFramePreference TextColumnCount="1" />
		</TextFrame>`;

export const STORIES = {
  // Titre, page 1
  u10: story('u10', `		<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Titre">
			<CharacterStyleRange AppliedCharacterStyle="${NOSTYLE}">
				<Content>Bienvenue à l’atelier</Content>
			</CharacterStyleRange>
		</ParagraphStyleRange>`),
  // Texte courant, chaîné page 1 -> page 2 ; mot en gras, tabulation, saut de ligne forcé, espace insécable
  u11: story('u11', `		<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Corps">
			<CharacterStyleRange AppliedCharacterStyle="${NOSTYLE}">
				<Content>Le café &amp; les croissants sont servis dès 8 h.</Content>
				<Br />
				<Content>Nous vous attendons au </Content>
			</CharacterStyleRange>
			<CharacterStyleRange AppliedCharacterStyle="${NOSTYLE}" FontStyle="Bold">
				<Content>1er étage</Content>
			</CharacterStyleRange>
			<CharacterStyleRange AppliedCharacterStyle="${NOSTYLE}">
				<Content> de l’immeuble.</Content>
				<Br />
				<Content>Horaires :\tlundi–vendredi&#x2028;samedi sur rendez-vous</Content>
				<Br />
			</CharacterStyleRange>
		</ParagraphStyleRange>
		<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Corps%3aDernier">
			<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/Accent">
				<Content>Dernier paragraphe «\u00a0avec guillemets\u00a0».</Content>
			</CharacterStyleRange>
		</ParagraphStyleRange>`),
  // Page 3 : numéro de page automatique, lien, objet ancré
  u12: story('u12', `		<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Corps">
			<CharacterStyleRange AppliedCharacterStyle="${NOSTYLE}">
				<Content>Page <?ACE 18?> — voir </Content>
				<HyperlinkTextSource Self="ht1" Name="lien" Hidden="false">
					<Content>www.exemple.fr</Content>
				</HyperlinkTextSource>
				<Br />
				<Content>Encadré : </Content>
				<TextFrame Self="uanc" ParentStory="u19" PreviousTextFrame="n" NextTextFrame="n" ContentType="TextType" ItemTransform="1 0 0 1 0 0">
					${pathGeom(rect(0, 0, 100, 40))}
					<AnchoredObjectSetting AnchoredPosition="InlinePosition" />
				</TextFrame>
			</CharacterStyleRange>
		</ParagraphStyleRange>`),
  // Story vide (bloc vide page 3)
  u13: story('u13', `		<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
			<CharacterStyleRange AppliedCharacterStyle="${NOSTYLE}" />
		</ParagraphStyleRange>`),
  // Pied de page du gabarit
  u14: story('u14', `		<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Pied">
			<CharacterStyleRange AppliedCharacterStyle="${NOSTYLE}">
				<Content>Atelier — pied de page</Content>
			</CharacterStyleRange>
		</ParagraphStyleRange>`),
  // Tableau page 2
  u16: story('u16', `		<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Corps">
			<CharacterStyleRange AppliedCharacterStyle="${NOSTYLE}">
				<Table Self="tbl1" HeaderRowCount="0" FooterRowCount="0" BodyRowCount="2" ColumnCount="2">
					<Row Self="tbl1Row0" Name="0" />
					<Row Self="tbl1Row1" Name="1" />
					<Column Self="tbl1Column0" Name="0" />
					<Column Self="tbl1Column1" Name="1" />
${['0:0', '1:0', '0:1', '1:1'].map((n) => {
  const [c, r] = n.split(':');
  return `					<Cell Self="tbl1i${c}i${r}" Name="${n}" RowSpan="1" ColumnSpan="1">
						<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Cellule">
							<CharacterStyleRange AppliedCharacterStyle="${NOSTYLE}">
								<Content>${String.fromCharCode(65 + Number(c))}${Number(r) + 1}</Content>
							</CharacterStyleRange>
						</ParagraphStyleRange>
					</Cell>`;
}).join('\n')}
				</Table>
				<Br />
				<Content>Après le tableau</Content>
			</CharacterStyleRange>
		</ParagraphStyleRange>`),
  // Bloc tourné à 90° dans un groupe, page 3
  u17: story('u17', `		<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Corps">
			<CharacterStyleRange AppliedCharacterStyle="${NOSTYLE}">
				<Content>Texte vertical</Content>
			</CharacterStyleRange>
		</ParagraphStyleRange>`),
  // Bloc sur la table de montage
  u18: story('u18', `		<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Corps">
			<CharacterStyleRange AppliedCharacterStyle="${NOSTYLE}">
				<Content>Note hors page</Content>
			</CharacterStyleRange>
		</ParagraphStyleRange>`),
  // Story ancrée dans u12
  u19: story('u19', `		<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Corps">
			<CharacterStyleRange AppliedCharacterStyle="${NOSTYLE}">
				<Content>Texte ancré</Content>
			</CharacterStyleRange>
		</ParagraphStyleRange>`),
};

const PAGE_H = 841.8898;
const PAGE_W = 595.2756;
const HALF = PAGE_H / 2;

const page = (self, name, tx) => `		<Page Self="${self}" Name="${name}" AppliedMaster="um" GeometricBounds="0 0 ${PAGE_H} ${PAGE_W}" ItemTransform="1 0 0 1 ${tx} ${-HALF}" />`;

export const SPREADS = {
  'Spreads/Spread_ua.xml': `${HEAD}<idPkg:Spread ${PKG}>
	<Spread Self="ua" PageCount="1" BindingLocation="0" ItemTransform="1 0 0 1 0 0">
${page('pa1', '1', 0)}
${textFrame('tf10', 'u10', rect(0, 0, 495, 60), { transform: `1 0 0 1 50 ${-HALF + 40}` })}
		<Rectangle Self="img1" ContentType="GraphicType" ItemTransform="1 0 0 1 297.6 -250">
			${pathGeom(rect(-150, -75, 150, 75))}
			<Image Self="img1i" ItemTransform="1 0 0 1 -150 -75">
				<Link Self="lnk1" LinkResourceURI="file:/photo.jpg" />
			</Image>
		</Rectangle>
${textFrame('tf11a', 'u11', rect(50, -200, 545, 300), { next: 'tf11b' })}
	</Spread>
</idPkg:Spread>
`,
  'Spreads/Spread_ub.xml': `${HEAD}<idPkg:Spread ${PKG}>
	<Spread Self="ub" PageCount="2" BindingLocation="1" ItemTransform="1 0 0 1 0 1000">
${page('pb2', '2', -PAGE_W)}
${page('pb3', '3', 0)}
${textFrame('tf11b', 'u11', rect(-545, -370, -50, 0), { prev: 'tf11a' })}
${textFrame('tf16', 'u16', rect(-545, 50, -50, 300))}
${textFrame('tf12', 'u12', rect(50, -370, 545, -200))}
${textFrame('tf13', 'u13', rect(50, -150, 545, -60))}
		<Group Self="grp1" ItemTransform="1 0 0 1 100 100">
${textFrame('tf17', 'u17', rect(0, 0, 200, 50), { transform: '0 1 -1 0 0 0' })}
		</Group>
${textFrame('tf18', 'u18', rect(700, 0, 900, 100))}
	</Spread>
</idPkg:Spread>
`,
};

export const MASTER = {
  'MasterSpreads/MasterSpread_um.xml': `${HEAD}<idPkg:MasterSpread ${PKG}>
	<MasterSpread Self="um" Name="A-Parent" NamePrefix="A" BaseName="Parent" PageCount="1" ItemTransform="1 0 0 1 0 0">
${page('pm1', 'A', 0)}
${textFrame('tf14', 'u14', rect(50, 380, 545, 410))}
	</MasterSpread>
</idPkg:MasterSpread>
`,
};

const storyIds = Object.keys(STORIES);
export const DESIGNMAP = `${HEAD}<?aid style="50" type="document" readerVersion="6.0" featureSet="257" product="18.0(53)" ?>
<Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="18.0" Self="d" StoryList="${storyIds.join(' ')}" Name="atelier.indd">
	<idPkg:Graphic src="Resources/Graphic.xml" />
	<idPkg:Fonts src="Resources/Fonts.xml" />
	<idPkg:Styles src="Resources/Styles.xml" />
	<idPkg:Preferences src="Resources/Preferences.xml" />
	<idPkg:MasterSpread src="MasterSpreads/MasterSpread_um.xml" />
	<idPkg:Spread src="Spreads/Spread_ua.xml" />
	<idPkg:Spread src="Spreads/Spread_ub.xml" />
	<idPkg:BackingStory src="XML/BackingStory.xml" />
${storyIds.map((id) => `	<idPkg:Story src="Stories/Story_${id}.xml" />`).join('\n')}
</Document>
`;

const RESOURCES = {
  'META-INF/container.xml': `${HEAD}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n\t<rootfiles>\n\t\t<rootfile full-path="designmap.xml" media-type="text/xml" />\n\t</rootfiles>\n</container>\n`,
  'Resources/Graphic.xml': `${HEAD}<idPkg:Graphic ${PKG}>\n\t<Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" Name="Black" />\n</idPkg:Graphic>\n`,
  'Resources/Fonts.xml': `${HEAD}<idPkg:Fonts ${PKG}>\n\t<FontFamily Self="di1" Name="Minion Pro" />\n</idPkg:Fonts>\n`,
  'Resources/Styles.xml': `${HEAD}<idPkg:Styles ${PKG}>\n\t<RootParagraphStyleGroup Self="u7">\n\t\t<ParagraphStyle Self="ParagraphStyle/Titre" Name="Titre" PointSize="24" />\n\t\t<ParagraphStyle Self="ParagraphStyle/Corps" Name="Corps" PointSize="10" />\n\t</RootParagraphStyleGroup>\n\t<RootCharacterStyleGroup Self="u8">\n\t\t<CharacterStyle Self="CharacterStyle/Accent" Name="Accent" FontStyle="Italic" />\n\t</RootCharacterStyleGroup>\n</idPkg:Styles>\n`,
  'Resources/Preferences.xml': `${HEAD}<idPkg:Preferences ${PKG}>\n\t<DocumentPreference PageHeight="${PAGE_H}" PageWidth="${PAGE_W}" PagesPerDocument="3" FacingPages="true" />\n</idPkg:Preferences>\n`,
  'XML/BackingStory.xml': `${HEAD}<idPkg:BackingStory ${PKG}>\n\t<XmlStory Self="ubs" />\n</idPkg:BackingStory>\n`,
};

export const MIMETYPE = 'application/vnd.adobe.indesign-idml-package';

/** Liste ordonnée [nom, contenu] de la fixture. */
export function fixtureFiles() {
  return [
    ['mimetype', MIMETYPE],
    ['designmap.xml', DESIGNMAP],
    ...Object.entries(RESOURCES),
    ...Object.entries(MASTER),
    ...Object.entries(SPREADS),
    ...storyIds.map((id) => [`Stories/Story_${id}.xml`, STORIES[id]]),
  ];
}

/**
 * Construit un ZIP. Options :
 *  - dataDescriptor : utiliser le bit 3 + descripteur après les données (sauf mimetype)
 *  - extra          : ajouter un champ "extra" aux en-têtes locaux (sauf mimetype)
 */
export function buildZip(files, { dataDescriptor = true, extra = true } = {}) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content, 'utf8');
    const isMime = name === 'mimetype';
    const method = isMime ? 0 : 8;
    const comp = method === 8 ? deflateRawSync(data, { level: 9 }) : data;
    const crc = zcrc32(data) >>> 0;
    const nameBuf = Buffer.from(name, 'utf8');
    const useDD = dataDescriptor && !isMime;
    const extraBuf = extra && !isMime ? Buffer.from([0x55, 0x54, 0x05, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]) : Buffer.alloc(0);
    const flags = useDD ? 0x08 : 0;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0x6000, 10);
    lh.writeUInt16LE(0x5b6b, 12);
    lh.writeUInt32LE(useDD ? 0 : crc, 14);
    lh.writeUInt32LE(useDD ? 0 : comp.length, 18);
    lh.writeUInt32LE(useDD ? 0 : data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(extraBuf.length, 28);
    chunks.push(lh, nameBuf, extraBuf, comp);
    let size = lh.length + nameBuf.length + extraBuf.length + comp.length;
    if (useDD) {
      const dd = Buffer.alloc(16);
      dd.writeUInt32LE(0x08074b50, 0);
      dd.writeUInt32LE(crc, 4);
      dd.writeUInt32LE(comp.length, 8);
      dd.writeUInt32LE(data.length, 12);
      chunks.push(dd);
      size += 16;
    }

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(0x031e, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0x6000, 12);
    ch.writeUInt16LE(0x5b6b, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);
    offset += size;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cd, eocd]);
}

export function buildFixture(options) {
  return buildZip(fixtureFiles(), options);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = new URL('./minimal.idml', import.meta.url);
  writeFileSync(out, buildFixture());
  console.log(`Fixture écrite : ${fileURLToPath(out)}`);
}

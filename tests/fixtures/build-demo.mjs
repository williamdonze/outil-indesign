// Génère un fichier IDML de démonstration (plaquette de 4 pages) pour essayer l'outil.
// Usage : node tests/fixtures/build-demo.mjs  -> écrit tests/fixtures/exemple-plaquette.idml

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildZip, MIMETYPE } from './build-fixture.mjs';

const W = 595.2756;
const H = 841.8898;
const HALF = H / 2;
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const PKG = 'xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="18.0"';
const NOCS = 'CharacterStyle/$ID/[No character style]';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------- stories
// Un paragraphe = liste de segments [texte, options] ; options : { bold, italic, cs: 'Accent' }
const csr = ([text, o = {}]) => {
  const attrs = [`AppliedCharacterStyle="${o.cs ? `CharacterStyle/${o.cs}` : NOCS}"`];
  if (o.bold) attrs.push('FontStyle="Bold"');
  if (o.italic) attrs.push('FontStyle="Italic"');
  return `\t\t\t<CharacterStyleRange ${attrs.join(' ')}>\n\t\t\t\t<Content>${esc(text)}</Content>\n\t\t\t</CharacterStyleRange>`;
};
const brRange = `\t\t\t<CharacterStyleRange AppliedCharacterStyle="${NOCS}">\n\t\t\t\t<Br />\n\t\t\t</CharacterStyleRange>`;

function story(id, paragraphs) {
  const body = paragraphs.map(({ style, segs }, i) => {
    const parts = segs.map(csr);
    if (i < paragraphs.length - 1) parts.push(brRange);
    return `\t\t<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/${style}">\n${parts.join('\n')}\n\t\t</ParagraphStyleRange>`;
  }).join('\n');
  return `${HEAD}<idPkg:Story ${PKG}>
	<Story Self="${id}" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n">
		<StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="12" FrameType="TextFrameType" StoryOrientation="Horizontal" StoryDirection="LeftToRightDirection" />
		<InCopyExportOption IncludeGraphicProxies="true" IncludeAllResources="false" />
${body}
	</Story>
</idPkg:Story>
`;
}

const P = (style, ...segs) => ({ style, segs: segs.map((s) => (typeof s === 'string' ? [s] : s)) });
const B = (t) => [t, { bold: true }];
const I = (t) => [t, { italic: true }];
const A = (t) => [t, { cs: 'Accent' }];

const NB = ' ';
const STORIES = {
  ucover: story('ucover', [
    P('Surtitre', 'Saison 2027'),
    P('Titre', 'Festival des Lumières'),
    P('Chapo', `Trois jours de concerts, d’ateliers et de projections au cœur de la vieille ville${NB}: venez comme vous êtes, repartez éblouis.`),
  ]),
  udates: story('udates', [
    P('Encadre', B('Du 12 au 14 mars 2027')),
    P('Encadre', `Entrée libre — réservation conseillée`),
  ]),
  uedito: story('uedito', [
    P('Intertitre', 'Le mot de la présidente'),
    P('Corps', `Depuis sa création, le festival n’a cessé de grandir. Cette année, nous accueillons `, B('plus de quarante artistes'), ` venus de toute l’Europe, et nous inaugurons un nouveau lieu${NB}: la halle aux grains, entièrement rénovée.`),
    P('Corps', `Notre ambition reste la même${NB}: rendre la culture accessible à toutes et à tous, sans jamais renoncer à l’exigence artistique. Les ateliers pour enfants sont gratuits, et la plupart des concerts le sont aussi.`),
    P('Corps', `Je remercie chaleureusement les bénévoles, sans qui rien ne serait possible, ainsi que nos partenaires publics et privés.`),
    P('Signature', I('Claire Dumont, présidente de l’association')),
    P('Intertitre', 'Un programme pour tous'),
    P('Corps', `Le vendredi soir est consacré à la musique électronique, avec une scénographie lumineuse conçue spécialement pour la façade de la cathédrale. Le samedi, place aux `, A('fanfares'), ` et aux arts de la rue, du marché couvert jusqu’aux quais.`),
    P('Corps', `Le dimanche, les familles sont à l’honneur${NB}: lanternes à fabriquer soi-même, contes à la tombée de la nuit et grande parade finale à 19${NB}h.`),
    P('Corps', `Retrouvez le détail des horaires dans le tableau ci-contre, et toutes les informations pratiques en dernière page.`),
  ]),
  ucaption1: story('ucaption1', [P('Legende', I('La parade finale, édition 2026. Photo : Marc Leroy'))]),
  uprog: story('uprog', [
    P('Intertitre', 'Programme'),
    P('Corps', `Horaires indicatifs, susceptibles d’évoluer. Consultez le site du festival la veille de votre venue.`),
  ]),
  uquote: story('uquote', [P('Citation', `«${NB}On vient pour un concert, on reste pour tout le reste.${NB}»`), P('Signature', I('— Un festivalier, 2026'))]),
  uinfos: story('uinfos', [
    P('Intertitre', 'Infos pratiques'),
    P('Corps', B('Accès : '), `tram ligne 2, arrêt Cathédrale. Parkings relais gratuits pendant toute la durée du festival.`),
    P('Corps', B('Accessibilité : '), `tous les lieux sont accessibles aux personnes à mobilité réduite. Boucles magnétiques disponibles à l’accueil.`),
    P('Corps', B('Restauration : '), `foodtrucks sur la place du marché de 11${NB}h à minuit.`),
    P('Corps', B('Contact : '), `festival@exemple.fr — 01${NB}23${NB}45${NB}67${NB}89`),
  ]),
  upartners: story('upartners', [P('Petit', `Avec le soutien de la Ville, du Département et de la Région. Merci à nos mécènes et à nos 200 bénévoles.`)]),
  ufooter: story('ufooter', [P('Pied', 'Festival des Lumières — Saison 2027')]),
};

// Tableau du programme (story à part)
const cells = [
  ['Vendredi', '20 h – minuit', 'Nuit électro'],
  ['Samedi', '14 h – 23 h', 'Fanfares et arts de la rue'],
  ['Dimanche', '10 h – 19 h', 'Ateliers en famille'],
  ['Dimanche', '19 h', 'Grande parade'],
];
const cellXml = cells.flatMap((row, r) => row.map((txt, c) => `					<Cell Self="ttabi${c}i${r}" Name="${c}:${r}" RowSpan="1" ColumnSpan="1">
						<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Cellule">
							<CharacterStyleRange AppliedCharacterStyle="${NOCS}"${c === 0 ? ' FontStyle="Bold"' : ''}>
								<Content>${esc(txt)}</Content>
							</CharacterStyleRange>
						</ParagraphStyleRange>
					</Cell>`)).join('\n');
STORIES.utable = `${HEAD}<idPkg:Story ${PKG}>
	<Story Self="utable" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n">
		<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Corps">
			<CharacterStyleRange AppliedCharacterStyle="${NOCS}">
				<Table Self="ttab" HeaderRowCount="0" FooterRowCount="0" BodyRowCount="${cells.length}" ColumnCount="3">
${cells.map((_, r) => `					<Row Self="ttabRow${r}" Name="${r}" SingleRowHeight="24" />`).join('\n')}
					<Column Self="ttabColumn0" Name="0" SingleColumnWidth="90" />
					<Column Self="ttabColumn1" Name="1" SingleColumnWidth="90" />
					<Column Self="ttabColumn2" Name="2" SingleColumnWidth="200" />
${cellXml}
				</Table>
			</CharacterStyleRange>
		</ParagraphStyleRange>
	</Story>
</idPkg:Story>
`;

// ---------------------------------------------------------------- spreads
const geom = (x1, y1, x2, y2) => `<Properties>
				<PathGeometry>
					<GeometryPathType PathOpen="false">
						<PathPointArray>
${[[x1, y1], [x1, y2], [x2, y2], [x2, y1]].map(([x, y]) => `							<PathPointType Anchor="${x} ${y}" LeftDirection="${x} ${y}" RightDirection="${x} ${y}" />`).join('\n')}
						</PathPointArray>
					</GeometryPathType>
				</PathGeometry>
			</Properties>`;

// Coordonnées données en repère PAGE (haut-gauche = 0,0) ; ox = décalage x de la page dans le spread.
const tf = (self, storyId, ox, [x, y, w, h], { prev = 'n', next = 'n', cols = 1 } = {}) => `		<TextFrame Self="${self}" ParentStory="${storyId}" PreviousTextFrame="${prev}" NextTextFrame="${next}" ContentType="TextType" ItemTransform="1 0 0 1 0 0">
			${geom(ox + x, y - HALF, ox + x + w, y + h - HALF)}
			<TextFramePreference TextColumnCount="${cols}" TextColumnGutter="12" />
		</TextFrame>`;
const img = (self, ox, [x, y, w, h]) => `		<Rectangle Self="${self}" ContentType="GraphicType" ItemTransform="1 0 0 1 0 0">
			${geom(ox + x, y - HALF, ox + x + w, y + h - HALF)}
			<Image Self="${self}i" ItemTransform="1 0 0 1 ${ox + x} ${y - HALF}">
				<Link Self="${self}l" LinkResourceURI="file:/photos/${self}.jpg" StoredState="Missing" />
			</Image>
		</Rectangle>`;
const page = (self, name, ox) => `		<Page Self="${self}" Name="${name}" AppliedMaster="umaster" GeometricBounds="0 0 ${H} ${W}" ItemTransform="1 0 0 1 ${ox} ${-HALF}" />`;
const spread = (self, count, body) => `${HEAD}<idPkg:Spread ${PKG}>
	<Spread Self="${self}" PageCount="${count}" BindingLocation="${count === 1 ? 0 : 1}" ItemTransform="1 0 0 1 0 0">
${body}
	</Spread>
</idPkg:Spread>
`;

const M = 48; // marge
const SPREADS = {
  'Spreads/Spread_us1.xml': spread('us1', 1, [
    page('pg1', '1', 0),
    img('imgcover', 0, [0, 0, W, 470]),
    tf('tfcover', 'ucover', 0, [M, 500, W - 2 * M, 220]),
    tf('tfdates', 'udates', 0, [M, 740, 260, 50]),
  ].join('\n')),
  'Spreads/Spread_us2.xml': spread('us2', 2, [
    page('pg2', '2', -W),
    page('pg3', '3', 0),
    tf('tfedito1', 'uedito', -W, [M, M, W - 2 * M, 470], { next: 'tfedito2', cols: 2 }),
    img('imgparade', -W, [M, 540, W - 2 * M, 220]),
    tf('tfcap1', 'ucaption1', -W, [M, 766, W - 2 * M, 20]),
    tf('tfedito2', 'uedito', 0, [M, M, W - 2 * M, 300], { prev: 'tfedito1', cols: 2 }),
    tf('tfprog', 'uprog', 0, [M, 370, W - 2 * M, 70]),
    tf('tftable', 'utable', 0, [M, 445, W - 2 * M, 130]),
    tf('tfquote', 'uquote', 0, [M + 40, 610, W - 2 * M - 80, 110]),
  ].join('\n')),
  'Spreads/Spread_us3.xml': spread('us3', 1, [
    page('pg4', '4', 0),
    tf('tfinfos', 'uinfos', 0, [M, M, W - 2 * M, 330]),
    img('imgplan', 0, [M, 400, W - 2 * M, 260]),
    tf('tfpart', 'upartners', 0, [M, 690, W - 2 * M, 50]),
  ].join('\n')),
};

const MASTER = `${HEAD}<idPkg:MasterSpread ${PKG}>
	<MasterSpread Self="umaster" Name="A-Parent" NamePrefix="A" BaseName="Parent" PageCount="1" ItemTransform="1 0 0 1 0 0">
${page('pgm', 'A', 0).replace(' AppliedMaster="umaster"', '')}
${tf('tffooter', 'ufooter', 0, [M, H - 36, W - 2 * M, 16])}
	</MasterSpread>
</idPkg:MasterSpread>
`;

// ---------------------------------------------------------------- ressources
const pstyles = {
  Surtitre: 'PointSize="11" Capitalization="AllCaps" Tracking="100"',
  Titre: 'PointSize="40" Leading="44" FontStyle="Bold"',
  Chapo: 'PointSize="14" Leading="19"',
  Encadre: 'PointSize="11" Leading="14"',
  Intertitre: 'PointSize="15" Leading="19" FontStyle="Bold" SpaceBefore="10" SpaceAfter="4"',
  Corps: 'PointSize="10" Leading="14" Justification="LeftJustified" SpaceAfter="4"',
  Signature: 'PointSize="10" Leading="14" Justification="RightAlign"',
  Legende: 'PointSize="8" Leading="10"',
  Citation: 'PointSize="16" Leading="21" Justification="CenterAlign"',
  Cellule: 'PointSize="9" Leading="12"',
  Petit: 'PointSize="7.5" Leading="9.5"',
  Pied: 'PointSize="7" Leading="9" Justification="CenterAlign"',
};
const STYLES = `${HEAD}<idPkg:Styles ${PKG}>
	<RootCharacterStyleGroup Self="u79">
		<CharacterStyle Self="CharacterStyle/$ID/[No character style]" Imported="false" Name="$ID/[No character style]" />
		<CharacterStyle Self="CharacterStyle/Accent" Imported="false" Name="Accent" FontStyle="Italic" FillColor="Color/Rouge" />
	</RootCharacterStyleGroup>
	<RootParagraphStyleGroup Self="u78">
		<ParagraphStyle Self="ParagraphStyle/$ID/[No paragraph style]" Name="$ID/[No paragraph style]" Imported="false" />
		<ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Name="$ID/NormalParagraphStyle" Imported="false" NextStyle="ParagraphStyle/$ID/NormalParagraphStyle" />
${Object.entries(pstyles).map(([n, a]) => `		<ParagraphStyle Self="ParagraphStyle/${n}" Name="${n}" Imported="false" ${a}>
			<Properties><BasedOn type="object">ParagraphStyle/$ID/NormalParagraphStyle</BasedOn><AppliedFont type="string">Minion Pro</AppliedFont></Properties>
		</ParagraphStyle>`).join('\n')}
	</RootParagraphStyleGroup>
	<RootCellStyleGroup Self="u8b"><CellStyle Self="CellStyle/$ID/[None]" Name="$ID/[None]" /></RootCellStyleGroup>
	<RootTableStyleGroup Self="u8d"><TableStyle Self="TableStyle/$ID/[Basic Table]" Name="$ID/[Basic Table]" /></RootTableStyleGroup>
	<RootObjectStyleGroup Self="u97">
		<ObjectStyle Self="ObjectStyle/$ID/[None]" Name="$ID/[None]" />
		<ObjectStyle Self="ObjectStyle/$ID/[Normal Graphics Frame]" Name="$ID/[Normal Graphics Frame]" />
		<ObjectStyle Self="ObjectStyle/$ID/[Normal Text Frame]" Name="$ID/[Normal Text Frame]" />
	</RootObjectStyleGroup>
</idPkg:Styles>
`;

const storyIds = Object.keys(STORIES);
const DESIGNMAP = `${HEAD}<?aid style="50" type="document" readerVersion="6.0" featureSet="257" product="18.0(53)" ?>
<Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="18.0" Self="d" StoryList="${storyIds.join(' ')}" Name="plaquette-festival.indd" ZeroPoint="0 0" ActiveLayer="ulayer" CMYKProfile="Coated FOGRA39 (ISO 12647-2:2004)" RGBProfile="sRGB IEC61966-2.1" SolidColorIntent="UseColorSettings" AfterBlendingIntent="UseColorSettings" DefaultImageIntent="UseColorSettings" RGBPolicy="PreserveEmbeddedProfiles" CMYKPolicy="CombinationOfPreserveAndSafeCmyk" AccurateLABSpots="false">
	<Language Self="Language/$ID/French" Name="$ID/French" SingleQuotes="‘’" DoubleQuotes="«»" PrimaryLanguageName="$ID/French" SublanguageName="$ID/" Id="270" HyphenationVendor="Duden" SpellingVendor="Duden" />
	<idPkg:Graphic src="Resources/Graphic.xml" />
	<idPkg:Fonts src="Resources/Fonts.xml" />
	<idPkg:Styles src="Resources/Styles.xml" />
	<NumberingList Self="NumberingList/$ID/[Default]" Name="$ID/[Default]" ContinueNumbersAcrossStories="false" ContinueNumbersAcrossDocuments="false" />
	<idPkg:Preferences src="Resources/Preferences.xml" />
	<Layer Self="ulayer" Name="Calque 1" Visible="true" Locked="false" IgnoreWrap="false" ShowGuides="true" LockGuides="false" UI="true" Expendable="true" Printable="true" />
	<idPkg:MasterSpread src="MasterSpreads/MasterSpread_umaster.xml" />
${Object.keys(SPREADS).map((f) => `	<idPkg:Spread src="${f}" />`).join('\n')}
	<idPkg:BackingStory src="XML/BackingStory.xml" />
${storyIds.map((id) => `	<idPkg:Story src="Stories/Story_${id}.xml" />`).join('\n')}
	<Section Self="usec" Length="4" Name="" PageNumberStyle="Arabic" ContinueNumbering="true" IncludeSectionPrefix="false" PageStart="pg1" SectionPrefix="" />
</Document>
`;

const GRAPHIC = `${HEAD}<idPkg:Graphic ${PKG}>
	<Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" Name="Black" ColorEditable="false" ColorRemovable="false" />
	<Color Self="Color/Paper" Model="Process" Space="CMYK" ColorValue="0 0 0 0" Name="Paper" ColorEditable="true" ColorRemovable="false" />
	<Color Self="Color/Rouge" Model="Process" Space="CMYK" ColorValue="0 90 70 0" Name="Rouge" />
	<Swatch Self="Swatch/None" Name="None" ColorEditable="false" ColorRemovable="false" />
</idPkg:Graphic>
`;

const files = [
  ['mimetype', MIMETYPE],
  ['designmap.xml', DESIGNMAP],
  ['META-INF/container.xml', `${HEAD}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n\t<rootfiles>\n\t\t<rootfile full-path="designmap.xml" media-type="text/xml" />\n\t</rootfiles>\n</container>\n`],
  ['Resources/Graphic.xml', GRAPHIC],
  ['Resources/Fonts.xml', `${HEAD}<idPkg:Fonts ${PKG}>\n\t<FontFamily Self="di1" Name="Minion Pro">\n\t\t<Font Self="di1Font1" FontFamily="Minion Pro" Name="Minion Pro Regular" PostScriptName="MinionPro-Regular" Status="Installed" FontStyleName="Regular" FontType="OpenTypeCFF" />\n\t</FontFamily>\n</idPkg:Fonts>\n`],
  ['Resources/Styles.xml', STYLES],
  ['Resources/Preferences.xml', `${HEAD}<idPkg:Preferences ${PKG}>\n\t<DocumentPreference PageHeight="${H}" PageWidth="${W}" PagesPerDocument="4" FacingPages="true" DocumentBleedTopOffset="8.5039" DocumentBleedBottomOffset="8.5039" DocumentBleedInsideOrLeftOffset="8.5039" DocumentBleedOutsideOrRightOffset="8.5039" />\n</idPkg:Preferences>\n`],
  ['XML/BackingStory.xml', `${HEAD}<idPkg:BackingStory ${PKG}>\n\t<XmlStory Self="ubs" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n" />\n</idPkg:BackingStory>\n`],
  ['MasterSpreads/MasterSpread_umaster.xml', MASTER],
  ...Object.entries(SPREADS),
  ...storyIds.map((id) => [`Stories/Story_${id}.xml`, STORIES[id]]),
];

const out = new URL('./exemple-plaquette.idml', import.meta.url);
writeFileSync(out, buildZip(files, { dataDescriptor: false, extra: false }));
console.log(`Exemple écrit : ${fileURLToPath(out)}`);

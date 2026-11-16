/**
 * Mise en page de la fiche A4, reproduite d'après le document InDesign
 * « Couv-A4_Cartographie-de-l-equipe_1 » (positions, corps, interlignages
 * et espacements relevés dans l'IDML et vérifiés sur le PDF d'origine).
 *
 * Ce module est « pur » : il ne dessine rien. Il produit une liste
 * d'éléments (rectangles, filets, cercles, images, textes) en points,
 * origine en haut à gauche, que pdf.js (PDF) et preview.js (aperçu)
 * dessinent ensuite. Il fonctionne aussi dans Node (tests).
 */

export const PAGE = { width: 595.2755905509999, height: 841.889763778 };

export const COLORS = {
  text: { cmyk: [0, 0, 0, 1], css: '#231f20' },          // C=0 M=0 J=0 N=100
  rule: { cmyk: [0, 0, 0, 1], css: '#231f20' },
  red: { rgb: [210, 15, 44], css: 'rgb(210,15,44)' },     // R=210 G=15 B=44
  placeholder: { cmyk: [0, 0, 0, 0.08], css: '#ececec' }, // Noir à 8 %
  paper: { rgb: [255, 255, 255], css: '#ffffff' },
};

/** Textes invariables (surlignés dans le PDF de référence). */
export const HEADINGS = {
  but: 'But',
  quand: 'A utiliser quand…',
  pour: 'A utiliser pour…',
  implication: 'Implication',
  materiel: 'Matériel',
  temps: 'Temps',
  etapes: 'Etapes-clé',
  attention: 'Points d’attention',
};

/** Champs variables d'une fiche, dans l'ordre du formulaire. */
export const FIELDS = [
  { key: 'titre', label: 'Titre', kind: 'lines', rows: 2, hint: 'Chaque retour à la ligne est conservé.' },
  { key: 'but', label: HEADINGS.but, kind: 'lines', rows: 2, hint: 'Les retours à la ligne sont conservés ; les lignes trop longues passent à la ligne automatiquement.' },
  { key: 'quand', label: HEADINGS.quand, kind: 'bullets', rows: 3, hint: 'Une puce par ligne.' },
  { key: 'pour', label: HEADINGS.pour, kind: 'bullets', rows: 3, hint: 'Une puce par ligne.' },
  { key: 'implication', label: HEADINGS.implication, kind: 'lines', rows: 2, hint: 'Une ligne par ligne, sans puce.' },
  { key: 'materiel', label: HEADINGS.materiel, kind: 'bullets', rows: 2, hint: 'Une puce par ligne.' },
  { key: 'temps', label: HEADINGS.temps, kind: 'bullets', rows: 2, hint: 'Une puce par ligne. Les chiffres en début de ligne (ex. « 45-90 ») sont mis en gras.' },
  { key: 'etapes', label: HEADINGS.etapes, kind: 'numbers', rows: 4, hint: 'Une étape par ligne, numérotée automatiquement.' },
  { key: 'attention', label: HEADINGS.attention, kind: 'bullets', rows: 3, hint: 'Une puce par ligne.' },
];

/** Contenu du document d'origine (sert d'exemple pour une nouvelle base). */
export const SAMPLE = {
  titre: 'Cartographie\nde son équipe',
  but: 'Rendre visibles la composition, les compétences,\nles responsabilités et/ou les liens au sein de l’équipe.',
  quand: 'L’équipe vient d’être créée ou transformée\nLes compétences et besoins sont insuffisamment connus\nLes collaborations ou responsabilités sont perçues comme floues ou déséquilibrées',
  pour: 'Faire émerger des hypothèses de travail utiles\nIdentifier les zones de fragilité ou de ressources\nPréparer certaines discussions',
  implication: 'Individuel\npuis possiblement collectif',
  materiel: 'Support visuel papier ou numérique\nDonnées utiles',
  temps: '45-90’ de préparation\n30-60’ de mise en action',
  etapes: 'Définir les informations utiles à représenter.\nChaque membre renseigne son rôle, ses compétences et ses liens.\nMettre en commun et compléter la carte.\nIdentifier les ajustements ou collaborations à développer.',
  attention: 'Ne pas réduire les personnes à leur fonction officielle.\nObtenir l’accord avant d’afficher des informations personnelles.\nMettre régulièrement la carte à jour.',
};

// ------------------------------------------------------------ géométrie
// Blocs de texte : x, y (haut), largeur, bas du cadre InDesign.
const COL = 153.07086614167184;
const FRAMES = {
  titre: { x: 53.8583, top: 51.0236, w: 317.4803, bottom: 136.0630 },
  but: { x: 56.6929, top: 126.9921, w: 317.4803, bottom: 183.6850 },
  quand: { x: 56.6929, top: 232.4409, w: 481.8898, bottom: 312.3780 },
  pour: { x: 56.6929, top: 323.1496, w: 481.8898, bottom: 403.0866 },
  implication: { x: 56.6929, top: 461.3386, w: COL, bottom: 510.9449 },
  materiel: { x: 221.1024, top: 461.3386, w: COL, bottom: 527.2441 },
  temps: { x: 385.5118, top: 461.3386, w: COL, bottom: 530.7874 },
  etapes: { x: 56.6929, top: 538.5827, w: 481.8898, bottom: 631.4173 },
  attention: { x: 56.6929, top: 651.9685, w: 481.8898, bottom: 743.3858 },
};

/** Première ligne de base = haut du cadre + 0,775 × corps (« Hampe » InDesign). */
const ASCENT = 0.775;
const DESCENT = 0.25;
const LEADING = 12;          // interlignage du texte courant (10 et 10,5 pt)
const TITLE_LEADING = 34;    // titre 32 pt
const SP = 2.834645669291339;          // 1 mm
const SP_BULLET = 3.968503937007874;   // 1,4 mm
const INDENT = 9.921259842519685;      // retrait des puces (3,5 mm)

/** Puce : petit parallélogramme incliné (polygone ancré de l'IDML). */
const BULLET = [[0, -3.9778], [4.8433, -6.2362], [6.6981, -2.2584], [1.8549, 0]];

export const IMAGE_BOX = { x: 385.5118, y: 34.0157, w: 153.0709, h: 153.0709 };

export const LOGO = {
  circle: { cx: 79.5102, cy: 198.4252, r: 20.7660, stroke: 2.050338711018839 },
  // Emplacement de l'image dans le cercle (image 400 px à 300 ppp, échelle 60,48 %).
  box: { x: 50.6297, y: 168.6695, w: 58.0656, h: 58.0656 },
};

const PICTO_R = 12.8941;
export const PICTOS = [
  { key: 'implication', cx: 70.8661, cy: 439.3701, box: { x: 53.0192, y: 421.5179, w: 35.6977, h: 35.6977 } },
  { key: 'materiel', cx: 235.2756, cy: 439.3701, box: { x: 226.7618, y: 431.7194, w: 17.0479, h: 15.2881 } },
  { key: 'temps', cx: 399.6850, cy: 439.3701, box: { x: 393.4005, y: 430.9155, w: 12.5664, h: 16.8960 } },
];

const RULES = [
  { x1: 102.3307, x2: 538.5827, y: 198.4252, w: 0.5 },
  { x1: 56.6929, x2: 538.5827, y: 439.6176, w: 0.5 },
];

// ------------------------------------------------------------ texte
/** Découpe un champ en lignes non vides, espaces superflus retirés. */
export function splitLines(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l.length > 0);
}

/**
 * Coupe une suite de segments [{text, font, size}] en lignes d'au plus
 * `width` points (première ligne) puis `nextWidth`. Coupure aux espaces
 * ordinaires uniquement (les espaces insécables ne coupent pas).
 * Un mot plus long que la ligne est coupé caractère par caractère.
 */
export function wrapRuns(runs, width, nextWidth, measure) {
  // Découpe en « mots » portant leur style, avec l'espace qui suit.
  const tokens = [];
  for (const run of runs) {
    const parts = run.text.split(/( )/);
    for (const p of parts) {
      if (p === '') continue;
      if (p === ' ') {
        if (tokens.length) tokens[tokens.length - 1].spaceAfter = { ...run, text: ' ' };
        continue;
      }
      const last = tokens[tokens.length - 1];
      // Deux segments collés (ex. « 45-90 » + « ’ de ») = même mot.
      if (last && !last.spaceAfter && last.glued) {
        last.pieces.push({ ...run, text: p });
      } else {
        tokens.push({ pieces: [{ ...run, text: p }], spaceAfter: null, glued: true });
      }
    }
    // la fin d'un segment ne termine pas forcément le mot
  }
  const w = (pieces) => pieces.reduce((s, r) => s + measure(r.text, r.font, r.size), 0);

  const lines = [];
  let cur = [];
  let curW = 0;
  let max = width;
  const flush = () => {
    // retire l'espace final
    while (cur.length && cur[cur.length - 1].text === ' ') cur.pop();
    lines.push(cur);
    cur = [];
    curW = 0;
    max = nextWidth;
  };

  for (const tok of tokens) {
    const tw = w(tok.pieces);
    if (cur.length && curW + tw > max + 0.01) flush();
    if (!cur.length && tw > max + 0.01) {
      // mot trop long : coupe par caractères
      for (const piece of tok.pieces) {
        for (const ch of Array.from(piece.text)) {
          const cw = measure(ch, piece.font, piece.size);
          if (cur.length && curW + cw > max + 0.01) flush();
          appendPiece(cur, { ...piece, text: ch });
          curW += cw;
        }
      }
    } else {
      for (const piece of tok.pieces) appendPiece(cur, piece);
      curW += tw;
    }
    if (tok.spaceAfter) {
      appendPiece(cur, tok.spaceAfter);
      curW += measure(' ', tok.spaceAfter.font, tok.spaceAfter.size);
    }
  }
  if (cur.length || !lines.length) flush();
  return lines;
}

function appendPiece(line, piece) {
  const last = line[line.length - 1];
  if (last && last.font === piece.font && last.size === piece.size) {
    last.text += piece.text;
  } else {
    line.push({ ...piece });
  }
}

/** Typographie française minimale : apostrophe droite → typographique. */
export function typo(text) {
  return String(text).replace(/'/g, '’');
}

// ------------------------------------------------------------ mise en page
/**
 * @param {object} entry  champs de la fiche (voir FIELDS) + logo
 * @param {(text:string, font:string, size:number)=>number} measure largeur en points
 * @returns {{items: object[], warnings: {key:string, label:string, message:string}[]}}
 */
export function layoutPage(entry, measure) {
  const items = [];
  const warnings = [];

  // --- image en haut à droite (ou carré gris)
  items.push({ type: 'rect', ...IMAGE_BOX, fill: COLORS.placeholder });
  items.push({ type: 'image', key: 'photo', ...IMAGE_BOX, fit: 'cover', clip: { type: 'rect', ...IMAGE_BOX }, optional: true });

  // --- filets
  for (const r of RULES) items.push({ type: 'line', x1: r.x1, y1: r.y, x2: r.x2, y2: r.y, width: r.w, color: COLORS.rule });

  // --- logo dans le cercle rouge
  const c = LOGO.circle;
  items.push({ type: 'circle', cx: c.cx, cy: c.cy, r: c.r, fill: COLORS.paper });
  items.push({ type: 'image', key: 'logo', ...LOGO.box, fit: 'contain', clip: { type: 'circle', cx: c.cx, cy: c.cy, r: c.r }, optional: true });
  items.push({ type: 'circle', cx: c.cx, cy: c.cy, r: c.r, stroke: COLORS.red, strokeWidth: c.stroke });

  // --- pictogrammes (invariables)
  for (const p of PICTOS) {
    items.push({ type: 'circle', cx: p.cx, cy: p.cy, r: PICTO_R, fill: COLORS.paper });
    items.push({ type: 'image', key: `picto-${p.key}`, ...p.box, fit: 'fill', clip: { type: 'circle', cx: p.cx, cy: p.cy, r: PICTO_R } });
    items.push({ type: 'circle', cx: p.cx, cy: p.cy, r: PICTO_R, stroke: COLORS.rule, strokeWidth: 1.27883211221265 });
  }

  // --- titre
  {
    const f = FRAMES.titre;
    let y = f.top + ASCENT * 32;
    let first = true;
    for (const para of splitLines(entry.titre)) {
      const lines = wrapRuns([{ text: typo(para), font: 'bold', size: 32 }], f.w, f.w, measure);
      for (const line of lines) {
        if (!first) y += TITLE_LEADING;
        first = false;
        pushLine(items, f.x, y, line, measure);
      }
    }
    // Le cadre du titre chevauche celui du « But » : on signale au-delà de 2 lignes.
    if (!first && y > f.top + ASCENT * 32 + TITLE_LEADING + 0.1) {
      warnings.push({ key: 'titre', label: 'Titre', message: 'Le titre dépasse 2 lignes : il chevauche la rubrique « But ».' });
    }
  }

  // --- But (texte courant 10,5 pt)
  block(items, warnings, 'but', {
    heading: HEADINGS.but, headingSize: 12.5,
    paragraphs: splitLines(entry.but).map((t) => ({ runs: [{ text: typo(t), font: 'regular', size: 10.5 }] })),
    firstGap: SP, gap: 0,
  }, measure);

  // --- A utiliser quand… (puces 10 pt)
  block(items, warnings, 'quand', {
    heading: HEADINGS.quand, headingSize: 12.5,
    paragraphs: bullets(entry.quand, 10),
    firstGap: SP + SP_BULLET, gap: SP_BULLET,
  }, measure);

  // --- A utiliser pour… (puces 10,5 pt)
  block(items, warnings, 'pour', {
    heading: HEADINGS.pour, headingSize: 12.5,
    paragraphs: bullets(entry.pour, 10.5),
    firstGap: SP + SP_BULLET, gap: SP_BULLET,
  }, measure);

  // --- Implication (lignes 10 pt, sans puce)
  block(items, warnings, 'implication', {
    heading: HEADINGS.implication, headingSize: 10.5,
    paragraphs: splitLines(entry.implication).map((t) => ({ runs: [{ text: typo(t), font: 'regular', size: 10 }] })),
    firstGap: SP + SP, gap: SP,
  }, measure);

  // --- Matériel (puces 10 pt)
  block(items, warnings, 'materiel', {
    heading: HEADINGS.materiel, headingSize: 10.5,
    paragraphs: bullets(entry.materiel, 10),
    firstGap: SP + SP, gap: SP,
  }, measure);

  // --- Temps (puces 10 pt, durée en gras)
  block(items, warnings, 'temps', {
    heading: HEADINGS.temps, headingSize: 10.5,
    paragraphs: splitLines(entry.temps).map((t) => {
      const m = typo(t).match(/^([0-9][0-9\s\-–—/à,.h]*[0-9]|[0-9])(.*)$/);
      const runs = m
        ? [{ text: m[1], font: 'semibold', size: 10 }, { text: m[2], font: 'regular', size: 10 }].filter((r) => r.text)
        : [{ text: typo(t), font: 'regular', size: 10 }];
      return { bullet: true, runs };
    }),
    firstGap: SP + SP_BULLET, gap: SP_BULLET,
  }, measure);

  // --- Etapes-clé (numérotées, 10,5 pt)
  block(items, warnings, 'etapes', {
    heading: HEADINGS.etapes, headingSize: 12.5,
    paragraphs: splitLines(entry.etapes).map((t, i) => ({
      hanging: true,
      runs: [
        { text: String(i + 1), font: 'semibold', size: 10.5 },
        { text: '. ' + typo(t).replace(/^\d+\s*[.)]\s*/, ''), font: 'regular', size: 10.5 },
      ],
    })),
    firstGap: SP + SP_BULLET, gap: SP_BULLET,
  }, measure);

  // --- Points d'attention (puces 10,5 pt)
  block(items, warnings, 'attention', {
    heading: HEADINGS.attention, headingSize: 12.5,
    paragraphs: bullets(entry.attention, 10.5),
    firstGap: SP + SP_BULLET, gap: SP_BULLET,
  }, measure);

  return { items, warnings };
}

function bullets(value, size) {
  return splitLines(value).map((t) => ({
    bullet: true,
    runs: [{ text: typo(t).replace(/^[-•–*▪◆]\s+/, ''), font: 'regular', size }],
  }));
}

function pushLine(items, x, y, runs, measure) {
  let cx = x;
  for (const r of runs) {
    items.push({ type: 'text', x: cx, y, text: r.text, font: r.font, size: r.size, color: COLORS.text });
    cx += measure(r.text, r.font, r.size);
  }
}

/**
 * Bloc standard : intertitre semi-gras (invariable) puis paragraphes.
 * firstGap : espace entre l'intertitre et le 1er paragraphe (en plus de l'interlignage)
 * gap : espace entre deux paragraphes (en plus de l'interlignage)
 */
function block(items, warnings, key, spec, measure) {
  const f = FRAMES[key];
  let y = f.top + ASCENT * spec.headingSize;
  items.push({ type: 'text', x: f.x, y, text: spec.heading, font: 'semibold', size: spec.headingSize, color: COLORS.text });

  let lastSize = spec.headingSize;
  spec.paragraphs.forEach((p, i) => {
    y += (i === 0 ? spec.firstGap : spec.gap) + LEADING;
    const indent = p.bullet || p.hanging ? INDENT : 0;
    let lines;
    if (p.hanging) {
      // 1re ligne au fer à gauche, suivantes en retrait (retrait négatif InDesign)
      lines = wrapRuns(p.runs, f.w, f.w - INDENT, measure);
    } else {
      lines = wrapRuns(p.runs, f.w - indent, f.w - indent, measure);
    }
    if (p.bullet) {
      items.push({ type: 'polygon', points: BULLET.map(([bx, by]) => [f.x + bx, y + by]), fill: COLORS.text });
    }
    lines.forEach((line, li) => {
      if (li > 0) y += LEADING;
      const x = f.x + (p.hanging ? (li === 0 ? 0 : INDENT) : indent);
      pushLine(items, x, y, line, measure);
      lastSize = Math.max(...line.map((r) => r.size), 0) || lastSize;
    });
  });

  if (y + DESCENT * lastSize > f.bottom + 0.5) {
    warnings.push({
      key,
      label: spec.heading,
      message: `Texte trop long pour l’emplacement « ${spec.heading} » (dépasse de ${Math.round(y + DESCENT * lastSize - f.bottom)} pt) : il chevauche la rubrique suivante.`,
    });
  }
}

/** Nom de fichier lisible à partir du titre. */
export function fileNameFor(entry, fallback = 'fiche') {
  const base = (entry.fichier && entry.fichier.trim()) || splitLines(entry.titre).join(' ') || fallback;
  const slug = base
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’'"]/g, '-')
    .replace(/\.pdf$/i, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return (slug || fallback) + '.pdf';
}

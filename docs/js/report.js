// Récapitulatif des modifications (avant → après, par page) pour le graphiste.

import { storyGroup, storyLocation } from './idml.js';
import { paragraphText, paragraphOriginal, isParagraphModified, delta, formatPct, storyStats } from './state.js';

function collect(doc, edits) {
  const groups = [];
  const byKey = new Map();
  for (const s of doc.stories) {
    const mods = s.paragraphs.filter((p) => isParagraphModified(p, edits));
    if (!mods.length) continue;
    const g = storyGroup(doc, s);
    if (!byKey.has(g.key)) { const x = { ...g, stories: [] }; byKey.set(g.key, x); groups.push(x); }
    byKey.get(g.key).stories.push({
      story: s,
      location: storyLocation(doc, s),
      stats: storyStats(s, edits),
      paragraphs: mods.map((p) => ({
        p,
        before: paragraphOriginal(p),
        after: paragraphText(p, edits),
        d: delta(paragraphOriginal(p), paragraphText(p, edits)),
      })),
    });
  }
  groups.sort((a, b) => a.order - b.order);
  return groups;
}

const visible = (s) => s.replace(/\u2028/g, '↲\n').replace(/\t/g, '⇥');

function fmtDate(d) {
  return d.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
}

export function reportText(doc, edits, { date = new Date(), exportName = '' } = {}) {
  const groups = collect(doc, edits);
  const L = [];
  L.push('RÉCAPITULATIF DES MODIFICATIONS DE TEXTE');
  L.push(`Fichier d’origine : ${doc.fileName}`);
  if (exportName) L.push(`Fichier modifié   : ${exportName}`);
  L.push(`Date : ${fmtDate(date)}`);
  L.push('');
  L.push('Seuls les textes ont été modifiés (styles, blocs et images inchangés).');
  L.push('⚠ = texte plus long de plus de 10 % : vérifier les débordements.');
  L.push('');
  if (!groups.length) L.push('Aucune modification.');
  let n = 0;
  for (const g of groups) {
    L.push('='.repeat(60));
    L.push(g.label.toUpperCase());
    L.push('='.repeat(60));
    for (const st of g.stories) {
      L.push('');
      L.push(`Bloc ${st.story.number} (${st.location}) — ${st.stats.modified} paragraphe(s) modifié(s), longueur totale ${formatPct(st.stats.pct)}${st.stats.alert ? ' ⚠ DÉBORDEMENT POSSIBLE' : ''}`);
      for (const x of st.paragraphs) {
        n++;
        L.push('');
        L.push(`  [${n}] ${x.p.context ? x.p.context + ' — ' : ''}style « ${x.p.paraStyle || '?'} » — ${x.d.original} → ${x.d.current} caractères (${formatPct(x.d.pct)})${x.d.alert ? ' ⚠' : ''}`);
        L.push(`  AVANT : ${visible(x.before).replace(/\n/g, '\n          ')}`);
        L.push(`  APRÈS : ${visible(x.after).replace(/\n/g, '\n          ')}`);
      }
    }
    L.push('');
  }
  return L.join('\n') + '\n';
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const htmlText = (s) => esc(s).replace(/\u2028/g, '<span class="m">↲</span><br>').replace(/\n/g, '<span class="m">¶</span><br>').replace(/\t/g, '<span class="m">⇥</span>').replace(/ /g, '<span class="m nb">°</span>');

export function reportHtml(doc, edits, { date = new Date(), exportName = '' } = {}) {
  const groups = collect(doc, edits);
  let n = 0;
  const body = groups.map((g) => `
  <section>
    <h2>${esc(g.label)}</h2>
    ${g.stories.map((st) => `
    <article>
      <h3>Bloc ${st.story.number} <small>${esc(st.location)} — ${st.stats.modified} paragraphe(s) modifié(s), longueur totale ${esc(formatPct(st.stats.pct))}</small>${st.stats.alert ? ' <span class="alert">⚠ débordement possible</span>' : ''}</h3>
      ${st.paragraphs.map((x) => `
      <div class="mod${x.d.alert ? ' is-alert' : ''}">
        <p class="meta">[${++n}] ${x.p.context ? esc(x.p.context) + ' — ' : ''}style « ${esc(x.p.paraStyle || '?')} » — ${x.d.original} → ${x.d.current} caractères (<strong>${esc(formatPct(x.d.pct))}</strong>)${x.d.alert ? ' <span class="alert">⚠ +10 %</span>' : ''}</p>
        <div class="cols"><div class="before"><span class="lbl">Avant</span>${htmlText(x.before)}</div><div class="after"><span class="lbl">Après</span>${htmlText(x.after)}</div></div>
      </div>`).join('')}
    </article>`).join('')}
  </section>`).join('');

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Modifications — ${esc(doc.fileName)}</title>
<style>
  body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1d1d1f;max-width:1100px;margin:2rem auto;padding:0 1rem}
  h1{font-size:1.5rem;margin:0 0 .25rem} h2{border-bottom:2px solid #1d1d1f;padding-bottom:.25rem;margin-top:2.5rem}
  h3{font-size:1.05rem;margin:1.5rem 0 .5rem} h3 small{font-weight:normal;color:#555}
  .intro{color:#444} .mod{border:1px solid #ddd;border-radius:6px;padding:.5rem .75rem;margin:.5rem 0;break-inside:avoid}
  .mod.is-alert{border-color:#d4380d;background:#fff7f3} .meta{margin:0 0 .4rem;font-size:.85rem;color:#555}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:.75rem} .before,.after{padding:.4rem .6rem;border-radius:4px;white-space:pre-wrap}
  .before{background:#f4f4f5;color:#555} .after{background:#eefbea} .lbl{display:block;font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:#777}
  .alert{color:#d4380d;font-weight:600} .m{color:#aaa;font-size:.8em} .nb{vertical-align:super}
  @media print{body{margin:0}.mod{page-break-inside:avoid}}
</style>
</head>
<body>
<h1>Récapitulatif des modifications de texte</h1>
<p class="intro">Fichier d’origine : <strong>${esc(doc.fileName)}</strong>${exportName ? `<br>Fichier modifié : <strong>${esc(exportName)}</strong>` : ''}<br>Date : ${esc(fmtDate(date))}<br>
Seul le contenu des textes a été modifié : styles, blocs, positions et images sont inchangés.<br>
<span class="alert">⚠</span> = texte plus long de plus de 10 % : vérifiez que le texte ne déborde pas du bloc.<br>
Légende : ¶ nouveau paragraphe, ↲ saut de ligne forcé, ⇥ tabulation, ° espace insécable.</p>
${groups.length ? body : '<p>Aucune modification.</p>'}
</body>
</html>
`;
}

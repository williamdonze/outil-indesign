# Textes InDesign — modifier les textes d’un fichier IDML sans toucher à la mise en page

Petit site statique qui permet de **modifier uniquement les textes** d’un document InDesign exporté au format **IDML**, puis de télécharger un `.idml` modifié que le graphiste rouvre dans InDesign pour produire le PDF final.

- **100 % dans le navigateur** : aucun fichier, aucun texte n’est envoyé sur Internet. Pas de serveur, pas d’analytics, pas de CDN, pas de police externe.
- Une **Content-Security-Policy** (`default-src 'self'`, `connect-src 'self'`…) placée dans `docs/index.html` empêche toute requête vers un autre site.
- **Aucune dépendance externe** : la lecture/écriture ZIP utilise les API natives du navigateur (`CompressionStream` / `DecompressionStream`). Il n’y a donc pas de dossier `vendor/` : aucune librairie tierce n’est nécessaire.
- **Aucune étape de build** : le dossier `docs/` est publié tel quel par GitHub Pages.

---

## Sommaire

1. [Déployer sur GitHub Pages](#1-déployer-sur-github-pages)
2. [Mode d’emploi — rédacteur·rice (textes)](#2-mode-demploi--rédacteurrice-textes)
3. [Mode d’emploi — graphiste (InDesign)](#3-mode-demploi--graphiste-indesign)
4. [Garanties sur le fichier produit](#4-garanties-sur-le-fichier-produit)
5. [Limites connues](#5-limites-connues)
6. [Développement et tests](#6-développement-et-tests)

---

## 1. Déployer sur GitHub Pages

Le site se trouve entièrement dans le dossier **`docs/`** (HTML, CSS et JavaScript en modules ES, sans compilation).

1. Fusionnez le code sur la branche `main` (ou une autre branche de votre choix).
2. Sur GitHub, ouvrez le dépôt, puis **Settings → Pages**.
3. Sous **Build and deployment** :
   - **Source** : `Deploy from a branch`
   - **Branch** : `main` et dossier **`/docs`**, puis **Save**.
4. Après une minute environ, le site est disponible à l’adresse indiquée, du type
   `https://<votre-compte>.github.io/outil-indesign/`.

Le fichier `docs/.nojekyll` désactive le traitement Jekyll : les fichiers sont servis tels quels.

> **Confidentialité** : GitHub Pages ne sert que les fichiers du site. Le fichier IDML que vous ouvrez n’est jamais envoyé : il est lu par votre navigateur, et vos modifications sont enregistrées dans le stockage local de votre navigateur (IndexedDB), sur votre ordinateur uniquement.

### Tester en local

Les modules JavaScript ne fonctionnent pas en ouvrant `index.html` directement (`file://`). Lancez un petit serveur local :

```bash
python3 -m http.server 8000 --directory docs
```

Puis ouvrez <http://localhost:8000>.

---

## 2. Mode d’emploi — rédacteur·rice (textes)

1. **Ouvrir le fichier** : glissez le `.idml` reçu du graphiste sur la page d’accueil (ou cliquez pour le choisir).
   - Si vous recevez un `.indd`, l’outil vous l’indique : demandez au graphiste un export IDML (voir section 3).
2. **Plan des pages (à gauche)** : chaque page est dessinée schématiquement. Les blocs de texte sont en bleu, numérotés et affichent leurs premiers mots ; les images sont en gris. Cliquez sur un bloc pour aller à son texte.
3. **Textes (à droite)** : regroupés par page, un champ par paragraphe, pré-rempli avec le texte actuel. Cliquer dans un champ met en évidence le bloc correspondant sur le plan.
   - **Entrée** crée un nouveau paragraphe (même style). **Maj + Entrée** insère un saut de ligne forcé, affiché `↲`.
   - Les boutons « Insérer » ajoutent espace insécable, espace fine, apostrophe typographique ’, guillemets « », tirets, points de suspension.
   - Sous le champ actif, une ligne « Caractères invisibles » montre les espaces insécables (°), espaces fines (·), tabulations (⇥) et sauts de ligne forcés (↲).
4. **Paragraphes avec plusieurs mises en forme** (un mot en gras, un lien, un numéro de page automatique…) : ils sont affichés **segment par segment**, avec le style de chaque segment. Modifiez chaque segment séparément : chacun garde sa mise en forme. Les segments ne sont jamais fusionnés. Les éléments non textuels (`[n° de page]`, `[objet ancré]`, `[tableau]`…) sont conservés tels quels.
5. **Indicateurs** :
   - champ modifié **surligné en jaune**, avec le texte d’origine affiché dessous ;
   - compteur de caractères et écart en % par rapport à l’original ; **en rouge au-delà de +10 %**, car le texte risque de déborder du bloc ;
   - bouton **« Revenir à l’original »** sur chaque paragraphe ;
   - total par bloc dans l’en-tête du bloc.
6. **Recherche** : tapez dans « Rechercher dans les textes… » (accents et majuscules ignorés) ; Entrée passe au résultat suivant. La case « Seulement les textes modifiés » filtre la liste.
7. **Sauvegarde automatique** : chaque modification est enregistrée sur votre ordinateur. Si vous fermez l’onglet, rouvrez le site : la page d’accueil propose de **reprendre** le travail en cours (le fichier d’origine est aussi conservé localement).
   - Menu **Plus → Exporter mes modifications (.json)** pour faire une copie de sauvegarde ou continuer sur un autre ordinateur ; **Importer des modifications (.json)** pour les recharger. À l’import, une modification n’est appliquée que si le texte d’origine est identique (sinon elle est signalée et ignorée).
8. **Exporter** :
   - **« Télécharger l’IDML modifié »** → fichier `<nom_original>_textes_<date>.idml`. Il est relu et vérifié avant le téléchargement.
   - Menu **Plus → Récapitulatif pour le graphiste** (`.html` ou `.txt`) : la liste des modifications page par page (avant → après), avec les alertes de longueur. Envoyez-le avec le `.idml`.
9. **Panneau avancé** (menu Plus) : stories ignorées (blocs vides, ancrages, codes techniques), textes hors page, informations sur le fichier, effacement de toutes les modifications.

> Les textes des **gabarits** (en-têtes, pieds de page) sont listés à part : une modification s’applique à toutes les pages qui utilisent ce gabarit. Les textes sur la **table de montage** n’apparaissent pas dans le PDF.

---

## 3. Mode d’emploi — graphiste (InDesign)

### Envoyer le document pour la relecture des textes

1. Ouvrez le document dans InDesign.
2. **Fichier > Enregistrer sous…** (ou **Fichier > Exporter…**).
3. Dans **Format**, choisissez **InDesign Markup (IDML)**, puis enregistrez.
4. Envoyez le fichier `.idml` (pas le `.indd`).

### Récupérer les textes modifiés

1. Ouvrez le fichier reçu `<nom>_textes_<date>.idml` dans InDesign (**Fichier > Ouvrir**). InDesign crée un nouveau document sans titre : enregistrez-le en `.indd` sous un nouveau nom pour garder l’original intact.
2. Si InDesign signale des polices ou des liens manquants, c’est lié à votre poste (les images et polices ne sont pas modifiées par l’outil) : rétablissez-les comme d’habitude via **Fenêtre > Liens** si besoin.
3. **Vérifiez les débordements** : ouvrez le **récapitulatif** reçu (`.html` ou `.txt`). Il liste toutes les modifications page par page, et signale par ⚠ les textes plus longs de plus de 10 %. Contrôlez en particulier :
   - les blocs avec un **signe de texte en excès** (petit `+` rouge en bas à droite du bloc) ;
   - **Fenêtre > Sortie > Contrôle en amont** (Preflight) : l’erreur « Texte en excès » liste tous les blocs qui débordent ;
   - les césures, veuves et orphelines dans les paragraphes modifiés.
4. Exportez le PDF final : **Fichier > Exporter… > Adobe PDF (impression)**.

Seul le contenu des textes a été changé : styles de paragraphe et de caractère, mises en forme locales, blocs, chaînages, positions, images et couleurs sont strictement identiques.

---

## 4. Garanties sur le fichier produit

- L’entrée **`mimetype`** est toujours la **première** du ZIP, **non compressée** et sans champ « extra » (sinon InDesign refuse le fichier). C’est vérifié après chaque export.
- Tous les fichiers du ZIP autres que les stories modifiées sont **recopiés octet pour octet**, données compressées comprises (aucune recompression).
- Dans une story modifiée, **seul le texte des balises `<Content>` change**. Les éventuels `<Br/>` ajoutés (nouveau paragraphe) le sont dans le même `CharacterStyleRange`. Tous les `ParagraphStyleRange`, `CharacterStyleRange` et leurs attributs sont conservés. Après l’export, l’outil relit le fichier et vérifie que la suite des balises (hors `Content`/`Br`) et leurs attributs sont identiques à l’original.
- Les caractères `&`, `<`, `>` sont échappés ; les espaces insécables, apostrophes typographiques et tabulations sont conservés ; les caractères interdits en XML (caractères de contrôle) sont retirés.
- Les codes spéciaux InDesign (`<?ACE …?>` : numéro de page, fin de style imbriqué…), objets ancrés, tableaux, notes, liens hypertexte et variables sont conservés.

---

## 5. Limites connues

- **Supprimer un paragraphe entier** n’est pas possible (cela demanderait de supprimer un `<Br/>` existant et pourrait changer le style de paragraphe appliqué). Videz le champ ; le paragraphe vide restera et le graphiste le supprimera (il apparaît dans le récapitulatif).
- On ne peut pas taper du texte « à l’intérieur » d’un code spécial (par exemple juste avant un numéro de page automatique si aucun texte ne le précède dans InDesign).
- Le plan est schématique (rectangle englobant pour les blocs tournés ou non rectangulaires, pas de rendu typographique) ; il ne détecte pas les débordements réels.
- Navigateur récent requis (Firefox, Chrome, Edge ou Safari 2023 ou plus récent), pour `CompressionStream`.
- Les archives ZIP64 (fichiers de plus de 4 Go) ne sont pas prises en charge.

---

## 6. Développement et tests

```
docs/                    ← site publié par GitHub Pages
  index.html             ← page unique, avec la Content-Security-Policy
  css/style.css
  js/zip.js              ← lecture/écriture ZIP (copie brute des entrées non modifiées)
  js/xml.js              ← mini-analyseur XML qui conserve la position de chaque nœud
  js/idml.js             ← designmap, spreads (géométrie), stories (paragraphes, segments)
  js/writer.js           ← réécriture des <Content> + vérification du fichier produit
  js/state.js            ← modifications, compteurs, import/export JSON
  js/report.js           ← récapitulatif .html / .txt
  js/storage.js          ← sauvegarde locale (IndexedDB)
  js/app.js              ← interface
tests/
  fixtures/build-fixture.mjs  ← génère une fixture IDML minimale (3 pages + 1 gabarit)
  fixtures/minimal.idml       ← la fixture générée (utile pour essayer l’interface)
  idml.test.mjs               ← tests automatisés
```

Prérequis : Node.js ≥ 20, sans aucune installation de paquets.

```bash
npm test
```

Les tests couvrent :

- la lecture (pages, ordre des stories par page puis position, paragraphes, segments, caractères spéciaux, codes `ACE`, liens, tableaux, objets ancrés, stories vides ignorées) ;
- le calcul des positions des blocs pour le plan (transformations de page, de groupe, rotation, blocs chaînés, table de montage) ;
- l’aller-retour sans modification (contenus identiques, données compressées identiques) ;
- la modification d’un texte, l’échappement XML, l’ajout de paragraphes (`<Br/>`), la conservation des styles et l’identité octet pour octet des autres fichiers ;
- l’intégrité du ZIP (`mimetype` en premier, non compressé, sans champ extra ; relecture par `python3 zipfile` si disponible) ;
- les erreurs (`.indd`, PDF, ZIP non IDML, archive tronquée) ;
- les compteurs, l’export/import JSON et le récapitulatif.

Pour régénérer la fixture : `npm run fixture`. Les tests sont aussi lancés automatiquement par GitHub Actions (`.github/workflows/tests.yml`) à chaque push.

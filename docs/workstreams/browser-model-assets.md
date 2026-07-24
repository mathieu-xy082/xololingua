# Workstream — `ec/browser-model-assets`

## Objectif

Remplacer la validation browser ML déterministe/injectée par une vraie chaîne navigateur capable d'utiliser des modèles ASR et traduction packagés ou mis en cache localement, avec un fallback Python explicite quand les assets ou les ressources navigateur sont indisponibles.

Cette branche démarre depuis :

```text
ec/backend
```

## Contexte intégré dans `ec/backend`

`ec/backend` contient déjà :

- pipeline hybride browser/server ;
- contrats canonique `{stage,runtime,strategy,payload,metadata}` au niveau du routeur JS ;
- audio extraction browser via ffmpeg.wasm/WebCodecs-ready path ;
- VAD navigateur ;
- adapters browser transcription/traduction via workers ;
- fallback Python clair ;
- `pdm run e2e-browser-strict`, gate rapide déterministe qui exige les markers browser et compare le SRT browser à une référence backend.

Le gate rapide reste utile pour CI rapide. Cette branche doit ajouter un **gate séparé** pour vrais modèles browser.

## Cahier des charges

### 1. Choix des modèles browser réels

Évaluer et documenter au moins une option ASR et une option traduction :

- ASR : Whisper via Transformers.js, Whisper WASM/WebGPU, ou alternative browser-compatible ;
- traduction : Transformers.js / modèle local compatible ou alternative browser-compatible ;
- compatibilité navigateur Chromium/Playwright ;
- taille des poids ;
- licence ;
- langues minimales : source français vers cible anglais pour le fixture `lisoir_dnde442_quarter.mp4` ;
- empreinte mémoire et temps de warmup réalistes.

Livrable attendu : décision documentée, plus metadata exposée côté app/service worker.

### 2. Packaging local/offline des poids

Mettre en place une stratégie explicite :

- assets modèles servis localement par l'app ou le dev server ;
- chemins versionnés et cache-bustables ;
- pas de téléchargement réseau implicite pendant les tests offline ;
- gros fichiers non commités si inadaptés au repo : documenter le mécanisme de téléchargement/cache externe ;
- checksum/manifest pour savoir quelle version modèle est active.

### 3. Cache/service worker

Étendre le PWA/service worker pour :

- mettre en cache les manifests et assets modèle nécessaires ;
- distinguer shell offline, assets ML offline, et backend fallback ;
- exposer une erreur utilisateur claire si le shell est offline mais les modèles ne sont pas encore disponibles ;
- invalider correctement le cache quand la version modèle change.

### 4. Téléchargement initial si trop lourd

Si les modèles sont trop gros pour être précachés systématiquement :

- prévoir un flux d'amorçage contrôlé ;
- afficher taille/progression ;
- permettre retry/reprise si possible ;
- ne pas bloquer le gate déterministe rapide ;
- préserver fallback Python quand le modèle n'est pas installé.

### 5. Limites mémoire navigateur

Définir et tester :

- limite taille/durée audio ;
- limite mémoire estimée pour modèle + audio + segments ;
- comportement si WebGPU/WebAssembly SIMD/threads/IndexedDB/cache API indisponibles ;
- message/fallback clair en cas de dépassement.

### 6. Warmup modèle

Ajouter un warmup contrôlé :

- warmup ASR ;
- warmup traduction ;
- timeout par warmup ;
- reporting progression ;
- possibilité de fallback sans laisser le pipeline dans un état ambigu.

### 7. Timeouts réalistes

Définir des timeouts séparés :

- chargement manifest ;
- téléchargement/cache ;
- initialisation runtime ;
- warmup ;
- inférence par segment/batch ;
- pipeline complet E2E réel.

Les erreurs doivent indiquer le stage, le runtime, la stratégie et la raison de fallback.

### 8. Fallback clair si modèle indisponible

Le fallback doit rester contractuel :

```js
{
  stage,
  runtime: "server-fallback",
  strategy,
  payload,
  metadata: {
    fallbackReason,
    endpoint,
    attemptedBrowserStrategy
  }
}
```

Ne pas masquer un modèle manquant en succès browser.

### 9. Tests E2E avec vrais modèles browser

Ajouter un gate distinct du gate rapide déterministe :

```bash
pdm run e2e-browser-real-models
```

Ce gate doit :

- utiliser les vrais assets modèle navigateur ou un cache local explicitement préparé ;
- refuser les adapters déterministes/injectés ;
- prouver les markers browser ASR/traduction réels ;
- vérifier couverture temporelle sur `lisoir_dnde442_quarter.mp4` ;
- comparer au backend avec seuils adaptés aux vrais modèles, pas nécessairement similarité 1.000 ;
- produire un diagnostic court exploitable par Mathieu depuis LabCoat/screenshot.

## Validation ladder

### Préparatoire

```bash
pdm run frontend_test
```

### Backend référence inchangé

```bash
pdm run api-e2e
```

### Gate rapide déterministe existant

```bash
pdm run e2e-browser-strict
```

### Nouveau gate réel attendu

```bash
pdm run e2e-browser-real-models
```

La branche ne doit annoncer :

```text
BRANCHE PRÊTE POUR REVIEW: ec/browser-model-assets
```

que lorsque le nouveau gate réel est implémenté, documenté, et vert, ou lorsque le rapport explique explicitement un blocker externe non contournable avec preuves.

## Découpage recommandé

1. Ajouter manifest modèle + tests unitaires du resolver/cache metadata. ✅ `BROWSER_MODEL_ASSET_MANIFEST` déclare les choix ASR/traduction et refuse les URLs distantes implicites.
2. Ajouter stratégie de chargement offline/cache et erreurs/fallbacks testées. ✅ `frontend/model_asset_bootstrap.js` inspecte la Cache API réelle, détecte IndexedDB/Cache API, produit `offline-ready` / `bootstrap-required` / `unavailable`, liste `missingModelAssets`, et propage le fallback metadata dans les capacités client async.
3. Brancher le fallback metadata dans le pipeline/UI. ✅ L'app démarre sur le resolver async réel, conserve l'injection déterministe du gate strict, affiche `modelAssetBootstrapLabel` dans les fallbacks PWA, et les résumés de stages incluent status, taille restante et assets manquants.
4. Brancher ASR réel browser avec warmup/timeouts.
5. Brancher traduction réelle browser avec warmup/timeouts.
6. Étendre service worker/cache versionné avec flux de bootstrap/retry utilisateur.
7. Ajouter `e2e-browser-real-models` et diagnostics compactes.
8. Valider full ladder et pousser.

## Contraintes d'hygiène

- Pas d'assets générés dans le repo sauf petits manifests/scripts utiles.
- Utiliser `/root/.cache/xololingua/tmp` pour téléchargements/tests temporaires.
- Ne pas casser `e2e-browser-strict` : il reste le gate rapide déterministe.
- Ne pas continuer d'anciennes branches intégrées (`ec/client-ml-stages`, `ec/pwa-offline-integration`) ; tout nouveau travail se fait ici.

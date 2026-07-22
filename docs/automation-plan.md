# XoloLingua — plan d'automatisation

Ce fichier documente les tâches Hermes planifiées qui pilotent le projet XoloLingua.

Repository local :

```text
/root/android-app-games/xololingua
```

Repository GitLab :

```text
git@gitlab.com:android-app-games/xololingua.git
```

## Règles générales

- `main` reste la branche stable.
- `ec/backend` est la baseline d'intégration/review pour le travail backend → client/PWA accumulé.
- Les nouvelles itérations ne doivent plus grossir `ec/backend` directement : elles partent de branches spécialisées.
- Les branches secondaires ou follow-up doivent rester dédiées à un objectif clair.
- Une branche déjà mergée/fermée ne doit pas être réutilisée pour de nouveaux travaux.
- Toute intégration dans `main` ou `ec/backend` nécessite une review explicite avec Mathieu.
- Les validations doivent distinguer clairement : unitaires, frontend, `pdm run check`, API E2E, browser/user E2E.
- Les artefacts temporaires/générés doivent rester hors repo, sous `/root/.cache/xololingua/tmp` si nécessaire.
- Après des commits uniquement documentaires sur `ec/backend`, ne pas rebaser toutes les branches immédiatement; attendre environ 3–4 commits docs ou 5 jours max, sauf changement code/contrat/CI.
- Ne pas confondre branche intégrée et branche placeholder : une branche active avec `0` commit unique vs `ec/backend` est à démarrer/débloquer, pas à considérer terminée.
- Après intégration réelle d'une branche feature dans sa target et pause du job associé, supprimer la branche remote feature après vérification de containment.

## État d'intégration courant

`ec/backend` contient maintenant :

- router hybride et reporting de stages browser/server ;
- normalisation canonique des contrats de stages `{stage,runtime,strategy,payload,metadata}` côté routeur JavaScript ;
- extraction audio navigateur WebCodecs/ffmpeg.wasm + fallback Python ;
- VAD navigateur et fallback Python alignés sur les contrats canonique ;
- intégration PWA/offline shell avec métadonnées honnêtes sur les assets offline vs backend ;
- transcription/traduction client-side via adapters browser et workers, avec fallback Python clair ;
- gate `pdm run e2e-browser-strict` qui exige audio/VAD/transcription/traduction browser et compare le SRT browser à une référence backend déterministe.

Le prochain risque architectural est maintenant le passage des adapters/injections browser ML à de vrais modèles navigateur packagés/offline. La priorité active devient `ec/browser-model-assets`.

## Tâche maîtresse

| Job ID | Nom | Cadence | Rôle |
|---|---|---:|---|
| `443746743ea7` | XoloLingua master branch coordinator | 12h | Coordinateur read-only: surveille branches/jobs, agrège les sorties des tâches spécialisées, signale readiness review, recommande ordre d'intégration |

La tâche maîtresse est read-only par défaut. Elle ne doit pas :

- coder à la place des sous-tâches ;
- merger dans `main` ou `ec/backend` ;
- supprimer une branche ;
- force-push ;
- créer/modifier/supprimer d'autres cron jobs.

Elle reçoit comme contexte les derniers outputs des sous-tâches spécialisées via `context_from` quand des jobs spécialisés sont actifs.

Elle doit alerter avec le marqueur suivant lorsqu'une branche semble prête :

```text
BRANCHE PRÊTE POUR REVIEW: <branch>
```

## Tâches suivies

| Priorité | Job ID | Nom | Branche principale | Cadence | État | Rôle |
|---:|---|---|---|---:|---|---|
| P0 | `à créer` | XoloLingua P0 browser real model assets | `ec/browser-model-assets` | 12h | active | Choisir, packager et valider de vrais modèles browser ASR/traduction avec assets offline/cache/warmup/timeouts/fallbacks |
| coord | `443746743ea7` | XoloLingua master branch coordinator | n/a | 12h | active | Coordination read-only |
| cleanup | `4e64fc0e1685` | XoloLingua tmp cleanup | n/a | quotidien 03:00 UTC | active | Nettoyage no-agent des fichiers temporaires hors repo |

## Jobs historiques ou pausés

| Job ID | Nom | Branche | État | Note |
|---|---|---|---|---|
| `5ae54a428d43` | XoloLingua P0 browser audio contract/runtime wiring | `ec/browser-audio-runtime-wiring` | pause | Placeholder sans commit propre vs `ec/backend`; branche remote supprimée après vérification de containment |
| `885307802b8f` | XoloLingua backend-to-client migration — usable client milestone by 2026-07-22 | `ec/backend` | pause | Ancien job monolithique |
| `36180c1d35d6` | XoloLingua browser audio extraction workstream | `ec/browser-audio-extraction` | historique/intégré | Socle extraction audio dans `ec/backend`; branche remote supprimée |
| `0feea85268be` | XoloLingua hybrid pipeline routing workstream | `ec/hybrid-pipeline-routing` | pause | Intégré dans `ec/backend`; branche remote supprimée |
| `469e4544f5ce` | XoloLingua app hybrid router wiring workstream | `ec/app-hybrid-router-wiring` | historique/intégré | Socle app/router dans `ec/backend`; branche remote supprimée |
| `44a387028e9f` | XoloLingua P0 pipeline stage contract normalization | `ec/pipeline-stage-contract-normalization` | pause/intégré | Contrat canonique intégré dans `ec/backend` |
| `4b71c672d8b8` | XoloLingua P1 browser VAD segmentation | `ec/browser-vad-segmentation` | pause/intégré | VAD navigateur intégré dans `ec/backend` |
| `46a6795cd1ff` | XoloLingua P2/P3 client ML stages | `ec/client-ml-stages` | intégré | Intégré dans `ec/backend`; branche remote supprimée |
| `5263f6352045` | XoloLingua PWA service metadata truthfulness | `ec/pwa-offline-integration` | intégré | Intégré dans `ec/backend`; branche remote supprimée |
| `639f23a146c0` | XoloLingua client ML stages workstream | `ec/client-ml-stages` | remplacé/ancien | Remplacé par le pilotage P2/P3, puis intégré |
| `63a1182beb92` | XoloLingua PWA offline integration workstream | `ec/pwa-offline-integration` | remplacé/ancien | Remplacé par le pilotage PWA, puis intégré |
| `89e76696343f` | XoloLingua backend review stabilization workstream | `ec/backend-review-stabilization` | pause | Intégré/clos; branche remote supprimée |

## Branches surveillées

Branches principales :

- `main`
- `ec/backend`

Branches spécialisées actives :

- `ec/browser-model-assets`

Branches historiques/follow-up encore présentes à surveiller sans les réutiliser automatiquement :

- `ec/many-languages`
- `ec/readme-v2`
- `ec/speedup`

## Ordre recommandé de review

1. `ec/browser-model-assets` — packaging de vrais modèles ASR/traduction navigateur, assets offline/cache/warmup/timeouts/fallbacks, puis E2E browser réel distinct du gate déterministe rapide.
2. Branches follow-up explicitement créées après fermeture/merge d'une branche existante.
3. Nettoyage de branches historiques uniquement après confirmation de Mathieu.

## Commandes de validation utiles

Validation composite légère :

```bash
pdm run check
```

Validation API E2E :

```bash
pdm run api-e2e
```

Validation navigateur stricte déterministe rapide :

```bash
pdm run e2e-browser-strict
```

Future validation navigateur avec vrais modèles packagés, à créer dans `ec/browser-model-assets` :

```bash
pdm run e2e-browser-real-models
```

## Rôle du coordinateur

À chaque run, le coordinateur doit :

1. inspecter `main`, `ec/backend` et les branches spécialisées pertinentes ;
2. lire les derniers outputs des tâches spécialisées ;
3. identifier les branches prêtes pour review ;
4. identifier les blocages et validations manquantes ;
5. vérifier que les travaux navigateur/fallback respectent le contrat canonique intégré dans `ec/backend` ;
6. vérifier que `ec/browser-model-assets` garde un gate E2E réel distinct de `e2e-browser-strict` déterministe ;
7. recommander l'ordre de review/intégration ;
8. fournir un résumé court et actionnable à Mathieu.

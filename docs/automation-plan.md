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
- `ec/backend` est la baseline d'intégration/review pour le travail backend → client/PWA déjà accumulé.
- Les nouvelles itérations ne doivent plus grossir `ec/backend` directement : elles partent de branches spécialisées.
- Les branches secondaires ou follow-up doivent rester dédiées à un objectif clair.
- Une branche déjà mergée/fermée ne doit pas être réutilisée pour de nouveaux travaux.
- Toute intégration dans `main` ou `ec/backend` nécessite une review explicite avec Mathieu.
- Les validations doivent distinguer clairement : unitaires, frontend, `pdm run check`, API E2E, browser/user E2E.
- Les artefacts temporaires/générés doivent rester hors repo, sous `/root/.cache/xololingua/tmp` si nécessaire.
- Après des commits uniquement documentaires sur `ec/backend`, ne pas rebaser toutes les branches immédiatement; attendre environ 3–4 commits docs ou 5 jours max, sauf changement code/contrat/CI.

## État d'intégration courant

`ec/backend` contient déjà :

- router hybride et reporting de stages browser/server;
- extraction audio navigateur WebCodecs/ffmpeg.wasm + fallback Python;
- wiring audio runtime actuellement aligné avec `ec/backend`;
- VAD segmentation branchée au même commit que `ec/backend` à la date de ce plan.

Le prochain risque architectural est l'incompatibilité subtile entre résultats navigateur et fallback Python. La priorité est donc maintenant la normalisation canonique du contrat de sortie de chaque stage.

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

Elle reçoit comme contexte les derniers outputs des sous-tâches spécialisées via `context_from`.

Elle doit alerter avec le marqueur suivant lorsqu'une branche semble prête :

```text
BRANCHE PRÊTE POUR REVIEW: <branch>
```

## Tâches suivies

| Priorité | Job ID | Nom | Branche principale | Cadence | État | Rôle |
|---:|---|---|---|---:|---|---|
| P0 | `44a387028e9f` | XoloLingua P0 pipeline stage contract normalization | `ec/pipeline-stage-contract-normalization` | 6h | active | Normaliser le contrat canonique `{stage,runtime,strategy,payload,metadata}` entre navigateur et fallback Python |
| P1 | `4b71c672d8b8` | XoloLingua P1 browser VAD segmentation | `ec/browser-vad-segmentation` | 8h | active | VAD navigateur, à aligner sur le contrat canonique P0 |
| P2/P3 | `46a6795cd1ff` | XoloLingua P2/P3 client ML stages | `ec/client-ml-stages` | 8h | active | Transcription/traduction côté client, à aligner sur le contrat canonique |
| PWA | `5263f6352045` | XoloLingua PWA service metadata truthfulness | `ec/pwa-offline-integration` | 12h | active | Cohérence des métadonnées service/PWA et vérité affichée utilisateur |
| coord | `443746743ea7` | XoloLingua master branch coordinator | n/a | 12h | active | Coordination read-only |
| cleanup | `4e64fc0e1685` | XoloLingua tmp cleanup | n/a | quotidien 03:00 UTC | active | Nettoyage no-agent des fichiers temporaires hors repo |

## Jobs historiques ou pausés

| Job ID | Nom | Branche | État | Note |
|---|---|---|---|---|
| `5ae54a428d43` | XoloLingua P0 browser audio contract/runtime wiring | `ec/browser-audio-runtime-wiring` | pause | Branche sans commit propre vs `ec/backend`; conservée pour historique |
| `885307802b8f` | XoloLingua backend-to-client migration — usable client milestone by 2026-07-22 | `ec/backend` | pause | Ancien job monolithique |
| `36180c1d35d6` | XoloLingua browser audio extraction workstream | `ec/browser-audio-extraction` | historique/intégré | Socle extraction audio déjà dans `ec/backend` |
| `0feea85268be` | XoloLingua hybrid pipeline routing workstream | `ec/hybrid-pipeline-routing` | pause | Intégré dans `ec/backend` |
| `469e4544f5ce` | XoloLingua app hybrid router wiring workstream | `ec/app-hybrid-router-wiring` | historique/intégré | Socle app/router déjà dans `ec/backend` |
| `639f23a146c0` | XoloLingua client ML stages workstream | `ec/client-ml-stages` | remplacé/ancien | Remplacé par `46a6795cd1ff` dans le pilotage actuel |
| `63a1182beb92` | XoloLingua PWA offline integration workstream | `ec/pwa-offline-integration` | remplacé/ancien | Remplacé par `5263f6352045` dans le pilotage actuel |
| `89e76696343f` | XoloLingua backend review stabilization workstream | `ec/backend-review-stabilization` | pause | Intégré/clos |

## Branches surveillées

Branches principales :

- `main`
- `ec/backend`

Branches spécialisées actives :

- `ec/pipeline-stage-contract-normalization`
- `ec/browser-vad-segmentation`
- `ec/client-ml-stages`
- `ec/pwa-offline-integration`

Branches historiques/follow-up à surveiller sans les réutiliser automatiquement :

- `ec/browser-audio-runtime-wiring`
- `ec/browser-audio-extraction`
- `ec/hybrid-pipeline-routing`
- `ec/app-hybrid-router-wiring`
- `ec/backend-review-stabilization`
- `ec/more-languages`
- `follow/more-languages`
- `ec/many-languages`
- `ec/readme-v2`
- `ec/speedup`

## Ordre recommandé de review

1. `ec/pipeline-stage-contract-normalization` — priorité P0 : contrat canonique stage/runtime/payload pour éviter les incompatibilités navigateur/fallback Python.
2. `ec/browser-vad-segmentation` — reprendre/valider après alignement explicite sur le contrat P0.
3. `ec/client-ml-stages` — transcription/traduction client après le contrat P0.
4. `ec/pwa-offline-integration` — cohérence PWA/service metadata après clarification du contrat runtime.
5. Branches follow-up explicitement créées après fermeture/merge d'une branche existante.
6. Nettoyage de branches historiques uniquement après confirmation de Mathieu.

## Commandes de validation utiles

Validation composite légère :

```bash
pdm run check
```

Validation API E2E :

```bash
pdm run api-e2e
```

Validation navigateur stricte, lorsque nécessaire :

```bash
pdm run browser-e2e
```

## Rôle du coordinateur

À chaque run, le coordinateur doit :

1. inspecter `main`, `ec/backend` et les branches spécialisées pertinentes ;
2. lire les derniers outputs des tâches spécialisées ;
3. identifier les branches prêtes pour review ;
4. identifier les blocages et validations manquantes ;
5. vérifier que les nouveaux travaux navigateur/fallback respectent le contrat canonique P0 ;
6. recommander l'ordre de review/intégration ;
7. fournir un résumé court et actionnable à Mathieu.

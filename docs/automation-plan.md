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
- `ec/backend` devient une **baseline d'intégration/review** pour le travail backend → client/PWA déjà accumulé.
- Les nouvelles itérations ne doivent plus grossir `ec/backend` directement : elles partent de branches spécialisées.
- Les branches secondaires ou follow-up doivent rester dédiées à un objectif clair.
- Une branche déjà mergée/fermée ne doit pas être réutilisée pour de nouveaux travaux.
- Toute intégration dans `main` nécessite une review explicite avec Mathieu.
- Les validations doivent distinguer clairement : unitaires, frontend, API E2E, browser/user E2E.
- Les artefacts temporaires/générés doivent rester hors repo, sous `/root/.cache/xololingua/tmp` si nécessaire.

## Décision de restructuration

La branche `ec/backend` est devenue trop massive pour continuer à porter toutes les sous-évolutions. Le pilotage est donc éclaté en branches spécialisées basées sur l'état actuel de `ec/backend` :

```text
8fc8810 docs: add XoloLingua automation coordinator
```

L'ancien job monolithique est conservé pour historique/contexte mais mis en pause.

## Tâche maîtresse

| Job ID | Nom | Cadence | Répétitions | Rôle |
|---|---|---:|---:|---|
| `443746743ea7` | XoloLingua master branch coordinator | 12h | 60 | Coordonne les branches/tâches, surveille readiness review, risques et blocages |

La tâche maîtresse est read-only par défaut. Elle ne doit pas :

- coder à la place des sous-tâches ;
- merger dans `main` ;
- supprimer une branche ;
- force-push ;
- créer/modifier/supprimer d'autres cron jobs.

Elle reçoit comme contexte les derniers outputs des sous-tâches spécialisées via `context_from`.

Elle doit alerter avec le marqueur suivant lorsqu'une branche semble prête :

```text
BRANCHE PRÊTE POUR REVIEW: <branch>
```

## Tâches suivies

| Job ID | Nom | Branche principale | Cadence | État | Rôle |
|---|---|---|---:|---|---|
| `885307802b8f` | XoloLingua backend-to-client migration — usable client milestone by 2026-07-22 | `ec/backend` | 4h | **pause** | Ancien job monolithique, conservé pour historique/contexte |
| `589dc2f140b9` | XoloLingua urgent GitLab CI workstream | `ci/gitlab-pipeline` | 4h | active | Ajout urgent d'une CI GitLab PDM/Node pour `pdm run check` |
| `36180c1d35d6` | XoloLingua browser audio extraction workstream | `ec/browser-audio-extraction` | 8h | active | **Priorité 2** — WebCodecs/ffmpeg.wasm, bornage, release runtime, fallback audio |
| `0feea85268be` | XoloLingua hybrid pipeline routing workstream | `ec/hybrid-pipeline-routing` | 8h | pause | Intégré dans `ec/backend`; conservé pour historique/contexte |
| `469e4544f5ce` | XoloLingua app hybrid router wiring workstream | `ec/app-hybrid-router-wiring` | 6h | active | **Priorité 1** — brancher `app.js` sur le router hybride, rapport stages browser/server |
| `639f23a146c0` | XoloLingua client ML stages workstream | `ec/client-ml-stages` | 8h | pause | Temporairement dépriorisé pendant le focus priorités 1–2 |
| `63a1182beb92` | XoloLingua PWA offline integration workstream | `ec/pwa-offline-integration` | 12h | pause | Temporairement dépriorisé hors pré-cache nécessaire au wiring router |
| `89e76696343f` | XoloLingua backend review stabilization workstream | `ec/backend-review-stabilization` | 12h | pause | Intégré/clos; conservé pour historique/contexte |
| `4e64fc0e1685` | XoloLingua tmp cleanup | n/a | quotidien 03:00 UTC | active | Nettoyage no-agent des fichiers temporaires hors repo |

## Branches surveillées

Branches principales :

- `main`
- `ec/backend`

Branches spécialisées actives :

- `ec/app-hybrid-router-wiring`
- `ec/browser-audio-extraction`

Branches spécialisées temporairement en pause ou historiques :

- `ci/gitlab-pipeline`
- `ec/hybrid-pipeline-routing`
- `ec/client-ml-stages`
- `ec/pwa-offline-integration`
- `ec/backend-review-stabilization`

Branches historiques/follow-up à surveiller sans les réutiliser automatiquement :

- `ec/more-languages`
- `follow/more-languages`
- `ec/many-languages`
- `ec/readme-v2`
- `ec/speedup`

## Ordre recommandé de review

1. `ec/app-hybrid-router-wiring` — priorité 1 : brancher `app.js` sur le router hybride et rendre visibles les stages browser/server.
2. `ec/browser-audio-extraction` — priorité 2 : extraction audio navigateur et réduction pression serveur.
3. `ci/gitlab-pipeline` — surveiller seulement si CI rouge ou validation remote nécessaire.
4. `ec/client-ml-stages` — reprendre après preuve visible du flux hybride UI + extraction audio browser.
5. `ec/pwa-offline-integration` — reprendre après le wiring router, sauf corrections de pré-cache nécessaires.
6. Branches follow-up explicitement créées après fermeture/merge d'une branche existante.
7. Nettoyage de branches historiques uniquement après confirmation de Mathieu.

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
5. recommander l'ordre de review/intégration ;
6. fournir un résumé court et actionnable à Mathieu.

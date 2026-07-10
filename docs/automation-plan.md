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
- `ec/backend` est la branche canonique active pour la migration backend → client/PWA.
- Les branches secondaires ou follow-up doivent rester dédiées à un objectif clair.
- Une branche déjà mergée/fermée ne doit pas être réutilisée pour de nouveaux travaux.
- Toute intégration dans `main` nécessite une review explicite avec Mathieu.
- Les validations doivent distinguer clairement : unitaires, frontend, API E2E, browser/user E2E.
- Les artefacts temporaires/générés doivent rester hors repo, sous `/root/.cache/xololingua/tmp` si nécessaire.

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

Elle doit alerter avec le marqueur suivant lorsqu'une branche semble prête :

```text
BRANCHE PRÊTE POUR REVIEW: <branch>
```

## Tâches suivies

| Job ID | Nom | Branche principale | Cadence | État | Rôle |
|---|---|---|---:|---|---|
| `885307802b8f` | XoloLingua backend-to-client migration — usable client milestone by 2026-07-22 | `ec/backend` | 4h | active | Migration backend → client/PWA, réduction pression serveur |
| `4e64fc0e1685` | XoloLingua tmp cleanup | n/a | quotidien 03:00 UTC | active | Nettoyage no-agent des fichiers temporaires hors repo |

## Branches surveillées

Branches principales :

- `main`
- `ec/backend`

Branches historiques/follow-up à surveiller sans les réutiliser automatiquement :

- `ec/more-languages`
- `follow/more-languages`
- `ec/many-languages`
- `ec/readme-v2`
- `ec/speedup`

## Ordre recommandé de review

1. `ec/backend` lorsque la migration backend → client atteint un jalon cohérent et validable.
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

Validation navigateur stricte, lorsque nécessaire :

```bash
pdm run browser-e2e
```

## Rôle du coordinateur

À chaque run, le coordinateur doit :

1. inspecter `main`, `ec/backend` et les branches secondaires pertinentes ;
2. lire le dernier output de la tâche migration backend → client ;
3. identifier les branches prêtes pour review ;
4. identifier les blocages et validations manquantes ;
5. recommander l'ordre de review/intégration ;
6. fournir un résumé court et actionnable à Mathieu.

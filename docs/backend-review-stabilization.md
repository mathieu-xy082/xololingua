# Review stabilization — `ec/backend`

Ce document prépare la review humaine de la baseline `ec/backend` sans ajouter de nouvelle feature.

## Périmètre de review

Base comparée : `origin/main..origin/ec/backend`.

- 43 commits d'écart avec `main`, dont une intégration CI et plusieurs séries frontend/PWA.
- 27 fichiers touchés.
- Diffstat observé : environ 2 493 insertions et 117 suppressions.
- La branche de stabilisation `ec/backend-review-stabilization` reste alignée sur `origin/ec/backend` et ne doit contenir que documentation/checklists/correctifs non fonctionnels de review.

## Inventaire synthétique des changements

| Zone | Fichiers principaux | Points à reviewer |
|---|---|---|
| Backend/API local | `local_service.py`, `xololingua_service/`, tests Python | Compatibilité des endpoints existants, gestion erreurs JSON, polling des jobs subtitle. |
| Frontend orchestration | `app.js`, `frontend/backend_client.js`, `frontend/client_pipeline_router.js` | Contrat entre UI, adapters client et fallback Python. |
| Client-side migration probes | `frontend/client_pipeline_capabilities.js`, `frontend/client_audio_extractor.js`, `frontend/client_vad_segmenter.js`, `frontend/client_transcriber.js`, `frontend/client_translator.js` | Détection explicite des capacités, bornes de sécurité, routes de fallback. |
| Formatting SRT | `frontend/client_srt_formatter.js`, tests associés | Format temporel, ordre des segments, compatibilité téléchargement. |
| PWA/offline | `sw.js`, `package.json`, tests service worker | Bruit de cache, compatibilité Node 18, scope des assets précachés. |
| CI/validation | `.gitlab-ci.yml`, `scripts/ci-local.sh`, `pyproject.toml` | Reproduction locale de `pdm run check`, nettoyage artefacts Docker. |
| Documentation | `README.md`, `CHANGELOG.md`, `docs/automation-plan.md` | Cohérence des commandes, état réel des limitations et validations. |

## Checklist de validation avant review

| Niveau | Commande | Statut attendu | Remarques |
|---|---|---|---|
| Statique/Python/Node léger | `pdm run check` | Obligatoire avant push | Compile Python, `unittest`, puis `node --test tests/*.test.mjs`. |
| API E2E | `pdm run api-e2e --target en` | Optionnel pour cette branche | À lancer si le reviewer veut valider le vrai média, Whisper/Argos et les artefacts SRT. |
| Browser E2E strict | `pdm run browser-e2e --target en` | Optionnel pour cette branche | À réserver à une validation utilisateur/navigateur, car plus lente et dépendante de Chromium/Playwright. |
| CI GitLab | Pipeline de la branche poussée | Recommandé après push | Confirme l'image runner et le script `.gitlab-ci.yml`. |

## Risques et points d'attention

- Taille de la review : le changement mélange frontend client-side migration, fallback Python, tests Node et CI. Reviewer par zones plutôt qu'en lecture linéaire.
- Diff fonctionnel déjà présent dans `ec/backend` : cette branche ne doit pas masquer de dette par de nouvelles features.
- E2E strict non systématique : `pdm run check` valide les contrats unitaires/intégration légers, pas un parcours navigateur réel avec média complet.
- Dépendances runtime lourdes : Whisper/Argos/ffmpeg et modèles installés localement restent nécessaires pour l'E2E réel.
- Browser-side extraction : le chemin ffmpeg.wasm est borné pour les courtes vidéos et doit conserver le fallback Python pour les médias lourds.
- Artefacts générés : conserver les sorties E2E et téléchargements sous `~/.cache/xololingua/...` ou `$XOLOLINGUA_TMP_DIR`, pas dans le repo.

## Parcours recommandé pour la review humaine

1. Lire `README.md` sections architecture, migration client-side et tests pour comprendre le contrat produit.
2. Vérifier les adapters frontend isolés dans `frontend/` avec leurs tests `tests/*.test.mjs`.
3. Vérifier `app.js` uniquement après les adapters, car il orchestre les chemins déjà testés.
4. Vérifier `.gitlab-ci.yml` et `scripts/ci-local.sh` pour s'assurer que la validation distante correspond au check local.
5. Lancer ou consulter `pdm run check` sur la branche de review.
6. Décider séparément si l'API E2E ou le browser E2E strict est requis avant merge.

## Critères de readiness

La branche est prête pour review lorsque :

- `ec/backend-review-stabilization` est à jour avec `origin/ec/backend` sans merge local vers une autre cible ;
- la documentation de review existe et ne change pas le comportement produit ;
- `pdm run check` passe localement ;
- les fichiers modifiés par la stabilisation sont limités à la documentation/checklist ;
- le commit de stabilisation est poussé sur `origin/ec/backend-review-stabilization`.

# Extraction audio navigateur

Cette branche isole le travail sur l'extraction audio côté navigateur. Le flux utilisateur global et le router hybride restent hors périmètre sauf interface minimale nécessaire.

## Stratégies supportées

- **WebCodecs** : détection de capacité uniquement pour l'instant. L'extraction native n'est pas encore implémentée et doit échouer explicitement vers le fallback.
- **ffmpeg.wasm** : fallback navigateur explicite pour convertir une vidéo courte en WAV mono 16 kHz.
- **Fallback Python** : chemin recommandé dès qu'une limite navigateur est atteinte ou qu'une étape wasm échoue.

## Limites de sécurité navigateur

Les valeurs par défaut protègent la mémoire du navigateur et doivent rester visibles dans les erreurs utilisateur :

- durée maximale d'entrée : `60` secondes ;
- taille maximale d'entrée avant chargement wasm : `100 MiB` ;
- taille maximale revérifiée après `fetchFile`, avant écriture dans le FS wasm ;
- timeout de lecture des métadonnées vidéo : `10 s`.

Si le navigateur ne peut pas lire une durée finie, si la vidéo dépasse ces bornes, si `fetchFile` échoue, si le transcodage échoue ou si ffmpeg.wasm produit une sortie vide, l'erreur doit indiquer explicitement d'utiliser le fallback Python.

## Hygiène runtime/mémoire

- Toujours supprimer `input.mp4` et `output.wav` du FS wasm après une tentative.
- Quand `releaseAfterRun` est activé, appeler `terminate()` ou `exit()` même sur les erreurs de chargement, de taille post-chargement, d'écriture FS wasm, de transcodage ou de sortie vide.
- Ne pas écrire d'artefacts de test dans le repo ; utiliser un cache/temp hors repo si des fixtures réelles deviennent nécessaires.

## Validation attendue

- Tests unitaires frontend : `pdm run frontend_test`.
- Validation composite : `pdm run check`.
- `pdm run browser-e2e` uniquement si une itération touche le flux utilisateur réel et que l'environnement le permet.

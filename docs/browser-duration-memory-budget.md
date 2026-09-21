# Durée et mémoire du pipeline navigateur

La durée maximale de traitement **dans le navigateur** est de 3 600 secondes (1 heure) pour l'identification de la langue, l'extraction, la segmentation VAD, la transcription et la traduction. Le site public limite aussi **l'acceptation** des vidéos à 1 heure et des MP4 à 400 MiB. Tous les endpoints Python de traitement public répondent 403. En développement local, l'application et le service gardent une limite de 2 h 30 pour les tests sur les vidéos longues et les traitements Python de diagnostic.

## Chiffrage des données audio

L'extraction produit un WAV mono à 16 000 échantillons/s sur 16 bits. Pour une heure, cela représente `3 600 × 16 000 × 2 = 115 200 000` octets, soit **109,9 MiB** hors en-tête WAV. Une copie décodée en `Float32Array` prend `3 600 × 16 000 × 4 = 230 400 000` octets, soit **219,7 MiB**. Ces valeurs sont calculées à partir du format audio imposé par l'application ; elles ne sont pas des mesures de mémoire maximale du navigateur.

| Étape | Données audio/vidéo dont le code peut garder une copie | Ordre de grandeur pour 1 heure |
| --- | --- | ---: |
| Extraction ffmpeg.wasm | MP4 chargé par `fetchFile`, MP4 dans le FS wasm, WAV de sortie dans le FS, WAV lu par JS, `Blob` WAV | jusqu'à `2 × taille MP4 + 3 × 109,9 MiB` pour ces données ; **≈ 1,1 GiB** avec un MP4 de 400 MiB |
| VAD | `Blob` WAV, `ArrayBuffer` WAV envoyé au worker, PCM décodé en `Float32Array` | **≈ 440 MiB** pour ces trois représentations |
| Transcription | `Blob` WAV, `ArrayBuffer` WAV, `AudioBuffer` décodé, copie PCM JS, copie envoyée au worker | **≈ 879 MiB** pour ces représentations |
| Traduction | Texte et segments, traités par lots | dépend de la quantité de texte ; le modèle est la part dominante |

Les copies indiquées sont un **budget de représentation**, pas un pic mesuré : leur durée de vie et leur partage effectifs dépendent du navigateur, de ffmpeg.wasm et du ramasse-miettes. Les moteurs WASM, les modèles ASR/VAD/traduction, WebGPU, le décodage vidéo de l'aperçu et les autres onglets ajoutent de la mémoire. Aucune durée ne peut donc garantir qu'un appareil donné terminera localement ; sur le site public, une erreur de traitement affiche un diagnostic et une marche à suivre. Le repli Python reste disponible en développement local.

La vidéo de référence `Маша_и_МедведьТОП10.mp4` dure **4 258,3 s (70 min 58 s)** et pèse **231,8 MiB** d'après `ffprobe` et `stat` locaux. À débit moyen identique, une heure représenterait environ **196 MiB de MP4**, sous la borne de 400 MiB. Cette vidéo complète sera refusée par le site public ; elle reste utilisable en développement local, où les étapes dépassant une heure passent au service Python.

## Gardes appliquées

- Le MP4 destiné à ffmpeg.wasm est limité à **400 MiB**, y compris pour une vidéo de moins d'une heure. Cette borne limite à environ 800 MiB les deux représentations complètes de l'entrée dans le calcul ci-dessus ; une vidéo plus volumineuse est refusée sur le site public et peut utiliser le service Python en développement local.
- Le WAV remis au VAD ou à la transcription est limité à **250 MiB**. Une heure en mono 16 kHz occupe normalement 109,9 MiB ; la marge couvre un écart de format et évite de décoder un fichier anormalement gros.
- La transcription et la traduction acceptent jusqu'à **9 000 segments** côté navigateur. Ce plafond correspond à 3 600 secondes divisées par la durée minimale configurée de 0,4 seconde d'un segment VAD, pour ne pas imposer une limite de segments plus courte que la limite vidéo. Le temps de traitement peut malgré tout être long ; les erreurs et les limites mémoire du navigateur entraînent un diagnostic sur le site public et un repli Python en développement local.

Ces nombres servent à cadrer la politique actuelle. Pour valider une limite par appareil, il faudra mesurer le pic de mémoire du processus navigateur et la mémoire GPU sur un échantillon représentatif, avec et sans WebGPU.

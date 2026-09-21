# Détection de langue dans le navigateur

## Objectif

Déplacer l'identification automatique de la langue du service Python public vers le navigateur du visiteur. Comme les autres étapes du pipeline public, elle doit utiliser WebGPU lorsqu'il est disponible, puis le CPU local via WASM lorsque WebGPU est indisponible ou devient inutilisable.

À la fin de ce chantier, aucune vidéo ni donnée audio ne doit être envoyée au VPS public. La sélection manuelle de la langue reste disponible pour corriger un résultat ou continuer après un échec.

Branche proposée : `feat/browser-language-detection`.

## État de réalisation au 21 septembre 2026

Les jalons d'implémentation sont terminés sur `feat/browser-language-detection` : prédiction du premier token Whisper, échantillonnage et agrégation, worker WebGPU avec redémarrage WASM, intégration du parcours, réutilisation du WAV, fermeture de l'API publique et mise à jour du déploiement. Les tests automatisés couvrent ces contrats.

La validation sur matériel réel reste à effectuer avant le déploiement : vidéo russe de référence sur WebGPU, parcours WASM forcé, plusieurs langues, silence, faible confiance et mesure mémoire sur une vidéo proche d'une heure. Le benchmark comparant des fenêtres de 10, 15 et 30 secondes reste également ouvert ; la valeur de référence demeure 30 secondes.

## État initial

- Le bouton d'identification envoie le MP4 à `POST /api/detect-language`.
- Le service Python extrait dix fenêtres de 30 secondes réparties dans la vidéo.
- `faster-whisper` détecte la langue de chaque fenêtre, puis le service choisit la langue par nombre de votes et probabilité cumulée.
- L'extraction, la segmentation VAD, la transcription et la traduction s'exécutent déjà dans le navigateur sur le site public.
- Le worker de transcription charge déjà le modèle multilingue `Xenova/whisper-base` avec WebGPU et un repli d'initialisation vers WASM.

La version actuelle de Transformers.js n'expose pas encore directement la détection de langue Whisper. Son implémentation locale choisit l'anglais quand aucune langue n'est fournie. Le premier jalon doit donc valider une détection à bas niveau avant de modifier le parcours utilisateur.

Références techniques :

- [Transformers.js : exécution de Whisper avec WebGPU](https://huggingface.co/docs/transformers.js/guides/webgpu)
- [Suivi de la détection de langue Whisper dans Transformers.js](https://github.com/huggingface/transformers.js/issues/302)

## Architecture cible

```text
MP4 sélectionné
    |
    +-- extraction WAV 16 kHz mono dans le navigateur
    |       |
    |       +-- audio conservé pour la segmentation VAD
    |
    +-- décodage PCM et sélection de 10 fenêtres réparties
            |
            +-- worker Whisper : WebGPU
                    |
                    +-- nouveau worker Whisper : WASM CPU si échec GPU
                            |
                            +-- votes + confiance + langue proposée
```

L'extraction réalisée pendant l'identification doit alimenter `state.extractedAudio`. L'étape de segmentation réutilise ensuite cet audio et ne relance pas ffmpeg.wasm.

## Détection Whisper

Le prototype doit utiliser les composants internes déjà exposés par le pipeline ASR :

1. préparer les caractéristiques audio de chaque fenêtre avec le processeur Whisper ;
2. démarrer le décodeur avec le token `startoftranscript` uniquement ;
3. obtenir les scores du premier token prédit ;
4. limiter l'analyse aux tokens de langue déclarés dans `generation_config.lang_to_id` ;
5. appliquer un softmax sur ces scores et retourner la langue la plus probable ;
6. agréger les dix résultats par nombre de votes, puis par probabilité cumulée en cas d'égalité.

Le résultat client doit contenir au minimum :

```js
{
  languageCode: "ru",
  confidence: 0.94,
  votes: { ru: 9, uk: 1 },
  sampleCount: 10,
  executionDevice: "webgpu",
  executionDeviceLabel: "WebGPU (NVIDIA)"
}
```

Si l'accès fiable aux scores n'est pas possible avec la version installée, le jalon exploratoire doit comparer deux solutions avant de poursuivre : mettre à niveau Transformers.js vers une version qui expose cette opération, ou isoler une petite implémentation fondée sur les sessions Whisper existantes.

## Échantillonnage et mémoire

La politique de référence reste dix fenêtres réparties régulièrement. Le comportement Python actuel utilise 30 secondes par fenêtre, soit 300 secondes analysées au maximum.

Pour une heure d'audio à 16 kHz :

- le WAV PCM 16 bits représente environ 109,9 MiB ;
- sa représentation `Float32Array` représente environ 219,7 MiB ;
- dix fenêtres de 30 secondes en `Float32` représentent environ 18,3 MiB.

Le thread principal ne doit envoyer au worker que les fenêtres sélectionnées, avec transfert de leurs buffers lorsque c'est possible. Il ne doit pas dupliquer les 219,7 MiB du PCM complet dans le worker uniquement pour identifier la langue.

Un benchmark devra comparer 10, 15 et 30 secondes par fenêtre sur plusieurs langues. Une réduction de la durée ne pourra être retenue que si la précision reste acceptable, notamment sur la vidéo russe de référence et sur des vidéos contenant du silence ou plusieurs intervenants.

## Gestion du modèle et des moteurs

- Utiliser le même modèle `Xenova/whisper-base` quantifié que la transcription.
- Essayer WebGPU en premier.
- Si l'initialisation ou l'inférence WebGPU échoue, détruire le worker et les ressources GPU, puis recommencer dans un worker WASM propre.
- Libérer le modèle de la mémoire après l'identification.
- Conserver temporairement ses fichiers dans le cache de pipeline afin d'éviter un second téléchargement avant la transcription.
- Purger ce cache après la transcription, lors de l'abandon du pipeline ou lors du changement de vidéo.

Le repli WASM concerne le CPU de la machine du visiteur. Aucun repli vers le CPU du VPS ne doit être introduit sur le site public.

## Intégration dans l'application

### Modules

- Ajouter un client dédié, par exemple `frontend/client_language_detector.js`.
- Étendre `frontend/transcription_worker.js` avec les messages `detect-language` et `language-result`, ou créer un worker Whisper commun si cela clarifie son cycle de vie.
- Extraire la préparation PCM actuellement privée au transcripteur vers un utilitaire partagé.
- Ajouter l'identification aux capacités et aux rapports du pipeline afin d'afficher honnêtement son moteur.
- Précacher les nouveaux modules dans le service worker et incrémenter la version du shell PWA.

### Parcours utilisateur

La barre de progression de l'étape doit distinguer :

1. extraction audio ;
2. préparation des échantillons ;
3. téléchargement et initialisation de Whisper ;
4. analyse des échantillons ;
5. agrégation du résultat.

Les erreurs doivent donner une action concrète :

- mémoire insuffisante : fermer d'autres onglets ou choisir une vidéo plus courte ;
- modèle inaccessible : vérifier la connexion puis réessayer ;
- WebGPU défaillant et WASM indisponible : utiliser Chrome ou Chromium à jour ;
- confiance insuffisante : sélectionner manuellement la langue source ;
- annulation : conserver la possibilité de sélectionner la langue manuellement.

Le texte public devra indiquer que la vidéo reste sur l'appareil et que seuls les modèles sont téléchargés depuis leur hébergeur.

## API et déploiement

La fermeture du chemin serveur doit intervenir après la validation navigateur :

1. faire répondre `403` à `POST /api/detect-language` lorsque `XOLOLINGUA_PUBLIC_MODE=1` ;
2. conserver l'endpoint en développement local pour les tests et diagnostics ;
3. supprimer du mode public les limites, files et quotas devenus propres aux uploads vidéo ;
4. retirer l'appel public aux informations Whisper du VPS et afficher le moteur navigateur ;
5. réévaluer la nécessité du service Python public, de `/api/health` et du proxy `/api/*` ;
6. réduire la limite Caddy une fois que le site public n'accepte plus aucun média.

La bascule doit être atomique : le frontend public ne doit cesser d'appeler l'API qu'au même déploiement où la détection navigateur est prête et testée.

## Plan de réalisation

### 1. Jalon exploratoire Whisper

- Implémenter la prédiction du token de langue sur un extrait PCM court.
- Obtenir une probabilité par langue sur WebGPU et WASM.
- Comparer le résultat aux détections `faster-whisper` de référence.
- Mesurer le temps de chargement, le temps d'inférence et la mémoire.

Ce jalon constitue le point de décision technique. Le parcours de production ne doit pas être modifié avant sa réussite.

### 2. Détecteur client et agrégation

- Porter la génération des fenêtres de détection en JavaScript.
- Ajouter les votes, le départage par probabilité et un seuil de confiance.
- Ajouter les événements de progression et l'annulation.
- Ajouter la reprise complète dans un worker WASM après un échec WebGPU.

### 3. Intégration au parcours

- Déclencher l'extraction depuis l'étape d'identification.
- Réutiliser l'audio pour la segmentation.
- Afficher le moteur réellement utilisé et les diagnostics.
- Préserver la correction manuelle de la langue.

### 4. Fermeture du traitement VPS

- Interdire l'endpoint public de détection.
- Supprimer l'upload vidéo du parcours public.
- Mettre à jour Caddy, systemd, la documentation et les contrôles de déploiement.

### 5. Validation

- Exécuter les tests unitaires et la suite complète.
- Valider un parcours WebGPU réel et un parcours WASM forcé.
- Tester plusieurs langues, les égalités de votes, le silence et une faible confiance.
- Vérifier dans l'onglet Réseau qu'aucun média n'est envoyé à `/api/*`.
- Mesurer la mémoire avec une vidéo proche d'une heure et un MP4 proche de 400 MiB.

## Critères d'acceptation

- L'identification fonctionne sur WebGPU et sur WASM CPU.
- Un échec GPU en cours d'inférence provoque une reprise propre sur WASM.
- Les dix échantillons sont répartis sur toute la durée utile de la vidéo.
- L'audio extrait est réutilisé par la segmentation.
- La langue détectée peut toujours être corrigée manuellement.
- Le site public n'envoie aucun MP4, WAV ou PCM au VPS.
- Tous les endpoints Python de traitement répondent `403` en mode public.
- Les messages d'erreur indiquent la cause probable et une marche à suivre.
- Le modèle et les buffers sont libérés ou purgés conformément au cycle de vie documenté.
- Les tests automatisés et les validations WebGPU/WASM réelles passent avant le déploiement.

## Risques principaux

- L'API de détection n'est pas encore stabilisée dans Transformers.js.
- Dix passages encodeur peuvent être lents sur WASM CPU.
- Un passage WebGPU défaillant peut invalider le contexte et imposer un nouveau worker.
- L'extraction complète d'une vidéo proche des limites reste l'étape la plus coûteuse en mémoire.
- Certaines vidéos multilingues ou très silencieuses produiront une confiance faible ; la sélection manuelle reste donc indispensable.

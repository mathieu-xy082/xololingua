# Todo

## Product Scope

- Replace prototype language identification with a real audio-language detection adapter.
- Replace silence-based segmentation with model-backed speech segmentation over the extracted WAV audio.
- Replace prototype subtitle text with real transcription and translation.
- Decide whether processing runs locally, on a backend service, or through a third-party API.
- Keep the 2 h 30 min maximum-video-duration rule enforced before processing starts.

## First Supported Language Couples

- English to French.
- French to English.
- French to Russian.
- Russian to French.
- French to Ukrainian.
- Ukrainian to French.
- French to Chinese.
- Chinese to French.
- French to German.
- German to French.
- French to Spanish.
- Spanish to French.
- French to Hindi.
- Hindi to French.
- French to Japanese.
- Japanese to French.

## Required UI Unit Tests

- MP4 files can be selected through the file input.
- MP4 files can be provided through drag and drop.
- Non-MP4 files are rejected.
- Videos longer than 2 h 30 min are rejected before language identification.
- `Identify language` is disabled until a valid MP4 and duration are available.
- Target-language selection is disabled until the source language is identified.
- The detected source language cannot be selected as the target language.
- Targets outside the first supported language-pair scope are disabled.
- `Audio segmentation` is disabled until a supported source-target couple is selected.
- The segmentation progress bar updates during segmentation.
- `Generate subtitles` is disabled until segmentation finishes.
- The subtitle progress bar updates during SRT generation.
- The generated SRT download link uses the shortened video filename and target-language suffix.

## Required Functional Tests

- English to French subtitle generation.
- French to English subtitle generation.
- French to Russian subtitle generation.
- Russian to French subtitle generation.
- French to Ukrainian subtitle generation.
- Ukrainian to French subtitle generation.
- French to Chinese subtitle generation.
- Chinese to French subtitle generation.
- French to German subtitle generation.
- German to French subtitle generation.
- French to Spanish subtitle generation.
- Spanish to French subtitle generation.
- French to Hindi subtitle generation.
- Hindi to French subtitle generation.
- French to Japanese subtitle generation.
- Japanese to French subtitle generation.

## Test Infrastructure

- Add a browser test runner for UI behavior.
- Add deterministic MP4 fixtures for short-video workflow tests.
- Add adapter contract tests for language identification, segmentation, transcription, translation, and SRT formatting.
- Add frontend tests for successful local-service audio extraction and local-service fallback.
- Add functional tests for silence-based segment boundaries on representative speech samples.
- Add CI checks for syntax, unit tests, functional tests, and PWA asset availability.

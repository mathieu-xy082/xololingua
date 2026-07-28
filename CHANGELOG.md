# Changelog

All notable changes to XoloLingua will be documented in this file.

This project follows Semantic Versioning.

## Unreleased

No changes yet.

## 1.0.0 - 2026-07-28

### Added

- Added a local service endpoint to list subtitle jobs for diagnosis.
- Added sampled Whisper-based language detection for uploaded MP4 videos through the local service.
- Created the initial installable PWA shell for Ubuntu and Android browsers.
- Added MP4 drag-and-drop and device file browsing.
- Added video metadata preview and 2 h 30 min maximum-duration validation.
- Added a gated workflow for language identification, target selection, audio segmentation, and SRT generation.
- Added progress bars for audio segmentation and subtitle generation.
- Added downloadable `.srt` output with 20-character base filename shortening and target-language suffixes.
- Added a local Ubuntu development service that extracts MP4 audio to mono 16 kHz WAV with `ffmpeg`.
- Added first-pass audio segmentation through `ffmpeg` silence detection over the extracted WAV.
- Added frontend audio extraction and service-backed segmentation, with fallback if the local service is not running.
- Added a read-only segmentation review with summary metrics and optional segment details.
- Added a local transcription endpoint backed by a configurable Whisper-compatible CLI.
- Added frontend transcription before SRT generation, with a setup error when no transcription engine is installed.
- Documented `pipx` installation for OpenAI Whisper and defaulted transcription to CPU execution.
- Validated real Whisper transcription on a short segment from `lisoir_dnde442.mp4`.
- Added a local translation endpoint backed by the Argos Translate CLI.
- Added frontend translation after transcription and before SRT generation.
- Installed and validated Argos French to English and English to French language packages.
- Added asynchronous subtitle generation jobs with frontend polling.
- Added bounded parallel segment translation while preserving output order.
- Added a local service test for WAV extraction format.
- Added a local service test for silence-based segmentation.
- Added local service tests for transcription segment validation and text attachment.
- Added local service tests for translation segment validation and translated text attachment.
- Added local service tests for asynchronous job completion and ordered parallel translation.
- Added the first supported language-pair scope:
  - English to French and French to English.
  - French to Russian and Russian to French.
  - French to Ukrainian and Ukrainian to French.
  - French to Chinese and Chinese to French.
  - French to German and German to French.
  - French to Spanish and Spanish to French.
  - French to Hindi and Hindi to French.
  - French to Japanese and Japanese to French.
- Added demo-ready client pipeline summaries that name browser stages and Python fallback stages.
- Added Python fallback endpoint names to client pipeline demo summaries.
- Added ordered client pipeline demo rows for presenting each stage's browser or Python fallback runtime.
- Added frontend backend-client coverage for malformed audio extraction and segmentation fallback responses.
- Added hybrid client pipeline routing for browser or Python fallback VAD segmentation.
- Added hybrid client pipeline routing for browser or Python fallback transcription.
- Normalized hybrid router fallback endpoint metadata for all client pipeline stages.
- Added a tested client-side SRT formatter module and service-worker precache coverage for frontend modules.
- Added a browser ffmpeg.wasm input-size guard before WASM loading to keep demo extraction memory bounded.

### Changed

- Batched Argos segment translation to reduce subprocess churn during subtitle generation.
- Changed the default GPU Whisper model from `base` to `small`.
- Switched subtitle translation to prefer the in-process Argos Python API and keep translators cached in memory.
- Split the local service implementation into focused Python modules while keeping `python3 local_service.py` as the stable entrypoint.
- Replaced filename-based language guessing with five evenly spaced one-minute detection samples tallied by vote.
- Limited target-language activation to the first supported language-pair scope while keeping the broader language list visible.

### Known Limitations

- Speech segmentation is silence-based and does not yet use a speech-aware model.
- Real speech recognition requires the configured Whisper-compatible CLI available on the local service host.
- Translation currently requires installed Argos language packages for each source-target pair.

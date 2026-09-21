# Changelog

All notable changes to XoloLingua will be documented in this file.

This project follows Semantic Versioning.

## [Unreleased]

### Added

- Added browser language identification with `Xenova/whisper-base`, ten evenly distributed audio samples, language-token probabilities, vote aggregation, and confidence reporting.
- Added a clean WebGPU-to-WASM recovery path that destroys the failed inference worker and retries on the visitor's local CPU.
- Added browser language-identification progress, actionable failure guidance, retained model caching until transcription, and cache cleanup when a video is abandoned.

### Changed

- Extracted audio during language identification and reused the resulting WAV for VAD segmentation.
- Updated the public capability report, processing status, privacy notice, PWA cache, deployment guide, and memory documentation for the complete browser media pipeline.
- Reduced the public Caddy API request-body limit from 421 MB to 3 MB now that no public endpoint accepts media.

### Security

- Disabled `POST /api/detect-language` with HTTP 403 in public mode and removed the obsolete public upload concurrency, rate, and temporary-media quota machinery.
- Removed every public MP4, WAV, and PCM upload path; local development retains the Python detection endpoint for diagnostics.

## [1.3.0] - 2026-09-21 - Merge branche 'feat/public-deployment' into main
### Added

- Added a production deployment profile for Ubuntu 24.04 with Caddy, systemd, a curated static web build, same-origin HTTPS API routing, and operational documentation.
- Added gated GitHub Actions deployments through a restricted SSH account, exact tested-commit verification, versioned release links, health checks, rollback, and retention of the active and previous releases.
- Added service protections for concurrent public processing, per-IP hourly requests, request and work-directory sizes, stale-media cleanup, and bounded in-memory job history.
- Added a shared one-hour browser resource policy with documented memory budgets for audio extraction, VAD, transcription, and translation.
- Added actionable browser-stage failure messages and a development plan for moving language identification to WebGPU with local WASM CPU fallback.

### Changed

- Changed hosted API resolution to use the site's HTTPS origin while preserving `127.0.0.1:8765` for local development.
- Limited public videos to one hour and 400 MiB, while retaining the 2 h 30 min duration limit for local development and long-video tests.
- Harmonized browser extraction, segmentation, transcription, and translation at a one-hour media limit, with 250 MiB extracted-audio and 9,000-segment guards.
- Restricted the public Python service to language identification; extraction, segmentation, transcription, translation, and SRT creation now run in the visitor's browser.
- Kept Python processing fallbacks available in local development and replaced public fallback attempts with clear recovery guidance.
- Updated the PWA capability panel, upload notice, cache version, deployment guide, and browser memory documentation for the public processing policy.

### Security

- Bound the Python API to loopback behind Caddy and disabled cross-origin response headers in public mode while retaining local development CORS.
- Disabled public Python fallback endpoints with HTTP 403 before their request bodies are processed.
- Added a dedicated deployment key, pinned SSH host-key verification, a forced SSH command, restricted sudo rules, and branch-gated production approvals.
- Prevented the public web server from exposing the repository checkout by deploying only an allowlisted static artifact.

## [1.2.0] - 2026-09-20 - Merge branche 'ec/optim-asr' into main 
### Added

- Added a reproducible WebGPU ASR dtype benchmark for `fp16`, `q4f16`, and `q4`, including quality similarity, timing, cache-purge, and adapter diagnostics.
- Added a logged CUDA warmup with NVIDIA wake-up and retried Whisper validation before selecting the CPU fallback.
- Added an explicit log confirming that the faster-whisper mini inference completed successfully on CUDA.
- Added device-aware ASR scheduling: sequential WebGPU inference and adaptive 4/2/1 batching for WASM CPU.
- Added timestamp-preserving Whisper WebGPU decoding over overlapping 30-second windows, official overlap decoding, VAD timestamp realignment, and an automated 1/2/4 internal-batch capability benchmark.
- Added a source-language selector so users can correct automatic language identification before generating subtitles.

### Changed

- Increased language identification from five to ten evenly spaced 30-second samples across long videos.
- Switched Whisper language identification to its dedicated detection API, avoiding unnecessary GPU transcript decoding and recording the sample number when detection fails.

### Fixed

- Changed browser-worker inference limits from absolute deadlines to inactivity timeouts refreshed by progress, preventing healthy long-form WebGPU transcription from being discarded after five minutes.
- Allocated fixed five-percent model-preparation budgets per translation hop and kept the remaining progress monotonic across direct and English-pivot inference.
- Released Whisper input tensors, token timestamps, attention tensors, and KV caches after every long-form WebGPU window to prevent accumulated GPU resources from invalidating the browser compute context.
- Made bounded pivot translation hops explicit in progress and diagnostics, including both model identifiers and aggregate timing/cache-purge metadata.
- Invalidated the PWA cache after device-aware ASR worker changes so browsers load the current GPU/CPU scheduling logic.
- Updated `pdm run web` to launch the default Chromium-family browser with Vulkan/WebGPU flags in a dedicated XoloLingua profile.
- Added CPU retry handling when CUDA becomes unavailable during language detection after a successful startup probe.
- Kept production WebGPU decoding at the validated batch size of 1 because the current Whisper ONNX/WebGPU sessions invalidate the GPU context at batch sizes 2 and 4.
- Routed server-only extracted audio directly to Python VAD, preventing browser segmentation errors on long videos that use Python audio extraction.
- Applied GPU-to-CPU transcription retry to both direct transcription and subtitle jobs, with concise errors if the CPU retry also fails.

## 1.1.0 - 2026-08-16

### Added

- Added on-demand browser model resolution for transcription and source-to-target OPUS-MT translation.
- Added bounded English-pivot translation routes when no direct browser model exists, preserving segment timing and indices.
- Added browser translation routes for English to Hindi, Arabic, and Ukrainian targets.
- Added automatic remote Transformers.js model downloads with visible pipeline progress and Python fallback on unavailable pairs.
- Added per-pipeline model disposal and targeted browser-cache purge after transcription and translation.
- Added `no-store` remote model fetches so purged weights are not retained by the browser HTTP cache.

### Changed

- Changed target-language availability to use browser translation routes instead of requiring the Python translation-pair endpoint, so the PWA remains usable without Python installed.
- Updated the target-language status message to explain when no direct or bounded browser route is available.
- Detached the PWA runtime and service worker from the legacy static model manifests and bootstrap cache.
- Replaced packaged-model metadata in the runtime graph with lightweight dynamic browser ML limits and timeouts.
- Removed the legacy packaged-model manifests, snapshot preparation command, and manual bootstrap implementation after a real French-to-Russian browser E2E validated on-demand delivery and post-pipeline purge.

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

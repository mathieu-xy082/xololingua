# XoloLingua

XoloLingua is an installable Progressive Web App for preparing translated `.srt` subtitles from MP4 videos. It runs in a browser on Ubuntu and Android and can be installed from Chrome or Chromium as a standalone app.

The current implementation provides the browser workflow, MP4 validation, 2 h 30 min duration validation, target language selection, progress tracking, subtitle filename handling, and valid SRT file generation. The language identification, speech segmentation, and translation functions are adapter functions in `app.js`; they currently run in local prototype mode and are ready to be replaced by a real speech/translation backend.

## Run Locally

Install PDM if it is not already available:

```bash
pipx install pdm
```

Then install the project dependencies from this directory:

```bash
pdm install
```

Start the browser app:

```bash
pdm run web
```

Then open:

```text
http://localhost:4173
```

For audio extraction and first-pass silence-based segmentation, start the local processing service in a second terminal:

```bash
pdm run service
```

The service listens on:

```text
http://127.0.0.1:8765
```

It requires `ffmpeg` and `ffprobe`, which are available from the Ubuntu package `ffmpeg`. Extracted audio is normalized to mono 16 kHz PCM WAV under `/tmp/xololingua`, then segmented from detected silence boundaries.

Transcription uses `faster-whisper` from the PDM environment. The service probes CUDA at startup, defaults to the `base` model on GPU, and keeps a CPU `base/int8` fallback. You can override the selected runtime:

```bash
XOLOLINGUA_WHISPER_DEVICE=cpu pdm run service
XOLOLINGUA_WHISPER_GPU_MODEL=medium pdm run service
XOLOLINGUA_WHISPER_GPU_COMPUTE_TYPE=int8_float16 pdm run service
```

If the PDM-managed transcription dependencies are unavailable, subtitle generation stops with a setup error instead of generating fake text.

Translation uses Argos Translate through the `argos-translate` CLI installed in the PDM environment. Install the language-pair packages needed by the MVP:

```bash
pdm run argospm update
pdm run argospm install translate-fr_en
pdm run argospm install translate-en_fr
```

Subtitle generation runs as an asynchronous local-service job. The browser starts a job, polls `/api/subtitle-jobs/<job-id>`, and stays responsive while the service transcribes and translates segments in the background. Whisper is kept sequential inside each job to avoid heavy concurrent model processes; translation can use a small bounded worker pool because segment translation is independent. Override the translation worker count with:

```bash
XOLOLINGUA_TRANSLATION_WORKERS=2 pdm run service
```

Run the local service tests with:

```bash
pdm run test
```

On Android, connect the phone to the same network as the Ubuntu machine and open:

```text
http://<ubuntu-machine-ip>:4173
```

That is enough to run the app in the Android browser. To install it as a PWA, Chrome needs a secure context. Use one of these options:

- Host it through HTTPS.
- Connect the phone over USB and forward the port with `adb reverse tcp:4173 tcp:4173`, then open `http://localhost:4173` on the phone.
- Use `localhost` directly on Ubuntu.

## Files

- `CHANGELOG.md` tracks unreleased and future version changes.
- `TODO.md` tracks implementation and test work.
- `index.html` contains the video workflow.
- `styles.css` contains the responsive layout and visual design.
- `app.js` contains file validation, language selection, processing state, subtitle filename handling, and SRT generation.
- `local_service.py` contains the local MP4 audio extraction, segmentation, and transcription service for Ubuntu development.
- `tests/` contains local service tests.
- `manifest.webmanifest` and `sw.js` make the app installable and cacheable.

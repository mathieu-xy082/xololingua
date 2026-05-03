# XoloLingua

XoloLingua is an installable Progressive Web App for preparing translated `.srt` subtitles from MP4 videos. It runs in a browser on Ubuntu and Android and can be installed from Chrome or Chromium as a standalone app.

The current implementation provides the browser workflow, MP4 validation, 2 h 30 min duration validation, target language selection, progress tracking, subtitle filename handling, and valid SRT file generation. The language identification, speech segmentation, and translation functions are adapter functions in `app.js`; they currently run in local prototype mode and are ready to be replaced by a real speech/translation backend.

## Run Locally

From this repository, start the browser app:

```bash
python3 -m http.server 4173
```

Then open:

```text
http://localhost:4173
```

For audio extraction and first-pass silence-based segmentation, start the local processing service in a second terminal:

```bash
python3 local_service.py
```

The service listens on:

```text
http://127.0.0.1:8765
```

It requires `ffmpeg` and `ffprobe`, which are available from the Ubuntu package `ffmpeg`. Extracted audio is normalized to mono 16 kHz PCM WAV under `/tmp/xololingua`, then segmented from detected silence boundaries.

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
- `local_service.py` contains the local MP4 audio extraction service for Ubuntu development.
- `tests/` contains local service tests.
- `manifest.webmanifest` and `sw.js` make the app installable and cacheable.

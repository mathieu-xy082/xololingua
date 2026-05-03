# Changelog

All notable changes to XoloLingua will be documented in this file.

The project has not published a first version yet.

## Unreleased

### Added

- Created the initial installable PWA shell for Ubuntu and Android browsers.
- Added MP4 drag-and-drop and device file browsing.
- Added video metadata preview and 2 h 30 min maximum-duration validation.
- Added a gated workflow for language identification, target selection, audio segmentation, and SRT generation.
- Added progress bars for audio segmentation and subtitle generation.
- Added downloadable `.srt` output with 20-character base filename shortening and target-language suffixes.
- Added the first supported language-pair scope:
  - English to French and French to English.
  - French to Russian and Russian to French.
  - French to Ukrainian and Ukrainian to French.
  - French to Chinese and Chinese to French.
  - French to German and German to French.
  - French to Spanish and Spanish to French.
  - French to Hindi and Hindi to French.
  - French to Japanese and Japanese to French.

### Changed

- Limited target-language activation to the first supported language-pair scope while keeping the broader language list visible.

### Known Limitations

- Language identification, speech segmentation, and translation currently use local prototype adapters in `app.js`.
- Real speech recognition and translation still require a backend or local model integration.

# Missing target-language backlog

This file tracks destination languages that are present in XoloLingua's target-language catalogue but are not yet validated for the current local workflow.

Update rule: when a language is added and the end-to-end video workflow succeeds, remove that language from the `Missing target languages` table and record the validation in the relevant changelog or test notes.

## Current assumptions

- The reference end-to-end fixture is `/root/android-app-games/resources/lisoir_dnde442.mp4`.
- The reference video is detected as French (`fr`).
- The only currently installed and validated Argos packages are:
  - `translate-fr_en`
  - `translate-en_fr`
- English (`en`) is treated as the current internal pivot language for expanding French source subtitles to additional targets.
- For a French source video and an English pivot, adding target `<code>` generally requires validating at least:
  - French speech-to-text
  - French to English translation (`fr -> en`)
  - English to target translation (`en -> <code>`)
  - generated SRT download from the browser workflow

## Prepared package validations

These languages are still in the missing-language table until the full browser video workflow generates and verifies a `.srt`, but their Argos package discovery/install and French-to-target pivot-pair exposure have been checked locally.

| Date | Codes | Expected pivot packages | Local validation |
| --- | --- | --- | --- |
| 2026-06-29 | ru, uk, zh, de | `translate-en_ru`, `translate-en_uk`, `translate-en_zh`, `translate-en_de` | `argospm search` found all four packages; `argospm install` completed for all four; `translation.get_supported_pairs()` exposes `fr -> ru`, `fr -> uk`, `fr -> zh`, and `fr -> de` via the English pivot. |
| 2026-06-29 | es, hi, ja, ar | `translate-en_es`, `translate-en_hi`, `translate-en_ja`, `translate-en_ar` | `argospm search` found all four packages; `argospm install` completed for all four; `translation.get_supported_pairs()` exposes `fr -> es`, `fr -> hi`, `fr -> ja`, and `fr -> ar` via the English pivot. Full browser video `.srt` validation is still pending before removal from the missing-language table. |

## Already available for the reference French video

| Code | Language | Notes |
| --- | --- | --- |
| en | English | Installed and validated as the first French target. |

## Missing target languages

| Priority | Code | Language | Expected pivot package | Notes |
| --- | --- | --- | --- | --- |
| 1 | ru | Russian | `translate-en_ru` | Listed in `TODO.md` first supported language couples. |
| 2 | uk | Ukrainian | `translate-en_uk` | Listed in `TODO.md` first supported language couples. |
| 3 | zh | Chinese | `translate-en_zh` | Listed in `TODO.md` first supported language couples. |
| 4 | de | German | `translate-en_de` | Listed in `TODO.md` first supported language couples. |
| 5 | es | Spanish | `translate-en_es` | Listed in `TODO.md` first supported language couples. |
| 6 | hi | Hindi | `translate-en_hi` | Listed in `TODO.md` first supported language couples. |
| 7 | ja | Japanese | `translate-en_ja` | Listed in `TODO.md` first supported language couples. |
| 8 | ar | Arabic | `translate-en_ar` | Present in the UI language catalogue; not in first MVP couples yet. |
| 9 | bn | Bengali | `translate-en_bn` | Present in the UI language catalogue; not in first MVP couples yet. |
| 10 | pt | Portuguese | `translate-en_pt` | Present in the UI language catalogue; not in first MVP couples yet. |
| 11 | ur | Urdu | `translate-en_ur` | Present in the UI language catalogue; not in first MVP couples yet. |
| 12 | id | Indonesian | `translate-en_id` | Present in the UI language catalogue; not in first MVP couples yet. |
| 13 | sw | Swahili | `translate-en_sw` | Present in the UI language catalogue; not in first MVP couples yet. |
| 14 | mr | Marathi | `translate-en_mr` | Present in the UI language catalogue; not in first MVP couples yet. |
| 15 | te | Telugu | `translate-en_te` | Present in the UI language catalogue; not in first MVP couples yet. |
| 16 | tr | Turkish | `translate-en_tr` | Present in the UI language catalogue; not in first MVP couples yet. |
| 17 | ta | Tamil | `translate-en_ta` | Present in the UI language catalogue; not in first MVP couples yet. |
| 18 | it | Italian | `translate-en_it` | Present in the UI language catalogue; not in first MVP couples yet. |

## Validation checklist for each language

For each target language, keep the change small and repeatable:

1. Confirm the Argos package name exists and can be installed.
2. Install the package locally with `pdm run argospm install <package>`.
3. Run `pdm run test`.
4. Start the backend with `pdm run service`.
5. Start the frontend with `pdm run web`.
6. Load `/root/android-app-games/resources/lisoir_dnde442.mp4` through the browser workflow.
7. Identify source language and confirm French.
8. Select the new target language.
9. Run audio segmentation.
10. Generate subtitles and confirm the `.srt` download link appears.
11. Save any issue discovered as a focused follow-up task.
12. Remove the validated language from this file.

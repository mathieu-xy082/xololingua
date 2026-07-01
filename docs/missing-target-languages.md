# Missing target-language backlog

This file tracks destination languages that are present in XoloLingua's target-language catalogue but are not yet validated for the current local workflow.

Update rule: when a language is added and a real end-to-end video workflow generates and verifies a non-empty `.srt`, remove that language from the `Missing target languages` table and record the validation in the relevant changelog or test notes. Keep API E2E and strict browser-download validations distinct when reporting progress.

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
| 2026-06-29 | bn, pt, ur, id | `translate-en_bn`, `translate-en_pt`, `translate-en_ur`, `translate-en_id` | Argos package index exposes all four packages; local install completed for all four with `AvailablePackage.install()`; installed direct pairs expose `en -> bn`, `en -> pt`, `en -> ur`, and `en -> id`, and the English-pivot composition exposes `fr -> bn`, `fr -> pt`, `fr -> ur`, and `fr -> id`. Full browser video `.srt` validation is still pending before removal from the missing-language table. |
| 2026-06-30 | sw, tr, it | `translate-en_sw`, `translate-en_tr`, `translate-en_it` | Argos package index exposes all three packages; local install completed for all three with `AvailablePackage.install()`; installed direct pairs expose `en -> sw`, `en -> tr`, and `en -> it`, and the English-pivot composition exposes `fr -> sw`, `fr -> tr`, and `fr -> it`. Full browser video `.srt` validation is still pending before removal from the missing-language table. |

## API E2E video validations

These validations run the real local HTTP API against `/root/android-app-games/resources/lisoir_dnde442.mp4`: language detection, audio extraction, segmentation, subtitle job creation/polling, and verified SRT artifact generation. They are stronger than translator smoke tests but are reported separately from the strict browser-download gate.

| Date | Code | Command | Artifact | Result |
| --- | --- | --- | --- | --- |
| 2026-07-01 | en | `pdm run api-e2e --target en` | `tmp/e2e-validations/lisoir_dnde442.fr-en.srt` (17,904 bytes) | Passed: detected French source, generated non-empty SRT with timestamp arrows through the API subtitle-job workflow. |
| 2026-07-01 | ru | `pdm run api-e2e --target ru` | `tmp/e2e-validations/lisoir_dnde442.fr-ru.srt` (29,552 bytes) | Passed: detected French source, generated non-empty SRT with timestamp arrows through the API subtitle-job workflow. |
| 2026-07-01 | uk | `pdm run api-e2e --target uk` | `tmp/e2e-validations/lisoir_dnde442.fr-uk.srt` (27,406 bytes) | Passed: detected French source, generated 88 SRT blocks with timestamp arrows through the API subtitle-job workflow. |

## Translator smoke validations

These checks prove that the installed package chain can do a real French-to-target text translation through the English pivot. They are stronger than pair discovery, but they still do not replace the required browser video `.srt` workflow.

| Date | Codes | Expected pivot packages | Local validation |
| --- | --- | --- | --- |
| 2026-06-30 | ru, uk, zh, de | `translate-en_ru`, `translate-en_uk`, `translate-en_zh`, `translate-en_de` | `argostranslate.package.update_package_index()` found all four packages; installed direct pairs expose `en -> ru`, `en -> uk`, `en -> zh`, and `en -> de`; English-pivot composition exposes `fr -> ru`, `fr -> uk`, `fr -> zh`, and `fr -> de`; `translation.translate_text("Bonjour tout le monde.", "fr", <code>)` returned non-empty translated text for all four targets. Full browser video `.srt` validation is still pending before removal from the missing-language table. |
| 2026-06-30 | es, hi, ja, ar | `translate-en_es`, `translate-en_hi`, `translate-en_ja`, `translate-en_ar` | `argostranslate.package.update_package_index()` found all four packages; local installs were already present; installed direct pairs expose `en -> es`, `en -> hi`, `en -> ja`, and `en -> ar`; English-pivot composition exposes `fr -> es`, `fr -> hi`, `fr -> ja`, and `fr -> ar`; `translation.translate_text("Bonjour tout le monde.", "fr", <code>)` returned non-empty translated text for all four targets. Full browser video `.srt` validation is still pending before removal from the missing-language table. |
| 2026-07-01 | bn, pt, ur, id | `translate-en_bn`, `translate-en_pt`, `translate-en_ur`, `translate-en_id` | `argostranslate.package.update_package_index()` found all four packages; local installs completed successfully; installed direct pairs expose `en -> bn`, `en -> pt`, `en -> ur`, and `en -> id`; English-pivot composition exposes `fr -> bn`, `fr -> pt`, `fr -> ur`, and `fr -> id`; `translation.translate_text("Bonjour tout le monde.", "fr", <code>)` returned non-empty translated text for all four targets. Full browser video `.srt` validation is still pending before removal from the missing-language table. |
| 2026-07-01 | sw, tr, it | `translate-en_sw`, `translate-en_tr`, `translate-en_it` | `argostranslate.package.update_package_index()` found all three packages; local installs were already present; installed direct pairs expose `en -> sw`, `en -> tr`, and `en -> it`; English-pivot composition exposes `fr -> sw`, `fr -> tr`, and `fr -> it`; `translation.translate_text("Bonjour tout le monde.", "fr", <code>)` returned non-empty translated text for all three targets. Full browser video `.srt` validation is still pending before removal from the missing-language table. |

## Latest priority-batch probe

This table records the most recent backlog slice checked by the scheduled language-validation job. It does not remove languages from the missing-language table; only a real video workflow can do that after a verified `.srt` is generated. Record whether the proof came from the API E2E workflow or the stricter browser-download workflow.

| Date | Codes | Expected pivot packages | Local validation |
| --- | --- | --- | --- |
| 2026-07-01 | sw, mr, te, tr, ta, it | `translate-en_sw`, `translate-en_mr`, `translate-en_te`, `translate-en_tr`, `translate-en_ta`, `translate-en_it` | `argostranslate.package.update_package_index()` completed. The package index exposes `translate-en_sw`, `translate-en_tr`, and `translate-en_it`; those packages are installed locally and `translation.get_supported_pairs()` exposes direct pairs `en -> sw`, `en -> tr`, and `en -> it`, plus English-pivot composition for `fr -> sw`, `fr -> tr`, and `fr -> it`. A translator smoke check returned non-empty French-to-target text for `sw`, `tr`, and `it`. The same package-index probe still does not expose `translate-en_mr`, `translate-en_te`, or `translate-en_ta`, so `fr -> mr`, `fr -> te`, and `fr -> ta` remain blocked locally. Full browser video `.srt` validation is still pending before removal from the missing-language table. |

## Package-index blockers

These languages remain in priority order, but the current Argos package index does not expose the expected English-pivot package yet.

| Date | Codes | Expected pivot packages | Local validation |
| --- | --- | --- | --- |
| 2026-06-30 | mr, te, ta | `translate-en_mr`, `translate-en_te`, `translate-en_ta` | `argospm update` completed, but neither `argospm search` nor `package.get_available_packages()` found English-to-target packages for these codes. `translation.get_supported_pairs()` therefore does not expose `fr -> mr`, `fr -> te`, or `fr -> ta` locally yet. |

## Already available for the reference French video

| Code | Language | Notes |
| --- | --- | --- |
| en | English | Installed and validated as the first French target. |
| ru | Russian | API E2E generated and verified `tmp/e2e-validations/lisoir_dnde442.fr-ru.srt`; strict browser-download validation still pending. |
| uk | Ukrainian | API E2E generated and verified `tmp/e2e-validations/lisoir_dnde442.fr-uk.srt`; strict browser-download validation still pending. |

## Missing target languages

| Priority | Code | Language | Expected pivot package | Notes |
| --- | --- | --- | --- | --- |
| 1 | zh | Chinese | `translate-en_zh` | Listed in `TODO.md` first supported language couples. |
| 2 | de | German | `translate-en_de` | Listed in `TODO.md` first supported language couples. |
| 3 | es | Spanish | `translate-en_es` | Listed in `TODO.md` first supported language couples. |
| 4 | hi | Hindi | `translate-en_hi` | Listed in `TODO.md` first supported language couples. |
| 5 | ja | Japanese | `translate-en_ja` | Listed in `TODO.md` first supported language couples. |
| 6 | ar | Arabic | `translate-en_ar` | Present in the UI language catalogue; not in first MVP couples yet. |
| 7 | bn | Bengali | `translate-en_bn` | Present in the UI language catalogue; not in first MVP couples yet. |
| 8 | pt | Portuguese | `translate-en_pt` | Present in the UI language catalogue; not in first MVP couples yet. |
| 9 | ur | Urdu | `translate-en_ur` | Present in the UI language catalogue; not in first MVP couples yet. |
| 10 | id | Indonesian | `translate-en_id` | Present in the UI language catalogue; not in first MVP couples yet. |
| 11 | sw | Swahili | `translate-en_sw` | Present in the UI language catalogue; not in first MVP couples yet. |
| 12 | mr | Marathi | `translate-en_mr` | Present in the UI language catalogue; not in first MVP couples yet. |
| 13 | te | Telugu | `translate-en_te` | Present in the UI language catalogue; not in first MVP couples yet. |
| 14 | tr | Turkish | `translate-en_tr` | Present in the UI language catalogue; not in first MVP couples yet. |
| 15 | ta | Tamil | `translate-en_ta` | Present in the UI language catalogue; not in first MVP couples yet. |
| 16 | it | Italian | `translate-en_it` | Present in the UI language catalogue; not in first MVP couples yet. |

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

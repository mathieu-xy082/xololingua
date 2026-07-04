# Missing target-language backlog

This file tracks destination languages that are present in XoloLingua's target-language catalogue but are not yet validated for the current local workflow.

Update rule: when a language is added and the API E2E server workflow on a real video generates and verifies a non-empty `.srt`, remove that language from the `Missing target languages` table and record the validation in the relevant changelog or test notes. Browser-download validation remains a representative reassurance gate for the user workflow, but it is not required for every language before stabilizing this branch.

## Current assumptions

- The reference end-to-end fixture is `/root/android-app-games/resources/lisoir_dnde442.mp4`.
- New API E2E artifacts default to `~/.cache/xololingua/e2e-validations/`; override with `XOLOLINGUA_API_E2E_OUTPUT_DIR` when a run needs an explicit artifact location.
- New browser E2E downloads default to `~/.cache/xololingua/browser-e2e-downloads/`; override with `XOLOLINGUA_BROWSER_E2E_DOWNLOAD_DIR` when a run needs an explicit download location.
- The reference video is detected as French (`fr`).
- The only currently installed and validated Argos packages are:
  - `translate-fr_en`
  - `translate-en_fr`
- English (`en`) is treated as the current internal pivot language for expanding French source subtitles to additional targets.
- For a French source video and an English pivot, adding target `<code>` generally requires validating at least:
  - French speech-to-text
  - French to English translation (`fr -> en`)
  - English to target translation (`en -> <code>`)
  - generated SRT through the API E2E server workflow
  - representative browser workflow/download checks for a smaller high-traffic sample

## Prepared package validations

These languages are still in the missing-language table until the full browser video workflow generates and verifies a `.srt`, but their Argos package discovery/install and French-to-target pivot-pair exposure have been checked locally.

| Date | Codes | Expected pivot packages | Local validation |
| --- | --- | --- | --- |
| 2026-06-29 | ru, uk, zh, de | `translate-en_ru`, `translate-en_uk`, `translate-en_zh`, `translate-en_de` | `argospm search` found all four packages; `argospm install` completed for all four; `translation.get_supported_pairs()` exposes `fr -> ru`, `fr -> uk`, `fr -> zh`, and `fr -> de` via the English pivot. |
| 2026-06-29 | es, hi, ja, ar | `translate-en_es`, `translate-en_hi`, `translate-en_ja`, `translate-en_ar` | `argospm search` found all four packages; `argospm install` completed for all four; `translation.get_supported_pairs()` exposes `fr -> es`, `fr -> hi`, `fr -> ja`, and `fr -> ar` via the English pivot. API E2E is the branch gate; browser-download validation is tracked separately as representative reassurance. |
| 2026-06-29 | bn, pt, ur, id | `translate-en_bn`, `translate-en_pt`, `translate-en_ur`, `translate-en_id` | Argos package index exposes all four packages; local install completed for all four with `AvailablePackage.install()`; installed direct pairs expose `en -> bn`, `en -> pt`, `en -> ur`, and `en -> id`, and the English-pivot composition exposes `fr -> bn`, `fr -> pt`, `fr -> ur`, and `fr -> id`. API E2E is the branch gate; browser-download validation is tracked separately as representative reassurance. |
| 2026-06-30 | sw, tr, it | `translate-en_sw`, `translate-en_tr`, `translate-en_it` | Argos package index exposes all three packages; local install completed for all three with `AvailablePackage.install()`; installed direct pairs expose `en -> sw`, `en -> tr`, and `en -> it`, and the English-pivot composition exposes `fr -> sw`, `fr -> tr`, and `fr -> it`. API E2E is the branch gate; browser-download validation is tracked separately as representative reassurance. |

## API E2E video validations

These validations run the real local HTTP API against `/root/android-app-games/resources/lisoir_dnde442.mp4`: language detection, audio extraction, segmentation, subtitle job creation/polling, and verified SRT artifact generation. This API E2E server workflow is the stabilization gate for the language branch. Browser-download validations are reported separately as representative user-workflow reassurance checks.

| Date | Code | Command | Artifact | Result |
| --- | --- | --- | --- | --- |
| 2026-07-01 | en | `pdm run api-e2e --target en` | `tmp/e2e-validations/lisoir_dnde442.fr-en.srt` (17,904 bytes) | Passed: detected French source, generated non-empty SRT with timestamp arrows through the API subtitle-job workflow. |
| 2026-07-01 | ru | `pdm run api-e2e --target ru` | `tmp/e2e-validations/lisoir_dnde442.fr-ru.srt` (29,552 bytes) | Passed: detected French source, generated non-empty SRT with timestamp arrows through the API subtitle-job workflow. |
| 2026-07-01 | uk | `pdm run api-e2e --target uk` | `tmp/e2e-validations/lisoir_dnde442.fr-uk.srt` (27,406 bytes) | Passed: detected French source, generated 88 SRT blocks with timestamp arrows through the API subtitle-job workflow. |
| 2026-07-01 | zh | `pdm run api-e2e --target zh` | `tmp/e2e-validations/lisoir_dnde442.fr-zh.srt` (15,058 bytes) | Passed: detected French source, generated 88 SRT blocks with timestamp arrows through the API subtitle-job workflow. |
| 2026-07-02 | de | `pdm run api-e2e --target de` | `tmp/e2e-validations/lisoir_dnde442.fr-de.srt` (19,941 bytes) | Passed: detected French source, generated 88 SRT blocks with timestamp arrows through the API subtitle-job workflow. |
| 2026-07-02 | es | `pdm run api-e2e --target es` | `tmp/e2e-validations/lisoir_dnde442.fr-es.srt` (18,907 bytes) | Passed: detected French source, generated 88 SRT blocks with timestamp arrows through the API subtitle-job workflow. |
| 2026-07-02 | hi | `pdm run api-e2e --target hi` | `tmp/e2e-validations/lisoir_dnde442.fr-hi.srt` (38,815 bytes) | Passed: detected French source, generated 88 SRT blocks with timestamp arrows through the API subtitle-job workflow. |
| 2026-07-02 | ja | `pdm run api-e2e --target ja` | `tmp/e2e-validations/lisoir_dnde442.fr-ja.srt` (21,049 bytes) | Passed: detected French source, generated 88 SRT blocks with timestamp arrows through the API subtitle-job workflow. |
| 2026-07-02 | ar | `pdm run api-e2e --target ar` | `tmp/e2e-validations/lisoir_dnde442.fr-ar.srt` (23,716 bytes) | Passed: detected French source, generated 88 SRT blocks with timestamp arrows through the API subtitle-job workflow. |
| 2026-07-02 | bn | `pdm run api-e2e --target bn` | `tmp/e2e-validations/lisoir_dnde442.fr-bn.srt` (35,737 bytes) | Passed: detected French source, generated 88 SRT blocks with timestamp arrows through the API subtitle-job workflow. |
| 2026-07-03 | pt | `pdm run api-e2e --target pt --min-srt-blocks 80` | `tmp/e2e-validations/lisoir_dnde442.fr-pt.srt` (18,419 bytes) | Passed: detected French source, generated 88 SRT blocks with timestamp arrows through the API subtitle-job workflow. |
| 2026-07-03 | ur | `pdm run api-e2e --target ur --min-srt-blocks 80` | `tmp/e2e-validations/lisoir_dnde442.fr-ur.srt` (25,907 bytes) | Passed: detected French source, generated 88 SRT blocks with timestamp arrows through the API subtitle-job workflow. |
| 2026-07-03 | id | `pdm run api-e2e --target id --min-srt-blocks 80` | `tmp/e2e-validations/lisoir_dnde442.fr-id.srt` (18,378 bytes) | Passed: detected French source, generated 88 SRT blocks with timestamp arrows through the API subtitle-job workflow. |
| 2026-07-03 | sw | `pdm run api-e2e --target sw --min-srt-blocks 80` | `tmp/e2e-validations/lisoir_dnde442.fr-sw.srt` (17,777 bytes) | Passed: detected French source, generated 88 SRT blocks with timestamp arrows through the API subtitle-job workflow. |
| 2026-07-03 | tr | `pdm run api-e2e --target tr --min-srt-blocks 80` | `tmp/e2e-validations/lisoir_dnde442.fr-tr.srt` (17,839 bytes) | Passed: detected French source, generated 88 SRT blocks with timestamp arrows through the API subtitle-job workflow. |
| 2026-07-04 | it | `pdm run api-e2e --target it --min-srt-blocks 80` | `tmp/e2e-validations/lisoir_dnde442.fr-it.srt` (18,634 bytes) | Passed: detected French source, generated 88 SRT blocks with timestamp arrows through the API subtitle-job workflow. |

## Representative browser-download validations

These validations exercise the browser workflow and Blob download path through Playwright. They use the short French fixture `/root/.cache/xololingua/tmp/lisoir_45s.mp4` to keep the reassurance suite fast while still covering upload, language detection, target selection, segmentation, subtitle generation, download capture, and SRT inspection.

| Date | Codes | Command pattern | Artifacts | Result |
| --- | --- | --- | --- | --- |
| 2026-07-04 | en, es, zh, hi, ar | `pdm run browser-e2e --no-start --target <code> --video /root/.cache/xololingua/tmp/lisoir_45s.mp4 --min-srt-blocks 1` | `~/.cache/xololingua/tmp/browser-e2e-downloads/lisoir_45s.<code>.srt` | Passed for all five representative targets. Downloaded SRT sizes: en 785 bytes, es 850 bytes, zh 584 bytes, hi 1,742 bytes, ar 980 bytes. |

## Translator smoke validations

These checks prove that the installed package chain can do a real French-to-target text translation through the English pivot. They are stronger than pair discovery, but they still do not replace the API E2E gate.

| Date | Codes | Expected pivot packages | Local validation |
| --- | --- | --- | --- |
| 2026-06-30 | ru, uk, zh, de | `translate-en_ru`, `translate-en_uk`, `translate-en_zh`, `translate-en_de` | `argostranslate.package.update_package_index()` found all four packages; installed direct pairs expose `en -> ru`, `en -> uk`, `en -> zh`, and `en -> de`; English-pivot composition exposes `fr -> ru`, `fr -> uk`, `fr -> zh`, and `fr -> de`; `translation.translate_text("Bonjour tout le monde.", "fr", <code>)` returned non-empty translated text for all four targets. API E2E is the branch gate; browser-download validation is tracked separately as representative reassurance. |
| 2026-06-30 | es, hi, ja, ar | `translate-en_es`, `translate-en_hi`, `translate-en_ja`, `translate-en_ar` | `argostranslate.package.update_package_index()` found all four packages; local installs were already present; installed direct pairs expose `en -> es`, `en -> hi`, `en -> ja`, and `en -> ar`; English-pivot composition exposes `fr -> es`, `fr -> hi`, `fr -> ja`, and `fr -> ar`; `translation.translate_text("Bonjour tout le monde.", "fr", <code>)` returned non-empty translated text for all four targets. API E2E is the branch gate; browser-download validation is tracked separately as representative reassurance. |
| 2026-07-01 | bn, pt, ur, id | `translate-en_bn`, `translate-en_pt`, `translate-en_ur`, `translate-en_id` | `argostranslate.package.update_package_index()` found all four packages; local installs completed successfully; installed direct pairs expose `en -> bn`, `en -> pt`, `en -> ur`, and `en -> id`; English-pivot composition exposes `fr -> bn`, `fr -> pt`, `fr -> ur`, and `fr -> id`; `translation.translate_text("Bonjour tout le monde.", "fr", <code>)` returned non-empty translated text for all four targets. API E2E is the branch gate; browser-download validation is tracked separately as representative reassurance. |
| 2026-07-01 | sw, tr, it | `translate-en_sw`, `translate-en_tr`, `translate-en_it` | `argostranslate.package.update_package_index()` found all three packages; local installs were already present; installed direct pairs expose `en -> sw`, `en -> tr`, and `en -> it`; English-pivot composition exposes `fr -> sw`, `fr -> tr`, and `fr -> it`; `translation.translate_text("Bonjour tout le monde.", "fr", <code>)` returned non-empty translated text for all three targets. API E2E is the branch gate; browser-download validation is tracked separately as representative reassurance. |

## Latest priority-batch probe

This table records the most recent backlog slice checked by the scheduled language-validation job. It does not remove languages from the missing-language table; only the API E2E server workflow can do that after a verified `.srt` is generated. Record browser-download checks separately as representative reassurance validations.

| Date | Codes | Expected pivot packages | Local validation |
| --- | --- | --- | --- |
| 2026-07-01 | sw, mr, te, tr, ta, it | `translate-en_sw`, `translate-en_mr`, `translate-en_te`, `translate-en_tr`, `translate-en_ta`, `translate-en_it` | `argostranslate.package.update_package_index()` completed. The package index exposes `translate-en_sw`, `translate-en_tr`, and `translate-en_it`; those packages are installed locally and `translation.get_supported_pairs()` exposes direct pairs `en -> sw`, `en -> tr`, and `en -> it`, plus English-pivot composition for `fr -> sw`, `fr -> tr`, and `fr -> it`. A translator smoke check returned non-empty French-to-target text for `sw`, `tr`, and `it`. The same package-index probe still does not expose `translate-en_mr`, `translate-en_te`, or `translate-en_ta`, so `fr -> mr`, `fr -> te`, and `fr -> ta` remain blocked locally. API E2E is the branch gate; browser-download validation is tracked separately as representative reassurance. |

## Package-index blockers

These languages are abandoned for the moment because the current Argos package index does not expose the expected English-pivot package yet. Keep them documented as blocked, but do not block stabilization of the language branch on them.

| Date | Codes | Expected pivot packages | Local validation |
| --- | --- | --- | --- |
| 2026-06-30 | mr, te, ta | `translate-en_mr`, `translate-en_te`, `translate-en_ta` | `argospm update` completed, but neither `argospm search` nor `package.get_available_packages()` found English-to-target packages for these codes. `translation.get_supported_pairs()` therefore does not expose `fr -> mr`, `fr -> te`, or `fr -> ta` locally yet. |
| 2026-07-04 | mr, te, ta | `translate-en_mr`, `translate-en_te`, `translate-en_ta` | `argostranslate.package.update_package_index()` completed; `package.get_available_packages()` still does not expose `translate-en_mr`, `translate-en_te`, or `translate-en_ta`. A live `translation.get_supported_pairs()` probe returned `fr -> mr: False`, `fr -> te: False`, and `fr -> ta: False`, so `fr -> mr`, `fr -> te`, and `fr -> ta` remain blocked locally. |

## Already available for the reference French video

| Code | Language | Notes |
| --- | --- | --- |
| en | English | Installed and validated as the first French target. |
| ar | Arabic | API E2E generated and verified `tmp/e2e-validations/lisoir_dnde442.fr-ar.srt`; API E2E branch gate passed; browser-download validation is representative only. |
| ja | Japanese | API E2E generated and verified `tmp/e2e-validations/lisoir_dnde442.fr-ja.srt`; API E2E branch gate passed; browser-download validation is representative only. |
| hi | Hindi | API E2E generated and verified `tmp/e2e-validations/lisoir_dnde442.fr-hi.srt`; API E2E branch gate passed; browser-download validation is representative only. |
| es | Spanish | API E2E generated and verified `tmp/e2e-validations/lisoir_dnde442.fr-es.srt`; API E2E branch gate passed; browser-download validation is representative only. |
| ru | Russian | API E2E generated and verified `tmp/e2e-validations/lisoir_dnde442.fr-ru.srt`; API E2E branch gate passed; browser-download validation is representative only. |
| uk | Ukrainian | API E2E generated and verified `tmp/e2e-validations/lisoir_dnde442.fr-uk.srt`; API E2E branch gate passed; browser-download validation is representative only. |
| zh | Chinese | API E2E generated and verified `tmp/e2e-validations/lisoir_dnde442.fr-zh.srt`; API E2E branch gate passed; browser-download validation is representative only. |
| de | German | API E2E generated and verified `tmp/e2e-validations/lisoir_dnde442.fr-de.srt`; API E2E branch gate passed; browser-download validation is representative only. |
| bn | Bengali | API E2E generated and verified `tmp/e2e-validations/lisoir_dnde442.fr-bn.srt`; API E2E branch gate passed; browser-download validation is representative only. |
| pt | Portuguese | API E2E generated and verified `tmp/e2e-validations/lisoir_dnde442.fr-pt.srt`; API E2E branch gate passed; browser-download validation is representative only. |
| ur | Urdu | API E2E generated and verified `tmp/e2e-validations/lisoir_dnde442.fr-ur.srt`; API E2E branch gate passed; browser-download validation is representative only. |
| id | Indonesian | API E2E generated and verified `tmp/e2e-validations/lisoir_dnde442.fr-id.srt`; API E2E branch gate passed; browser-download validation is representative only. |
| sw | Swahili | API E2E generated and verified `tmp/e2e-validations/lisoir_dnde442.fr-sw.srt`; API E2E branch gate passed; browser-download validation is representative only. |
| tr | Turkish | API E2E generated and verified `tmp/e2e-validations/lisoir_dnde442.fr-tr.srt`; API E2E branch gate passed; browser-download validation is representative only. |
| it | Italian | API E2E generated and verified `tmp/e2e-validations/lisoir_dnde442.fr-it.srt`; API E2E branch gate passed; browser-download validation is representative only. |

## Missing target languages

| Priority | Code | Language | Expected pivot package | Notes |
| --- | --- | --- | --- | --- |
| 1 | mr | Marathi | `translate-en_mr` | Present in the UI language catalogue; not in first MVP couples yet. |
| 2 | te | Telugu | `translate-en_te` | Present in the UI language catalogue; not in first MVP couples yet. |
| 3 | ta | Tamil | `translate-en_ta` | Present in the UI language catalogue; not in first MVP couples yet. |

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

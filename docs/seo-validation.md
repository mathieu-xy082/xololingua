# SEO implementation validation

Date: 2026-10-31 (UTC). Development branch: `ci/seo-guides`, based on production/main `33f6c97b863977c4389ea4324d468a4274eeaf6a`.

No production deployment, restart, configuration reload, DNS update, database change, analytics activation or deletion of existing releases/data was performed. All new servers used loopback-only test endpoints and a dedicated temporary media root.

## Automated checks

Baseline on unchanged main:
- Node: 237 tests passed.
- Python project environment: 99 tests, OK, 3 skipped.

Final check after the development-routing review fix:
- `PDM_IGNORE_ACTIVE_VENV=1 pdm run check`: exit 0, including compilation, Python and Node suites.
- Node: 248 tests passed, 0 failed or skipped.
- Python: 134 tests, OK, 3 skipped (existing skips).
- `git diff --check`: passed.
- Added-line static scan: no hardcoded-credential assignments, shell injection patterns, pickle loading or eval usage detected. This scan is not a substitute for independent code review.

The new tests cover editorial metadata/content for all six guides, source/build allowlisting, generated XML sitemap, robots, studio metadata/control IDs, runtime Service Worker behavior, explicit Python routes and a real Caddy loopback preview. Existing node/Python dependencies were reused locally; dependency symlinks are not part of the commit.

Independent editorial review passed. The initial technical review identified that the default source-checkout server could not resolve guides stored under `seo/`. The narrow fix adds a source-layout fallback for the six named routes while preferring built root HTML files. Added GET/HEAD/alias/query/404 tests exercise both layouts; 24 development-server tests and six real-Caddy tests passed. The full final project check was rerun after the fix. Independent technical re-review then passed with no security or logic findings; the reviewer additionally performed 56 HTTP checks against the actual source checkout and confirmed that the validation-document link resolves.

RED/GREEN cycles were executed for build publication, missing-guide rejection, discovery files, root metadata and illustration sizing, guide identity/content/styles, worker navigation behavior and route/alias behavior.

## Actual static build and HTTP routes

Command:

```sh
python3.12 scripts/build_static.py --output /root/.cache/xololingua/tmp/seo-validation/build-1
```

Result: `Static site ready`. The public build was created outside the repository, without changing `/srv/xololingua/www`.

A second fresh final build was created at `/root/.cache/xololingua/tmp/seo-validation/build-final` after the review fix. The full 24-case browser/layout and old-worker-upgrade checks were rerun successfully against that final build, with results in `browser-final/report.json`.

An isolated Caddy process used `admin off`, `http://127.0.0.2:14174`, the built directory and a proxy to the isolated backend on 18765. It did not access or reload the production Caddy admin endpoint/configuration.

Observed:
- `/`: 200 HTML.
- All six canonical guides: 200 HTML, direct URL access.
- `/sitemap.xml`: 200 XML, seven canonical URLs.
- `/robots.txt`: 200 text.
- `/api/health` on the preview: 200 from the isolated backend.
- `/missing`: 404.
- COOP `same-origin` and COEP `require-corp` preserved.
- Automated route tests also checked `.html`/slash 308 aliases, query preservation, HEAD, traversal rejection and unknown 404s on Python and real Caddy.

Guide HTML sizes on this build: 8,306–8,995 bytes before compression. Guides do not request studio JavaScript, WASM, ML models or external resources.

## Browser, responsive layout and PWA upgrade

Parent-run Playwright test against the built artifact:
- Six guides × 360/390/768/1440 px: 24 checks passed with JavaScript disabled.
- One H1, expected HTML language, self-canonical and reciprocal alternates checked.
- Internal links and direct reloads passed.
- No horizontal overflow detected.
- Studio checked at the same widths; all 51 existing DOM IDs preserved.
- Desktop French generator and mobile English SRT screenshots visually inspected, including the prominent no-SRT-import warning.

Existing-user Service Worker test in a real browser:
1. Installed the previous worker from baseline commit.
2. Reproduced its navigation cache pollution by opening a guide.
3. Updated to the new worker and verified removal of its obsolete application cache.
4. Navigated root → English guide → French guide → root offline.
5. Confirmed the offline root remained the actual studio, not a guide.
6. Confirmed an unknown URL was 404 online and did not become studio HTML offline.
7. Simulated a worker-code rollback in the isolated preview and confirmed studio offline access after a successful root visit.

This is a browser/cache regression test, not an execution of the operational production rollback procedure.

## Media non-regression: real API gate

Isolated backend:
- Loopback `127.0.0.1:18765` (not the production backend on 8765).
- Temporary media root `/root/.cache/xololingua/tmp/seo-validation/backend`.
- CPU Whisper base/int8; existing local translation packages.

```sh
.venv/bin/python scripts/api_e2e_validate.py \
  --source fr --target en --service-url http://127.0.0.1:18765 \
  --no-start --cleanup-retention-days 0 \
  --output-dir /root/.cache/xololingua/tmp/seo-validation/api-e2e
```

Result: exit 0, `API E2E succeeded`. The real default video `lisoir_dnde442_quarter.mp4` is 242.033333 seconds, not a synthetic fixture. The backend transcribed/translated 22 segments and wrote a 4,280-byte SRT.

## Media non-regression: strict browser gate

Used the real 242-second fixture and the built Caddy preview with all five browser-stage guards, `--inject-backend-reference-browser-ml` and `--compare-backend-srt`.

```sh
NO_PROXY=127.0.0.1,127.0.0.2,localhost no_proxy=127.0.0.1,127.0.0.2,localhost \
.venv/bin/python -u scripts/browser_e2e_validate.py \
  --frontend-url http://127.0.0.2:14174 --service-url http://127.0.0.1:18765 \
  --no-start --source fr --target en \
  --require-browser-language --require-browser-audio --require-browser-vad \
  --require-browser-transcription --require-browser-translation \
  --inject-backend-reference-browser-ml --compare-backend-srt \
  --download-dir /root/.cache/xololingua/tmp/seo-validation/browser-strict
```

Result: `Browser E2E succeeded`.
- Browser audio extraction: FFmpeg WASM.
- Browser segmentation: vad-web.
- Browser ML adapters: deterministic adapters populated from a real backend inference reference, NOT a claim of real browser-model inference.
- 24 browser segments and 24 SRT blocks; 4,350-byte download.
- Last browser SRT timestamp: 242.016 s; video duration reported 242.033 s.
- Reported temporal coverage: 1.000 (rounded).
- Backend comparison: 22 blocks, block delta 2; last timestamp delta 0.006 s; text similarity 1.000; no segmentation warning.

Exact command and detailed logs are in the artifact directory below. This validates the existing reference-injection gate; it does not establish quality for every language/model or browser.

## Supplemental real-browser-model sample

A separate 24.009433-second excerpt of the real fixture was tested without reference injection, with all five browser-stage guards and `--real-browser-models`.

Final result: `Browser E2E succeeded`, real-model diagnostics `status=pass`.
- Real models: `Xenova/whisper-base` and `Xenova/opus-mt-fr-en`.
- WASM CPU execution; no WebGPU adapter was available. No claim of GPU validation.
- 28 model requests, zero failed model requests.
- Two segments and two SRT blocks; 408-byte downloaded SRT; last timestamp 24.000 s, reported coverage 1.000 (rounded).
- Model-cache purge confirmed, zero remaining model-cache entries; browser HTTP cache 22,273,618 bytes, below the existing validator limit.
- This sample did not request backend-text comparison; the full reference-injection gate above did.

The first sample attempt combined manual source correction with a browser-language-status guard; the correction overwrote the status text, causing a harness assertion. The second attempt omitted the correction and completed actual inference/download, but the default 1,000-byte SRT floor rejected its legitimate 408-byte short output. The final run used explicit sample minima `--min-srt-bytes 200 --min-srt-blocks 2 --min-segments 2`, keeping the temporal-coverage requirement and all runtime/model/cache guards. No production code or default main-fixture threshold was modified to force this result.

Final command is the strict browser command's isolated endpoints plus:

```sh
--video /root/.cache/xololingua/tmp/seo-validation/sample-24s.mp4 \
--real-browser-models --require-browser-language --require-browser-audio \
--require-browser-vad --require-browser-transcription --require-browser-translation \
--min-srt-bytes 200 --min-srt-blocks 2 --min-segments 2 \
--download-dir /root/.cache/xololingua/tmp/seo-validation/browser-real-final
```

Omit both `--inject-backend-reference-browser-ml` and `--source-override` for this run. This supplemental short sample must not be confused with full-fixture real-model browser validation.

## Artifacts

Local temporary directory: `/root/.cache/xololingua/tmp/seo-validation/`.

- `baseline-node.log`, `baseline-python.log`.
- `node.log`, `python.log`, `pdm-check.log`, `pdm-check-final.log`.
- `build-1/` initial and `build-final/` final generated public builds.
- `browser/report.json` and `browser-final/report.json`, each with 12 desktop/mobile screenshots.
- `browser-check.py` parent browser validation driver used during the session.
- `api-e2e.log`, `api-e2e/lisoir_dnde442_quarter.fr-en.srt`.
- `browser-strict.log`, `browser-strict/lisoir_dnde442_quart.en.srt`.
- `browser-real.log`, `browser-real-retry.log` for the initial sample harness failures; `browser-real-final.log` and `browser-real-final/sample-24s.en.srt` for the successful supplemental real-model run.
- `Caddyfile`, `caddy-preview.log`, `backend.log` for isolated test services.

Temporary artifacts are not Git deliverables and can expire under the VPS cache-retention policy. Durable tests and the operational guide are versioned in the branch.

The isolated backend and Caddy preview were stopped after the media checks. Production services remained active on their original endpoints/release links. No persistent preview service was installed.

## Boundaries

No production traffic/indexing/Google ranking gain is asserted. No Search Console account was connected, property verified or sitemap submitted. No visitor tracking was activated. No Lighthouse or field Core Web Vitals claim is made. The original large PNG remains; explicit dimensions address layout reservation, not transfer size.

Deployment and operational rollback require a separate explicit authorization and a reviewed decision about backend restart and release retention; see [the publication guide](seo.md).

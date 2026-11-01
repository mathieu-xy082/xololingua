# SEO guides: development, validation and controlled publication

The studio stays at `/`. Six independent, fully rendered HTML guides extend it:

| French | English |
| --- | --- |
| `/generateur-sous-titres-video` | `/en/video-subtitle-generator` |
| `/traduire-sous-titres-srt` | `/en/translate-srt-subtitles` |
| `/sous-titres-youtube` | `/en/youtube-subtitles` |

## Architecture and editorial contract

Keep the vanilla HTML/CSS/JavaScript PWA and Python service. Editorial sources live in `seo/`; `scripts/build_static.py` copies only named guides to their `.html` output paths, copies the shared stylesheet to `/seo/seo.css`, and generates `sitemap.xml` from the route allowlist. Drafts in `seo/` are not automatically published. No framework, database, account, external analytics script or ML runtime is added to the guides.

Each guide has its own title, description, one H1, self-canonical, Open Graph metadata and reciprocal `fr`/`en` alternate links for the matching topic. Language links select an equivalent guide, never an arbitrary homepage. No automatic language/IP redirect. The studio remains English; its guide links offer both languages.

Preserve these facts when editing either language:

- Input is an MP4, not an existing SRT or YouTube URL.
- The current workflow requires a target language different from the source.
- Output is a downloaded translated SRT; no built-in subtitle editor or YouTube publishing integration is claimed.
- Public limits are one hour and 400 MiB per MP4. Browser capability and model availability matter.
- Media processing runs locally in the public browser workflow, but model downloads require network access. Do not imply zero network requests or universal offline operation.
- SRT examples in guides are illustrative, not claimed inference results.
- The SRT guide explicitly distinguishes a format tutorial from a nonexistent SRT-import tool.

The studio's existing controls and pipeline are unchanged. Explicit illustration dimensions reserve layout space; its original PNG is retained. Further responsive-image conversion is a separate optional optimization, not an implemented size reduction.

## Build and local checks

Use a development checkout, never `/opt/xololingua/app` or `/srv/xololingua/www`:

```sh
npm ci
pdm install -G test --frozen-lockfile
pdm run check
python3.12 -m unittest discover -s tests -p 'test_seo*.py'
python3.12 -m unittest discover -s tests -p test_studio_seo.py
python3.12 scripts/build_static.py --output /absolute/path/to/a/NEW/preview-directory
python3.12 scripts/web_serve.py --host 127.0.0.1 --port 14173 \
  --directory /absolute/path/to/preview-directory --no-browser
```

The default `pdm run web --no-browser` development workflow also resolves the six canonical guides directly from `seo/` in a source checkout. When serving a built directory, root-level built guide files take precedence. Both layouts retain the same explicit aliases and 404 behavior; this is not a generic SPA fallback.

The build destination must not exist. Use `/root/.cache/xololingua/tmp/` for generated artifacts on the development VPS. No `.env`, `.git`, Python source or entire checkout should be made public. The sitemap includes only `/` and the six canonical guide URLs, not aliases, tracking parameters or API routes. No invented `lastmod` dates.

`deploy/Caddyfile.example` contains production-intended route rules, not an instruction to reload the active server. For a local Caddy preview, use a separate configuration with `admin off`, an HTTP loopback address such as `http://127.0.0.1:14174`, a root pointing to the built preview and the same SEO routing rules. Do not bind 80, 443 or 2019. Do not run `caddy reload` during development.

Check all six routes and direct refreshes, HTML content types, aliases and query strings, sitemap XML, robots, internal links, 404 for an unknown route, and unchanged COOP/COEP. Test desktop and mobile widths, keyboard focus, language switch, CTA and JavaScript-disabled reading. Each guide must load no app JavaScript, WASM or model files.

### PWA navigation regression

The old root-scoped worker stored every navigation response as `index.html`, allowing a guide or 404 to overwrite the offline studio. The new worker separates studio and other document handling. Keep tests for:

- Install with the old worker, then upgrade to the new worker.
- `/ -> guide -> /`, including cached/offline navigation.
- Both language variants, studio query strings and `/index.html` alias.
- Unknown URLs and HTTP errors never become a successful studio document.
- Cache-write failures do not break an otherwise successful online navigation.
- API and third-party requests remain outside the PWA cache.

Changing files on the server does not instantly revoke previously installed workers; verify existing-user upgrade, not only a clean browser context.

### Media non-regression

Use a separate local backend port and temporary media root. The production API on 8765 is not a test backend. The existing scripts accept `--service-url`, and the browser script accepts `--frontend-url`; pass these explicitly and use `--no-start` after starting the isolated services yourself.

The project gates remain `api-e2e` and `e2e-browser-strict` (see `pyproject.toml`). The strict browser gate can inject a backend ML reference; record that fact and do not label it a real-model browser benchmark. If using a short excerpt instead of the default fixture, record its duration and do not claim full-fixture coverage. Never launch a heavy public API job as a regression test.

## Publication is a separate approval

Development, commits and a feature-branch push do not authorize production deployment, service restart, DNS changes, database changes or deletion of releases/data. Do not merge into `main`, dispatch a production workflow or update production symlinks without approval.

Audit baseline: main `33f6c97b863977c4389ea4324d468a4274eeaf6a`; active source and web links were both on that release. Recheck them before any future publication. The GitHub repository variable `PRODUCTION_BRANCH` was read as `main` during development; pushes to `ci/seo-guides` run checks but must not satisfy the deploy condition. Recheck before pushing if workflow/variables change.

### Required preflight after explicit approval

1. Record the exact reviewed commit, active app/web links and current service health. Ensure no pending deployment. Inspect GitHub environment protection and the deploy job condition; do not assume merging is harmless.
2. Save the affected Caddy configuration to a root-only backup directory and record its path in the deployment log. Do not copy secrets into documentation or Git. Do not edit `.env`, DNS, databases or data volumes.
3. Build a fresh release directory, never overwrite an active one. Keep the active and prior directories intact.
4. Validate the candidate Caddy configuration before any graceful reload. Preserve API proxying, loopback binding, compression, COOP/COEP and the domain configuration. Apply only the reviewed SEO route rules; unrelated upload-limit drift is outside this change.
5. Pick and approve ONE publication mode below, including its side effects.
6. After publication check `/`, `/api/health`, all six guides, canonical/hreflang, aliases, sitemap/robots, assets, unknown 404, browser workflow and worker upgrade.

### Publication mode decision

The installed `/usr/local/sbin/xololingua-deploy` switches both source/web release links, restarts the Python service and prunes older releases. Its installed copy also differs from the repository script. Do not execute it unchanged under a "no restart/no deletion" expectation. Reconcile the copy and retention behavior in a separately reviewed change if choosing full deployment. Existing same-SHA-link assumptions must remain valid.

A web-only publication can avoid a Python restart, but leaves app/web SHAs different unless release bookkeeping and subsequent deployment checks are adapted. Do not perform a one-off web-only symlink switch and leave the existing automation broken. This option needs its own reviewed release/rollback implementation before execution. This SEO branch does not silently rewrite the deployment architecture.

A full deployment requires explicit approval for its backend restart and a reviewed no-pruning procedure if deletion has not been authorized. Do not invoke the existing script merely because CI is green. A maintenance window may be needed; no zero-interruption guarantee is claimed for the existing full deployment.

## Rollback procedure

Prepare and rehearse in temporary directories before publication; these are operational steps, not actions already performed:

1. Identify the recorded pre-deployment app/web targets and saved Caddyfile. Confirm those directories still exist; do not recreate or delete data.
2. Restore the previous release link(s) with a fresh temporary symlink and atomic rename per link. Restore both links for full deployments; for an approved web-only mode follow its separately reviewed compatible bookkeeping. Never point Caddy at the source checkout.
3. If routing config changed, restore the saved Caddyfile, validate it and only then perform the authorized graceful reload.
4. If a full source switch requires Python restart, obtain/observe the approval covering that restart. Keep the API bound to loopback and preserve runtime storage.
5. Verify HTTPS root and health, restored studio functionality and expected route statuses. Inspect errors without printing sensitive request payloads.
6. Test an already controlled browser. A worker downloaded before rollback may still be active; if necessary prepare a corrective cache version rather than suggesting that a server rollback deletes every visitor's cache.

The existing deployment script rolls back during certain failures, but refuses an already-existing target release: invoking it with the old SHA is NOT a general manual rollback recipe. No database/DNS rollback is involved in this SEO change.

## Search Console setup (owner action)

No account or verification token is created by this branch. First check whether an existing property is available. No HTML verification tag does not imply that no DNS-verified property exists.

1. In the owner's Google account choose the URL-prefix property `https://xololingua.fr/` if domain-DNS changes are to be avoided.
2. Obtain the verification HTML file or meta tag from Google. Integrate its exact name/content into a reviewed source/build change so subsequent releases preserve it. Do not invent a token or send a password to an agent.
3. A Domain property uses DNS verification. This branch does not authorize modifying DNS; the owner must approve and perform any needed DNS action separately.
4. After approved publication, check that `/sitemap.xml` returns valid public XML. In the matching property, open Sitemaps and submit `sitemap.xml`.
5. Inspect each canonical guide, test the live URL and monitor indexing. Submission is discovery assistance, not a guarantee of indexing or ranking.
6. Weekly, record Web-search impressions, clicks, CTR and average position. Filter by guide, language-path group, and query; compare 28-day periods and note the publication date. Do not confuse missing data with zero demand.

Google references:
- https://support.google.com/webmasters/answer/9008080?hl=fr
- https://support.google.com/webmasters/answer/7451001?hl=fr
- https://support.google.com/webmasters/answer/7576553?hl=fr
- https://developers.google.com/search/docs/specialty/international/localized-versions

## Privacy-minded attribution proposal — not activated

Search Console measures search arrivals. A separate aggregate count of guide-to-studio entries could use a fixed allowlisted CTA source per guide/language. Because the current `Referrer-Policy` is `no-referrer`, do not assume the Referer header can attribute these transitions or weaken the policy for tracking.

No analytics collector, cookie, persistent identifier, fingerprint, tracking query parameter or new access log is enabled by this branch. If separately approved, count only aggregate entries; omit IP, User-Agent, arbitrary query values and media data, retain briefly and explain the measure publicly. Request counts are not unique visitors and can include reloads/bots. Any legal/consent assessment depends on the final implementation; no blanket exemption is claimed.

## Validation record

See `docs/seo-validation.md` for actual commands, results, limitations and generated-artifact locations from the implementation session. Production publication and operational rollback remain unexecuted pending explicit authorization.

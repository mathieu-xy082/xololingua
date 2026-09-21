# Public Ubuntu deployment

This example targets one Ubuntu 24.04 server with 2 vCPU, 8 GiB RAM, no GPU, and one HTTPS domain. On the public site, language identification, audio extraction, segmentation, transcription, and translation run in the visitor's browser. WebGPU is preferred for Whisper and local WASM CPU is used after a GPU failure. Local development retains the Python processing endpoints for tests and diagnostics. Public videos are limited to 1 hour and the browser extraction path accepts MP4 files up to 400 MiB.

## Prepare the server

1. Choose a domain or subdomain and point its A record to the server's public IPv4 address. Point an AAAA record only if IPv6 reaches this server. Open TCP ports 80 and 443 in the provider firewall and Ubuntu firewall. Caddy obtains and renews the HTTPS certificate when DNS and ports are ready.
2. Install Python 3.12, `python3.12-venv`, FFmpeg, Git, Node.js/npm, PDM, and Caddy using their supported Ubuntu installation methods. Check `python3.12 --version`, `node --version`, `pdm --version`, `caddy version`, and `ffmpeg -version`. The project requires Python 3.12 or newer; Python 3.11 cannot install it.
3. Create a dedicated system user with home `/var/lib/xololingua`, and keep `/opt/xololingua/app` readable by that user. Clone the repository at `/opt/xololingua/app`. Run `pdm use /usr/bin/python3.12` and `pdm install` in that directory. Verify that `/opt/xololingua/app/.venv/bin/python` exists.
4. Run `npm ci` in the checkout and `python3.12 scripts/build_static.py --output /srv/xololingua/www`. The destination must be new. Give Caddy read access to it. The generated directory contains only the web assets; never point a public web server at the repository checkout.
5. The public site performs translation in the browser, so Argos language packages are not required for public translation. For local development, install any needed Argos packages with PDM, for example `pdm run argospm update` and `pdm run argospm install translate-ru_en`.
6. Copy `deploy/xololingua.service.example` to `/etc/systemd/system/xololingua.service`, adjust paths if needed, then run `sudo systemctl daemon-reload`, `sudo systemctl enable --now xololingua`, and `sudo journalctl -u xololingua -f`. Model downloads may make the first startup slow. Check `curl http://127.0.0.1:8765/api/health` locally. The API must stay bound to `127.0.0.1:8765`.
7. Add the site block from `deploy/Caddyfile.example` to `/etc/caddy/Caddyfile`, replacing the example domain. Run `sudo caddy validate --config /etc/caddy/Caddyfile`, then `sudo systemctl reload caddy`. Verify `https://YOUR_DOMAIN/`, `https://YOUR_DOMAIN/api/health`, and an actual small MP4 end-to-end from a different machine. Confirm that `GET /api/subtitle-jobs` returns 404, `POST /api/detect-language` and `POST /api/subtitle-jobs` return 403, and that the browser's Network tab contains no media request to `/api/*`.

## Limits and operations

- `XOLOLINGUA_PUBLIC_MODE=1` disables the global job listing, cross-origin API access, and every Python processing endpoint, including `POST /api/detect-language`. The local service keeps these endpoints when public mode is disabled.
- The site UI rejects videos longer than 3,600 seconds and MP4 files larger than 400 MiB before browser processing. Local development keeps the 9,000-second limit for long-video tests and its Python processing paths.
- The public API accepts only small metadata and JSON requests. Set the live Caddy `request_body /api/*` limit to `3MB` as in `deploy/Caddyfile.example` and reload Caddy after validating its config.
- `journalctl -u xololingua -f` shows Python errors; `journalctl -u caddy -f` shows HTTPS and reverse-proxy errors. A 403 on a processing endpoint confirms that the public browser-only policy blocked it.
- This initial service does not provide user accounts, persistent jobs, storage quotas per person, or guaranteed completion times. Keep the API on loopback, watch resource use, and expand capacity and isolation before advertising it broadly.

## Automatic deployment from GitHub Actions

The `CI` workflow checks each push to `feat/public-deployment` and `main`. A successful check can deploy exactly that commit through a restricted SSH account. Set the repository variable `PRODUCTION_BRANCH` to select **one** production branch. Leave it unset while preparing the server. The `production` GitHub environment should require a reviewer and allow only the selected branch. A deployment restarts `xololingua`; browser processing continues independently once its assets are loaded. The GitHub runner never uses the root SSH key, and the API remains bound to `127.0.0.1:8765` behind Caddy.

### One-time preparation

1. Create a **new, dedicated** Ed25519 key on your workstation, outside this repository:

   ```sh
   ssh-keygen -t ed25519 -a 100 -f ~/.ssh/xololingua_deploy -C xololingua-github-actions
   scp ~/.ssh/xololingua_deploy.pub root@187.55.224.75:/root/xololingua-deploy.pub
   ```

   Keep the private key private. Do not reuse your personal or root SSH key.

2. On the VPS, fetch the reviewed `feat/public-deployment` commit into a root-owned setup directory and prepare the account. The setup command does **not** restart the service:

   ```sh
   sudo install -d -m 0700 /root/xololingua-deploy-setup
   sudo git clone --depth 1 --branch feat/public-deployment https://github.com/mathieu-xy082/xololingua.git /root/xololingua-deploy-setup/repo
   sudo bash /root/xololingua-deploy-setup/repo/deploy/setup_automation.sh /root/xololingua-deploy.pub feat/public-deployment
   ```

   It installs root-owned scripts in `/usr/local/sbin`, creates the locked `xololingua-deploy` account, gives its key only the `deploy <commit SHA>` command, and restricts its sudo access to the validating deployment script. Review `/etc/sudoers.d/xololingua-deploy` and `/etc/xololingua/deploy-branch` after installation. When the deployment scripts change, update this root-owned setup checkout and rerun `setup_automation.sh` before activating the changed workflow.

3. Pin the VPS SSH host key. Read its fingerprint on the VPS with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`. On your workstation, run `ssh-keyscan -t ed25519 187.55.224.75 > /tmp/xololingua_known_hosts` and `ssh-keygen -lf /tmp/xololingua_known_hosts`; compare the fingerprints before using the scanned key. Put the full `187.55.224.75 ssh-ed25519 ...` line in the GitHub repository variable `VPS_KNOWN_HOSTS`. Set repository variable `VPS_HOST` to `187.55.224.75`. In the GitHub environment named `production`, add secret `DEPLOY_SSH_PRIVATE_KEY` with the complete contents of `~/.ssh/xololingua_deploy`.

4. In GitHub repository settings, configure environment `production` with a required reviewer and allow only branch `feat/public-deployment`. Do not set `PRODUCTION_BRANCH` yet. These settings are under **Settings → Environments**; repository variables are under **Settings → Secrets and variables → Actions → Variables**.

5. During a quiet period, migrate the current live app and web directories into versioned release directories:

   ```sh
   sudo /usr/local/sbin/xololingua-migrate-layout
   readlink -f /opt/xololingua/app
   readlink -f /srv/xololingua/www
   curl --fail https://xololingua.fr/api/health
   ```

   This step stops and restarts `xololingua` once. It restores the original directories if its health check fails. Check `systemctl status xololingua` and `systemctl status caddy` afterward.

6. Set repository variable `PRODUCTION_BRANCH=feat/public-deployment` **last**. To deploy the current branch tip, run the `CI` workflow manually with branch `feat/public-deployment`; later pushes to that branch run checks and request production approval automatically. A deployment clones the branch on the VPS, verifies that its tip is the CI-tested commit, builds an isolated Python environment and web directory, switches the two release links, checks HTTPS/API health, and restores the prior links if a check fails. If the branch advanced while an approval was pending, the old run fails safely; approve or rerun the newest commit.

There must be at least 12 GiB free before building a new release. The script keeps the active and immediately previous releases; the locked PDM dependencies currently include large CUDA packages even on this CPU server. The workflow uses GitHub-hosted runners. Do not install a self-hosted runner on this public VPS for this repository.

### Switch production to `main` after merging

1. Merge `feat/public-deployment` into `main` and wait for the `main` CI check. The merge alone does not deploy while `PRODUCTION_BRANCH` still names the feature branch.
2. With no deployment pending, change `/etc/xololingua/deploy-branch` on the VPS to `main` as root, then change the `production` environment branch restriction to `main`.
3. Change repository variable `PRODUCTION_BRANCH` to `main` and manually run `CI` on `main` to deploy its current tip. Future pushes to `main` then follow the same gated process. Pushes to `feat/public-deployment` continue running checks but cannot deploy.

For deployment failures, inspect the GitHub Actions log and `journalctl -u xololingua -n 100`. The script leaves failed release directories for inspection but keeps or restores the previous live release. Never expose port 8765 publicly or point Caddy at a checkout; Caddy continues to serve `/srv/xololingua/www` and proxy `/api/*` to loopback.

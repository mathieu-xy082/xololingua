# Public Ubuntu deployment

This example targets one Ubuntu 24.04 server with 2 vCPU, 8 GiB RAM, no GPU, and one HTTPS domain. It is an initial public service with one processing request and one subtitle job at a time. CPU transcription can take a long time; excess work receives HTTP 429. Public video and WAV uploads are limited to 1 hour of media. Uploaded MP4 requests are also limited to 2 GB. A separate capacity and abuse review is needed before promoting this to a high-traffic service.

## Prepare the server

1. Choose a domain or subdomain and point its A record to the server's public IPv4 address. Point an AAAA record only if IPv6 reaches this server. Open TCP ports 80 and 443 in the provider firewall and Ubuntu firewall. Caddy obtains and renews the HTTPS certificate when DNS and ports are ready.
2. Install Python 3.12, `python3.12-venv`, FFmpeg, Git, Node.js/npm, PDM, and Caddy using their supported Ubuntu installation methods. Check `python3.12 --version`, `node --version`, `pdm --version`, `caddy version`, and `ffmpeg -version`. The project requires Python 3.12 or newer; Python 3.11 cannot install it.
3. Create a dedicated system user with home `/var/lib/xololingua`, and keep `/opt/xololingua/app` readable by that user. Clone the repository at `/opt/xololingua/app`. Run `pdm use /usr/bin/python3.12` and `pdm install` in that directory. Verify that `/opt/xololingua/app/.venv/bin/python` exists.
4. Run `npm ci` in the checkout and `python3.12 scripts/build_static.py --output /srv/xololingua/www`. The destination must be new. Give Caddy read access to it. The generated directory contains only the web assets; never point a public web server at the repository checkout.
5. Install the Argos language packages that visitors need, as the `xololingua` system user. For example, with PDM in the checkout: `pdm run argospm update`, then `pdm run argospm install translate-ru_en` and `pdm run argospm install translate-en_fr` for a Russian-to-French route through English. Check `/api/translation-pairs` after startup; only installed routes can use the Python fallback.
6. Copy `deploy/xololingua.service.example` to `/etc/systemd/system/xololingua.service`, adjust paths if needed, then run `sudo systemctl daemon-reload`, `sudo systemctl enable --now xololingua`, and `sudo journalctl -u xololingua -f`. Model downloads may make the first startup slow. Check `curl http://127.0.0.1:8765/api/health` locally. The API must stay bound to `127.0.0.1:8765`.
7. Add the site block from `deploy/Caddyfile.example` to `/etc/caddy/Caddyfile`, replacing the example domain. Run `sudo caddy validate --config /etc/caddy/Caddyfile`, then `sudo systemctl reload caddy`. Verify `https://YOUR_DOMAIN/`, `https://YOUR_DOMAIN/api/health`, and an actual small MP4 end-to-end from a different machine. Confirm that `/api/subtitle-jobs` returns 404 and that the browser's Network tab shows API requests to the same HTTPS domain.

## Limits and operations

- `XOLOLINGUA_PUBLIC_MODE=1` disables the global job listing and cross-origin API access. It limits processing to one active request, subtitle generation to one active job, and expensive requests to 12 per IP per hour. Caddy sets `X-Real-IP` itself so visitors cannot choose their own rate-limit identity. Visitors sharing one public IP also share that allowance.
- Public mode rejects videos and registered WAV files longer than 3,600 seconds after probing the uploaded media and removes the rejected temporary file. The site UI checks the same limit before uploading. Local development keeps the 9,000-second limit for long-video tests.
- Caddy and Python both cap a request body at about 2 GB. Keep `max_size 2GB` and `XOLOLINGUA_PUBLIC_MAX_UPLOAD_BYTES=2000000000` close if the limit changes; the lower limit applies. The Python service also caps its media directory at 10 GB with 1 GB of headroom for processing. It removes abandoned generated media older than 24 hours on the next upload, while preserving audio used by an active job. Allow room for temporary upload files, installed models, and OS updates within the 68 GiB free disk.
- The app keeps up to 20 completed job snapshots in process memory. A server restart clears in-memory jobs, so visitors lose progress on any running job. Monitor `/var/lib/xololingua/tmp/service` and RAM.
- `journalctl -u xololingua -f` shows Python errors; `journalctl -u caddy -f` shows HTTPS and reverse-proxy errors. A 429 means the configured CPU capacity or hourly request allowance was reached. A 413 means the MP4 exceeded the public upload limit.
- This initial service does not provide user accounts, persistent jobs, storage quotas per person, or guaranteed completion times. Keep the API on loopback, watch resource use, and expand capacity and isolation before advertising it broadly.

## Automatic deployment from GitHub Actions

The `CI` workflow checks each push to `feat/public-deployment` and `main`. A successful check can deploy exactly that commit through a restricted SSH account. Set the repository variable `PRODUCTION_BRANCH` to select **one** production branch. Leave it unset while preparing the server. The `production` GitHub environment should require a reviewer and allow only the selected branch. A deployment restarts `xololingua` and interrupts any in-memory subtitle job; approve it when the service is idle. The GitHub runner never uses the root SSH key, and the API remains bound to `127.0.0.1:8765` behind Caddy.

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

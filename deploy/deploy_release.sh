#!/usr/bin/env bash
set -Eeuo pipefail

# Install this root-owned script as /usr/local/sbin/xololingua-deploy.
# The SSH gate passes only the exact commit SHA that passed CI.
readonly APP_ROOT=/opt/xololingua
readonly APP_RELEASES="$APP_ROOT/releases"
readonly APP_LINK="$APP_ROOT/app"
readonly WEB_ROOT=/srv/xololingua
readonly WEB_RELEASES="$WEB_ROOT/releases"
readonly WEB_LINK="$WEB_ROOT/www"
readonly BRANCH_FILE=/etc/xololingua/deploy-branch
readonly REPO_URL=https://github.com/mathieu-xy082/xololingua.git
readonly SITE_URL=https://xololingua.fr
readonly APP_USER=xololingua

fail() {
  printf 'xololingua deploy: %s\n' "$*" >&2
  exit 1
}

if [[ $# -ne 1 || ! "$1" =~ ^[0-9a-f]{40}$ ]]; then
  fail "usage: xololingua-deploy <40-character lowercase commit SHA>"
fi
if (( EUID != 0 )); then
  fail "run as root through the restricted deploy account"
fi
readonly SHA="$1"

[[ -f "$BRANCH_FILE" ]] || fail "missing $BRANCH_FILE"
IFS= read -r branch < "$BRANCH_FILE"
[[ "$branch" == feat/public-deployment || "$branch" == main ]] || fail "unsupported production branch"
[[ -L "$APP_LINK" && -L "$WEB_LINK" ]] || fail "run migrate_layout.sh before the first automated deployment"
[[ -x /var/lib/xololingua/.local/bin/pdm ]] || fail "PDM is not installed for xololingua"
[[ -x "$APP_ROOT/node/bin/node" ]] || fail "Node is not installed at $APP_ROOT/node"

exec 9>/run/lock/xololingua-deploy.lock
flock -n 9 || fail "another deployment is running"

old_app=$(readlink -f -- "$APP_LINK")
old_web=$(readlink -f -- "$WEB_LINK")
[[ "$old_app" == "$APP_RELEASES/"* && -d "$old_app" ]] || fail "current app link is outside $APP_RELEASES"
[[ "$old_web" == "$WEB_RELEASES/"* && -d "$old_web" ]] || fail "current web link is outside $WEB_RELEASES"
[[ "${old_app##*/}" == "${old_web##*/}" ]] || fail "current app and web releases do not match"

readonly app_release="$APP_RELEASES/$SHA"
readonly web_release="$WEB_RELEASES/$SHA"
if [[ "$old_app" == "$app_release" && "$old_web" == "$web_release" ]]; then
  printf 'Commit %s is already deployed.\n' "$SHA"
  exit 0
fi
[[ ! -e "$app_release" && ! -e "$web_release" ]] || fail "release already exists; inspect the previous attempt before retrying"

available_kb=$(df -Pk "$APP_RELEASES" | awk 'NR == 2 { print $4 }')
(( available_kb >= 12 * 1024 * 1024 )) || fail "less than 12 GiB free for a new CPU release"

switched=false
on_exit() {
  local status=$?
  trap - EXIT
  if (( status != 0 )) && [[ "$switched" == true ]]; then
    printf 'Deployment failed; restoring the previous app and web release.\n' >&2
    if ! { ln -s "$old_app" "$APP_LINK.rollback.$$" && mv -Tf "$APP_LINK.rollback.$$" "$APP_LINK"; }; then
      printf 'CRITICAL: could not restore %s\n' "$APP_LINK" >&2
    fi
    if ! { ln -s "$old_web" "$WEB_LINK.rollback.$$" && mv -Tf "$WEB_LINK.rollback.$$" "$WEB_LINK"; }; then
      printf 'CRITICAL: could not restore %s\n' "$WEB_LINK" >&2
    fi
    if ! systemctl restart xololingua; then
      printf 'CRITICAL: could not restart the previous service\n' >&2
    fi
  fi
  exit "$status"
}
trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

printf 'Cloning %s at branch %s.\n' "$SHA" "$branch"
runuser -u "$APP_USER" -- git clone --depth 1 --single-branch --branch "$branch" "$REPO_URL" "$app_release"
actual_sha=$(runuser -u "$APP_USER" -- git -C "$app_release" rev-parse HEAD)
[[ "$actual_sha" == "$SHA" ]] || fail "branch head changed before deployment: got $actual_sha"

runuser -u "$APP_USER" -- env \
  HOME=/var/lib/xololingua \
  PATH="$APP_ROOT/node/bin:/usr/bin:/bin" \
  PDM_VENV_IN_PROJECT=1 \
  PDM_IGNORE_ACTIVE_VENV=1 \
  PDM_CHECK_UPDATE=false \
  sh -c '
    set -eu
    cd "$1"
    /var/lib/xololingua/.local/bin/pdm use /usr/bin/python3.12
    /var/lib/xololingua/.local/bin/pdm install --prod --frozen-lockfile
    npm ci
    python3.12 scripts/build_static.py --output "$2"
  ' sh "$app_release" "$web_release"

[[ -x "$app_release/.venv/bin/python" ]] || fail "Python virtualenv was not created"
[[ -r "$web_release/index.html" ]] || fail "static site was not built"

switched=true
ln -s "$app_release" "$APP_LINK.next.$$"
mv -Tf "$APP_LINK.next.$$" "$APP_LINK"
ln -s "$web_release" "$WEB_LINK.next.$$"
mv -Tf "$WEB_LINK.next.$$" "$WEB_LINK"
systemctl restart xololingua

healthy=false
for _ in {1..90}; do
  if health=$(curl --fail --silent --show-error --max-time 3 http://127.0.0.1:8765/api/health 2>/dev/null); then
    if python3 -c 'import json, sys; h = json.load(sys.stdin); sys.exit(0 if all(h.get(k) is True for k in ("ok", "ffmpeg", "ffprobe", "whisper")) and h.get("whisperDevice") == "cpu" else 1)' <<< "$health"; then
      healthy=true
      break
    fi
  fi
  sleep 2
done
[[ "$healthy" == true ]] || fail "new service did not become healthy in CPU mode"

listeners=$(ss -ltnH 'sport = :8765' | awk '{ print $4 }')
[[ "$listeners" == 127.0.0.1:8765 ]] || fail "API is not bound exclusively to 127.0.0.1:8765"
curl --fail --silent --show-error --max-time 15 --output /dev/null "$SITE_URL/"
curl --fail --silent --show-error --max-time 15 --output /dev/null "$SITE_URL/api/health"
listing_status=$(curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}' "$SITE_URL/api/subtitle-jobs")
[[ "$listing_status" == 404 ]] || fail "public job listing returned HTTP $listing_status"

switched=false
printf 'Deployed %s successfully. Previous release: %s\n' "$SHA" "$old_app"

# Keep the current and immediately previous release for a quick rollback.
for pair in "$APP_RELEASES|$app_release|$old_app" "$WEB_RELEASES|$web_release|$old_web"; do
  IFS='|' read -r release_root current previous <<< "$pair"
  for path in "$release_root"/*; do
    [[ -d "$path" && "$path" != "$current" && "$path" != "$previous" ]] || continue
    name=${path##*/}
    [[ "$name" =~ ^([0-9a-f]{40}|bootstrap-[0-9a-f]{40})$ ]] || continue
    if ! rm -rf -- "$path"; then
      printf 'Could not prune old release %s; deployment remains healthy.\n' "$path" >&2
    fi
  done
done

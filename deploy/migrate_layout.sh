#!/usr/bin/env bash
set -Eeuo pipefail

# One-time migration of the manually deployed directories into release links.
# Install/run as root during an approved deployment window: service restart
# interrupts any in-memory subtitle job.
readonly APP_ROOT=/opt/xololingua
readonly APP_LINK="$APP_ROOT/app"
readonly APP_RELEASES="$APP_ROOT/releases"
readonly WEB_ROOT=/srv/xololingua
readonly WEB_LINK="$WEB_ROOT/www"
readonly WEB_RELEASES="$WEB_ROOT/releases"

fail() {
  printf 'xololingua migration: %s\n' "$*" >&2
  exit 1
}

(( EUID == 0 )) || fail "run as root"
if [[ -L "$APP_LINK" && -L "$WEB_LINK" ]]; then
  printf 'Release links already exist.\n'
  exit 0
fi
[[ ! -L "$APP_LINK" && ! -L "$WEB_LINK" ]] || fail "only one release link exists; inspect the layout"
[[ -d "$APP_LINK/.git" && -d "$WEB_LINK" ]] || fail "expected the current app checkout and static web directories"

exec 9>/run/lock/xololingua-deploy.lock
flock -n 9 || fail "another deployment is running"

current_sha=$(runuser -u xololingua -- git -C "$APP_LINK" rev-parse HEAD)
[[ "$current_sha" =~ ^[0-9a-f]{40}$ ]] || fail "could not identify current commit"
app_previous="$APP_RELEASES/bootstrap-$current_sha"
web_previous="$WEB_RELEASES/bootstrap-$current_sha"
[[ ! -e "$app_previous" && ! -e "$web_previous" ]] || fail "bootstrap release path already exists"

install -d -m 0755 -o xololingua -g xololingua "$APP_RELEASES" "$WEB_RELEASES"

complete=false
on_exit() {
  local status=$?
  trap - EXIT
  if (( status != 0 )) && [[ "$complete" == false ]]; then
    printf 'Migration failed; restoring the original layout.\n' >&2
    systemctl stop xololingua || true
    [[ ! -L "$APP_LINK" ]] || unlink "$APP_LINK"
    [[ ! -L "$WEB_LINK" ]] || unlink "$WEB_LINK"
    if [[ -d "$app_previous" && ! -e "$APP_LINK" ]]; then mv -T "$app_previous" "$APP_LINK"; fi
    if [[ -d "$web_previous" && ! -e "$WEB_LINK" ]]; then mv -T "$web_previous" "$WEB_LINK"; fi
    systemctl start xololingua || true
  fi
  exit "$status"
}
trap on_exit EXIT

systemctl stop xololingua
mv -T "$APP_LINK" "$app_previous"
ln -s "$app_previous" "$APP_LINK"
mv -T "$WEB_LINK" "$web_previous"
ln -s "$web_previous" "$WEB_LINK"
systemctl start xololingua

healthy=false
for _ in {1..90}; do
  if curl --fail --silent --show-error --max-time 3 http://127.0.0.1:8765/api/health >/dev/null 2>&1; then
    healthy=true
    break
  fi
  sleep 2
done
[[ "$healthy" == true ]] || fail "service did not become healthy after migration"
curl --fail --silent --show-error --max-time 15 --output /dev/null https://xololingua.fr/
complete=true
printf 'Migrated current commit %s to release links.\n' "$current_sha"

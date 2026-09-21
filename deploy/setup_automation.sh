#!/usr/bin/env bash
set -Eeuo pipefail

# Run once as root on the VPS, from the trusted checkout, with a dedicated
# deployment public key. This prepares the restricted account but does not
# restart the service or migrate the live directories.
fail() {
  printf 'xololingua setup: %s\n' "$*" >&2
  exit 1
}

(( EUID == 0 )) || fail "run as root"
[[ $# -ge 1 && $# -le 2 ]] || fail "usage: setup_automation.sh <public-key-file> [feat/public-deployment|main]"
key_file=$1
branch=${2:-}
if [[ -z "$branch" && -f /etc/xololingua/deploy-branch ]]; then
  IFS= read -r branch < /etc/xololingua/deploy-branch
fi
branch=${branch:-feat/public-deployment}
[[ "$branch" == feat/public-deployment || "$branch" == main ]] || fail "unsupported branch"
[[ -r "$key_file" ]] || fail "cannot read public key"
read -r key_type key_body _ < "$key_file"
[[ "$key_type" == ssh-ed25519 && "$key_body" =~ ^[A-Za-z0-9+/=]+$ ]] || fail "expected one ssh-ed25519 public key"
ssh-keygen -lf "$key_file" >/dev/null || fail "invalid public key"

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
for script in deploy_release.sh migrate_layout.sh ssh_gate.sh; do
  [[ -f "$script_dir/$script" ]] || fail "missing $script"
  bash -n "$script_dir/$script"
done

if ! id xololingua-deploy >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/xololingua-deploy --shell /bin/bash xololingua-deploy
fi
[[ $(getent passwd xololingua-deploy | cut -d: -f6) == /var/lib/xololingua-deploy ]] || fail "deploy account has an unexpected home directory"
usermod --lock xololingua-deploy
chown root:root /var/lib/xololingua-deploy
chmod 0755 /var/lib/xololingua-deploy

install -d -m 0755 -o root -g root /etc/xololingua
install -d -m 0755 -o root -g root /usr/local/sbin
install -o root -g root -m 0755 "$script_dir/deploy_release.sh" /usr/local/sbin/xololingua-deploy
install -o root -g root -m 0755 "$script_dir/migrate_layout.sh" /usr/local/sbin/xololingua-migrate-layout
install -o root -g root -m 0755 "$script_dir/ssh_gate.sh" /usr/local/sbin/xololingua-deploy-ssh

install -d -m 0755 -o root -g root /var/lib/xololingua-deploy/.ssh
authorized_keys=/var/lib/xololingua-deploy/.ssh/authorized_keys
printf 'restrict,command="/usr/local/sbin/xololingua-deploy-ssh" %s %s\n' "$key_type" "$key_body" > "$authorized_keys"
chown root:root "$authorized_keys"
chmod 0644 "$authorized_keys"

sudoers_tmp=$(mktemp)
trap 'rm -f -- "$sudoers_tmp"' EXIT
printf 'xololingua-deploy ALL=(root) NOPASSWD: /usr/local/sbin/xololingua-deploy *\n' > "$sudoers_tmp"
chmod 0440 "$sudoers_tmp"
visudo -cf "$sudoers_tmp" >/dev/null || fail "sudoers validation failed"
install -o root -g root -m 0440 "$sudoers_tmp" /etc/sudoers.d/xololingua-deploy

printf '%s\n' "$branch" > /etc/xololingua/deploy-branch
chmod 0644 /etc/xololingua/deploy-branch
chown root:root /etc/xololingua/deploy-branch
printf 'Restricted deploy account ready for %s. The live service was not restarted.\n' "$branch"

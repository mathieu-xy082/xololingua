#!/usr/bin/env bash
set -Eeuo pipefail

# Forced SSH command for the xololingua-deploy account. The key must also
# have the authorized_keys `restrict` option.
if [[ ! ${SSH_ORIGINAL_COMMAND:-} =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
  printf 'Only deploy <40-character lowercase commit SHA> is allowed.\n' >&2
  exit 1
fi

exec sudo -n /usr/local/sbin/xololingua-deploy "${BASH_REMATCH[1]}"

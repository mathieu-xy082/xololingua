#!/usr/bin/env bash
set -euo pipefail

# Run the GitLab check job locally in Docker.
# This intentionally mirrors .gitlab-ci.yml for the ci/gitlab-pipeline branch:
# - image: python:3.12-bookworm
# - Debian bookworm nodejs package, currently Node 18.x
# - pinned PDM installer
# - project-native `pdm run check`
#
# Usage:
#   scripts/ci-local.sh
#   KEEP_CI_CONTAINER=1 scripts/ci-local.sh   # leave container/cache/artifacts for inspection
#   CI_LOCAL_IMAGE=python:3.12-bookworm scripts/ci-local.sh

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${CI_LOCAL_IMAGE:-python:3.12-bookworm}"
pdm_version="${PDM_VERSION:-2.28.0}"
container_name="xololingua-ci-local-$$"
workdir="/work"

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is not installed or not on PATH" >&2
  exit 127
fi

cleanup() {
  if [[ "${KEEP_CI_CONTAINER:-0}" == "1" ]]; then
    echo "==> KEEP_CI_CONTAINER=1 set; leaving Docker container and local CI artifacts for inspection"
    return 0
  fi

  docker rm -f "$container_name" >/dev/null 2>&1 || true

  # The Docker preflight mounts the repository at /work and PDM writes these
  # generated artifacts there. Remove them automatically so running the
  # preflight does not leave the working tree dirty or require manual cleanup.
  rm -rf \
    "$repo_root/.venv" \
    "$repo_root/.cache" \
    "$repo_root/.pdm-python"
}
trap cleanup EXIT

echo "==> CI local preflight"
echo "repo: $repo_root"
echo "image: $image"
echo "pdm: $pdm_version"
echo

docker_args=(
  --name "$container_name"
  -e PDM_VERSION="$pdm_version"
  -e PDM_CHECK_UPDATE=false
  -e PDM_VENV_IN_PROJECT=1
  -e PDM_CACHE_DIR="$workdir/.cache/pdm"
  -e PIP_CACHE_DIR="$workdir/.cache/pip"
  -v "$repo_root:$workdir"
  -w "$workdir"
)

if [[ "${KEEP_CI_CONTAINER:-0}" != "1" ]]; then
  docker_args+=(--rm)
fi

docker run \
  "${docker_args[@]}" \
  "$image" \
  bash -lc '
    set -euo pipefail
    python --version
    apt-get update
    apt-get install -y --no-install-recommends nodejs ffmpeg
    rm -rf /var/lib/apt/lists/*
    python --version
    python -m pip install --upgrade pip "pdm==$PDM_VERSION"
    pdm --version
    node --version
    ffmpeg -version | sed -n "1p"
    PDM_IGNORE_ACTIVE_VENV=1 pdm install -G test --frozen-lockfile
    PDM_IGNORE_ACTIVE_VENV=1 pdm run check
  '

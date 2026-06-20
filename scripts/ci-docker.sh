#!/usr/bin/env bash
# Purpose: catch Linux/GitHub Actions build failures locally without touching local dependencies.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workdir="$(mktemp -d "${TMPDIR:-/tmp}/neuralyzer-ci.XXXXXX")"

cleanup() {
	rm -rf "$workdir"
}
trap cleanup EXIT

cd "$repo_root"
git ls-files -z --cached --others --exclude-standard \
	| tar --null -T - -cf - \
	| tar -xf - -C "$workdir"

docker run --rm --platform linux/amd64 \
	-v "$workdir:/repo" \
	-w /repo \
	node:22-bookworm \
	bash -lc "set -euo pipefail; npm ci; npm run build; npm run test:unit"

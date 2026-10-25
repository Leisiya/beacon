#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
beacon_root="$PWD"
beacon_bun="$beacon_root/.local/bun-darwin-aarch64/bun"
beacon_go="$beacon_root/.local/go/bin/go"
if [ ! -x "$beacon_bun" ]; then beacon_bun=bun; fi
if [ ! -x "$beacon_go" ]; then beacon_go=go; fi
(
  cd web
  "$beacon_bun" run build
  "$beacon_bun" run typecheck
)
mkdir -p .local/bin
"$beacon_go" build -ldflags "-X github.com/QuantumNous/new-api/common.Version=v1.0.0-rc.46-beacon-dev" -o .local/bin/beacon-dev .

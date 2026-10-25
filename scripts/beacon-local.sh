#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -f .env.beacon.local ]; then
  echo '缺少 .env.beacon.local；参见 docs/beacon/LOCAL_RUN.md' >&2
  exit 1
fi
mkdir -p data logs
set -a
. ./.env.beacon.local
set +a
beacon_binary="${BEACON_LOCAL_BINARY:-.local/bin/beacon-dev}"
if [ ! -x "$beacon_binary" ]; then
  echo '缺少 Beacon 定制构建；请先运行 sh scripts/beacon-build.sh，或参见 docs/beacon/LOCAL_RUN.md' >&2
  exit 1
fi
exec "$beacon_binary" --log-dir ./logs

#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -f .env.beacon.local ]; then
  echo '缺少 .env.beacon.local；参见 docs/beacon/LOCAL_RUN.md' >&2
  exit 1
fi
if [ ! -x .local/bin/new-api-v1.0.0-rc.46 ]; then
  echo '缺少官方固定版可执行包；参见 docs/beacon/LOCAL_RUN.md' >&2
  exit 1
fi
mkdir -p data logs
set -a
. ./.env.beacon.local
set +a
exec .local/bin/new-api-v1.0.0-rc.46 --log-dir ./logs

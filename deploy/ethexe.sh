#!/usr/bin/env bash
set -e
ROOT=/Users/adityakrx/polybaskets-1/polybaskets-eth
exec docker run --rm --platform linux/amd64 \
  --add-host=host.docker.internal:host-gateway \
  -v "$ROOT/deploy/ethexe-work":/work \
  -v "$ROOT/contract":/contract:ro \
  -w /work \
  pbeth-ethexe "$@"

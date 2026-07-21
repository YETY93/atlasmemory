#!/usr/bin/env bash
# Wrapper de conveniencia para Linux/macOS. Toda la lógica está en install.mjs
# (cross-platform, requiere Node 18+). En Windows usa: node install.mjs <dest>
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
exec node "$SRC/install.mjs" "$@"

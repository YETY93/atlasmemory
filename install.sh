#!/usr/bin/env bash
# Instala la plantilla de Memoria Inteligente del Proyecto en un repo destino.
# Uso:
#   ./install.sh /ruta/al/proyecto
#   ./install.sh /ruta/al/proyecto --force
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${1:-}"
FORCE="${2:-}"

if [[ -z "$DEST" ]]; then
  echo "Uso: $0 /ruta/al/proyecto [--force]"
  exit 1
fi

DEST="$(cd "$DEST" && pwd)"
echo "Instalando atlasmemory en: $DEST"
echo "Desde plantilla: $SRC"

copy_file() {
  local from="$1"
  local to="$2"
  mkdir -p "$(dirname "$to")"
  if [[ -f "$to" && "$FORCE" != "--force" ]]; then
    echo "  skip (existe): $to  (usa --force para sobrescribir)"
    return
  fi
  cp "$from" "$to"
  echo "  ok: $to"
}

copy_file "$SRC/scripts/index-catalog.mjs" "$DEST/scripts/index-catalog.mjs"
copy_file "$SRC/scripts/smoke-catalog.mjs" "$DEST/scripts/smoke-catalog.mjs"
copy_file "$SRC/.opencode/tools/catalog.ts" "$DEST/.opencode/tools/catalog.ts"
copy_file "$SRC/.opencode/skills/reuse-first/SKILL.md" "$DEST/.opencode/skills/reuse-first/SKILL.md"
copy_file "$SRC/.opencode/opencode.json" "$DEST/.opencode/opencode.json"
copy_file "$SRC/.opencode/memory/.gitignore" "$DEST/.opencode/memory/.gitignore"

if [[ ! -f "$DEST/AGENTS.md" || "$FORCE" == "--force" ]]; then
  if [[ -f "$DEST/AGENTS.md" && "$FORCE" == "--force" ]]; then
    cp "$SRC/AGENTS.md" "$DEST/AGENTS.md"
    echo "  ok: $DEST/AGENTS.md (sobrescrito — edita placeholders)"
  else
    cp "$SRC/AGENTS.md" "$DEST/AGENTS.md"
    echo "  ok: $DEST/AGENTS.md (edita placeholders {{PROJECT_*}})"
  fi
else
  echo "  skip (existe): $DEST/AGENTS.md"
fi

if [[ -f "$SRC/docs/arquetipo-catalogo-agente.md" ]]; then
  mkdir -p "$DEST/docs"
  if [[ ! -f "$DEST/docs/arquetipo-catalogo-agente.md" || "$FORCE" == "--force" ]]; then
    cp "$SRC/docs/arquetipo-catalogo-agente.md" "$DEST/docs/arquetipo-catalogo-agente.md"
    echo "  ok: docs/arquetipo-catalogo-agente.md"
  else
    echo "  skip: docs/arquetipo-catalogo-agente.md"
  fi
fi

echo ""
echo "Siguiente:"
echo "  1. Edita $DEST/AGENTS.md (descripción, build, invariantes)"
echo "  2. cd $DEST && node scripts/index-catalog.mjs"
echo "  3. node scripts/smoke-catalog.mjs"
echo "  4. Abre opencode en $DEST y prueba catalog_exists"

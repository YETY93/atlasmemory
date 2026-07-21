# Quickstart

Instalar atlasmemory en un proyecto desde cero. **No es solo copiar y pegar**:
hay 4 pasos obligatorios.

## Requisitos

- **Node.js 18+** (probado con 22). No hace falta `npm install`: el servidor MCP y el
  indexer son cero dependencias.
- **Claude Code** y/o **OpenCode**.
- ☕ **Proyecto Java** (Maven multi-módulo) con fuentes en `*/src/main/java/**/*.java`.
  El indexer actual **solo lee Java**: en otro lenguaje el catálogo saldrá vacío
  (ver "Otros lenguajes o arquitecturas" abajo).

## Instalación (Claude Code)

```bash
# 1) Traer la plantilla e instalarla en tu proyecto
git clone https://github.com/YETY93/atlasmemory.git
cd atlasmemory
node install.mjs /ruta/al/proyecto    # cross-platform; --force para sobrescribir
#   (Linux/macOS también: ./install.sh /ruta/al/proyecto)

# 2) En el proyecto destino: editar placeholders y generar la memoria
cd /ruta/al/proyecto
#   → edita CLAUDE.md: {{PROJECT_NAME}}, {{PROJECT_DESCRIPTION}}, {{BUILD_COMMANDS}}
node scripts/index-catalog.mjs        # genera .opencode/memory/catalog.json
node scripts/smoke-catalog.mjs        # opcional: valida el pipeline

# 3) Abrir Claude Code DESDE LA RAÍZ del proyecto
claude
#   → aprueba el servidor MCP "atlasmemory" cuando lo pida

# 4) Verificar
#   /mcp                              → atlasmemory: connected (5 tools)
#   mcp__atlasmemory__catalog_exists name=<UnaClaseQueExista>  → REUSE_EXISTING
```

### Los 4 pasos que el copy-paste NO cubre

| # | Paso | Si lo saltas |
|---|------|--------------|
| 1 | Correr `index-catalog.mjs` | "Catalog not found. Run catalog_reindex first" |
| 2 | Lanzar `claude` desde la **raíz** | `.mcp.json` usa la ruta relativa `mcp/server.mjs`; desde otro dir no carga |
| 3 | **Reiniciar** la sesión | `.mcp.json` y las skills se cargan al iniciar, no en caliente |
| 4 | Editar los `{{PLACEHOLDERS}}` | El agente los lee literalmente |

## ¿Y si el proyecto ya tiene `.opencode/`, `.claude/` o `.mcp.json`?

El instalador **no reemplaza carpetas**: copia una lista fija de archivos, así que
todo lo tuyo que no esté en esa lista (otras tools, otras skills, `settings.local.json`)
queda intacto.

Los dos archivos de **config acumulativa** se **fusionan**, no se pisan:

| Archivo | Comportamiento |
|---------|----------------|
| `.mcp.json` | Conserva tus servidores y añade solo `mcpServers.atlasmemory` |
| `.opencode/opencode.json` | Conserva tu config y añade `AGENTS.md`/`CLAUDE.md` a `instructions` |
| `AGENTS.md` / `CLAUDE.md` | Se omiten si ya existen (no pisa tu documentación) |
| JSON de config corrupto | Se omite y avisa; solo `--force` lo reemplaza |

Es **idempotente**: reinstalar no duplica entradas ni reordena tu configuración.

```text
  merge: .mcp.json  (fusionado (conserva: github, postgres))
  merge: .opencode/opencode.json  (fusionado (+ instructions: AGENTS.md, CLAUDE.md))
  skip (existe): AGENTS.md
```

## Instalación (OpenCode)

Igual que arriba, pero el paso 3 es `opencode` desde la raíz. Las tools no llevan
prefijo: `catalog_exists`, `catalog_search`, etc.

## Otros lenguajes o arquitecturas

El arquetipo trae **dos supuestos de Clarisa** que NO son configuración por defecto:

1. **El indexer es Java + Maven hexagonal.** Recorre `src/main/java` y clasifica por
   convenciones `*Data`, `I*`, `*UC`, `*RS`, `@Entity`, `*Mapper`. En otro stack el
   catálogo saldrá vacío o mal clasificado → hay que adaptar `scripts/index-catalog.mjs`.

2. **El checklist de `CREATE_NEW`** (qué hacer cuando algo no existe) asume `CRUDData`,
   `emQuery/emCommand`, `tenant`, `@Produces`... En otro proyecto Java esas instrucciones
   serían incorrectas.

**El #2 sí es configurable sin tocar código:** copia `atlasmemory.config.example.json`
como `atlasmemory.config.json` en la raíz del proyecto y edita los `createHints`. Ambos
bindings (OpenCode y MCP) lo leen automáticamente; si el archivo no existe, usan los
defaults de Clarisa. El #1 requiere editar el indexer.

## Estructura instalada

```text
tu-proyecto/
├── CLAUDE.md              AGENTS.md            ← reglas por cliente (editar placeholders)
├── .mcp.json                                  ← registro MCP (Claude Code)
├── atlasmemory.config.json                    ← opcional (checklists a tu medida)
├── mcp/server.mjs                             ← binding Claude Code
├── .claude/skills/reuse-first/SKILL.md
├── .opencode/{opencode.json,tools,skills}     ← binding OpenCode
├── .opencode/memory/catalog.json              ← store compartido (generado)
└── scripts/{index-catalog,smoke-catalog}.mjs  ← indexer compartido
```

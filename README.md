# Plantilla: Memoria Inteligente del Proyecto

Archivos listos para **copiar y pegar** (o instalar con `install.sh`) en cada repositorio Java.

> **El agente consulta conocimiento, no redescubre el repositorio.**

## Contenido

```text
memory-arquetipo/
├── README.md                          ← este archivo
├── install.sh                         ← instalador al proyecto destino
├── AGENTS.md                          ← plantilla (editar placeholders)
├── docs/
│   └── arquetipo-catalogo-agente.md   ← visión + modelo de conocimiento
├── scripts/
│   ├── index-catalog.mjs              ← indexer (Niveles 1–3)
│   └── smoke-catalog.mjs              ← prueba sin OpenCode
└── .opencode/
    ├── opencode.json
    ├── tools/
    │   └── catalog.ts                 ← catalog_search|get|exists|related|reindex
    ├── skills/
    │   └── reuse-first/
    │       └── SKILL.md
    └── memory/
        └── .gitignore                 ← catalog.json se genera en cada proyecto
```

**No se copia** un `catalog.json` de ejemplo: se genera en el proyecto destino.

## Instalación rápida

```bash
# Opción A — script
./install.sh /ruta/al/proyecto

# Opción B — copiar a mano la estructura scripts/ y .opencode/ + AGENTS.md
cp -r scripts .opencode AGENTS.md /ruta/al/proyecto/
# opcional: docs/
```

Luego en el proyecto destino:

```bash
cd /ruta/al/proyecto
# 1. Editar AGENTS.md (reemplazar {{PROJECT_NAME}}, etc.)
# 2. Indexar
node scripts/index-catalog.mjs
# 3. Probar
node scripts/smoke-catalog.mjs
# 4. Abrir OpenCode desde la raíz del proyecto
opencode
```

## Qué hay que personalizar por proyecto

| Archivo | Acción |
|---------|--------|
| `AGENTS.md` | Descripción, comandos de build, invariantes, nomenclatura |
| `CLAUDE.md` | Ya debería existir; se referencia en `opencode.json` |
| `.opencode/opencode.json` | Quitar `CLAUDE.md` de `instructions` si no existe |
| Tags del indexer | Opcional: editar `extractTags` en `index-catalog.mjs` |

## Tools que expone OpenCode

| Export en `catalog.ts` | Tool name |
|------------------------|-----------|
| `search` | `catalog_search` |
| `get` | `catalog_get` |
| `exists` | `catalog_exists` |
| `related` | `catalog_related` |
| `reindex` | `catalog_reindex` |

## Prueba mínima en el agente

```
usa catalog_exists con name <AlgunaClaseDataQueExista>
→ REUSE_EXISTING

usa catalog_exists con name FooBarNoExisteData
→ CREATE_NEW
```

## Requisitos

- Node.js 18+ (probado con 22)
- OpenCode con soporte de custom tools (`.opencode/tools/`)
- Proyecto con fuentes en `*/src/main/java/**/*.java`

## Documentación de producto

Ver `docs/arquetipo-catalogo-agente.md` (modelo de conocimiento, 10 niveles, MVP).

# atlasmemory

**Memoria Inteligente del Proyecto** para agentes de IA (OpenCode y similares).

> **El agente consulta conocimiento, no redescubre el repositorio.**

Plantilla portable: se instala en cada repo Java y genera un catálogo (componentes, capas, relaciones) para decidir **REUSE_EXISTING** vs **CREATE_NEW** antes de crear `*Data`, puertos `I*`, `*UC`, mappers o REST.

No es un monorepo de negocio (p. ej. Clarisa): es solo la plantilla de memoria + indexer + tools.

## Qué resuelve

Cuando un agente necesita un adaptador o caso de uso, suele crearlo de cero aunque ya exista. atlasmemory indexa el código y expone tools para reutilizar lo existente.

## Requisitos

- Node.js 18+ (probado con 22)
- OpenCode con custom tools (`.opencode/tools/`)
- Fuentes en `*/src/main/java/**/*.java`

## Contenido

```text
atlasmemory/
├── README.md
├── LICENSE
├── install.sh
├── AGENTS.md
├── docs/
│   ├── arquetipo-catalogo-agente.md
│   ├── evaluacion-scripts.md
│   └── mejoras-catalogo-2026-07.md
├── scripts/
│   ├── index-catalog.mjs
│   └── smoke-catalog.mjs
└── .opencode/
    ├── opencode.json
    ├── tools/catalog.ts
    ├── skills/reuse-first/SKILL.md
    └── memory/.gitignore
```

`catalog.json` **no** se versiona: se genera en cada proyecto destino.

## Instalación

```bash
git clone https://github.com/YETY93/atlasmemory.git
cd atlasmemory
./install.sh /ruta/al/proyecto
# o con sobrescritura:
./install.sh /ruta/al/proyecto --force
```

Copia manual:

```bash
cp -r scripts .opencode AGENTS.md /ruta/al/proyecto/
# opcional: docs/
```

En el proyecto destino:

```bash
cd /ruta/al/proyecto
# 1. Editar AGENTS.md (placeholders {{PROJECT_*}})
node scripts/index-catalog.mjs
node scripts/smoke-catalog.mjs
opencode
```

## Tools

| Tool | Uso |
|------|-----|
| `catalog_exists` | **Siempre** antes de crear Data/port/UC/entity/mapper |
| `catalog_search` | Explorar por nombre, método o tag |
| `catalog_get` | Detalle + métodos |
| `catalog_related` | implements / uses / produces / extends |
| `catalog_reindex` | Tras cambios estructurales |

## Demo mínima

```
catalog_exists name=<AlgunaClaseDataQueExista>
→ REUSE_EXISTING (solo si el nombre es exacto)

catalog_exists name=FooBarNoExisteData
→ CREATE_NEW (+ nearMisses si hay parecidos)
```

`REUSE_EXISTING` solo con match **exacto** de nombre (evita falsos positivos por sufijos `Data`/`Dto`/...).

## Personalizar por proyecto

| Archivo | Acción |
|---------|--------|
| `AGENTS.md` | Descripción, build, invariantes |
| Tags en `index-catalog.mjs` | Opcional (`extractTags`) |

## Documentación

- `docs/arquetipo-catalogo-agente.md` — modelo de conocimiento y niveles
- `docs/evaluacion-scripts.md` — auditoría técnica del indexer
- `docs/mejoras-catalogo-2026-07.md` — hardening (scoring, stale, etc.)

## Licencia

MIT — ver [LICENSE](./LICENSE).

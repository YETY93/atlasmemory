# atlasmemory

**Memoria Inteligente del Proyecto** para agentes de IA — **OpenCode** y **Claude Code**.

> **El agente consulta conocimiento, no redescubre el repositorio.**

Plantilla portable: se instala en un repo y genera un catálogo (componentes, capas, relaciones) para decidir **REUSE_EXISTING** vs **CREATE_NEW** antes de crear `*Data`, puertos `I*`, `*UC`, mappers o REST.

> ### ☕ Pensado para proyectos **Java**
>
> El **modelo de conocimiento** (componentes, relaciones, capacidades, reglas) es
> agnóstico de lenguaje, pero **la implementación actual solo indexa Java**:
>
> - El indexer recorre `*/src/main/java/**/*.java` (proyectos Maven multi-módulo).
> - Clasifica por convenciones **hexagonales**: `*Data`, `I*`, `*UC`, `*RS`, `@Entity`, `*Mapper`.
> - Los checklists de `CREATE_NEW` asumen Jakarta EE (`@Stateless`, `@Produces`, JPA).
>
> **En un proyecto que no sea Java, el catálogo saldrá vacío.** No es un bug: falta el
> *binding* de ese lenguaje. Soportar Kotlin, Go o TypeScript significa escribir un
> indexer nuevo — el resto (store, tools, MCP, skills) se reutiliza tal cual.
>
> Ver [Personalizar por proyecto](#personalizar-por-proyecto) y [QUICKSTART.md](./QUICKSTART.md).

No es un monorepo de negocio (p. ej. Clarisa): es solo la plantilla de memoria + indexer + tools.

## Qué resuelve

Cuando un agente necesita un adaptador o caso de uso, suele crearlo de cero aunque ya exista. atlasmemory indexa el código y expone tools para reutilizar lo existente.

## Compatibilidad

| Aspecto | Estado |
|---------|--------|
| **Lenguaje** | ☕ **Java** (Maven multi-módulo). Otros lenguajes: requieren indexer propio |
| **Arquitectura** | Hexagonal / ports & adapters. Otras: ajustar `atlasmemory.config.json` |
| **Clientes** | ✅ OpenCode · ✅ Claude Code (MCP) |
| **Sistema operativo** | ✅ Windows · ✅ Linux · ✅ macOS |
| **Dependencias** | Solo Node.js 18+ (sin `npm install`) |

## Arquitectura: un núcleo, dos clientes

Un solo indexer y un solo store, con un **binding de consulta por cliente**. Añadir un cliente nuevo es aditivo: no toca los existentes.

```text
        scripts/index-catalog.mjs          ← indexer (uno solo)
                    │
                    ▼
     .opencode/memory/catalog.json          ← store compartido (uno solo)
            │                    │
            ▼                    ▼
  .opencode/tools/catalog.ts    mcp/server.mjs
     (plugin OpenCode)         (servidor MCP → Claude Code)
```

| Pieza | OpenCode | Claude Code | Compartido |
|-------|----------|-------------|------------|
| Indexer | — | — | `scripts/index-catalog.mjs` |
| Store | — | — | `.opencode/memory/catalog.json` |
| Config | `.opencode/opencode.json` | `.mcp.json` | — |
| Tools | `.opencode/tools/catalog.ts` | `mcp/server.mjs` | — |
| Reglas | `AGENTS.md` | `CLAUDE.md` | — |
| Skill | `.opencode/skills/reuse-first/` | `.claude/skills/reuse-first/` | — |

Las tools son las mismas cinco en ambos clientes. En Claude Code llevan el prefijo del servidor MCP: `mcp__atlasmemory__catalog_exists`, etc.

> **Nota sobre el store:** `catalog.json` vive bajo `.opencode/memory/` por razones
> históricas (fue el primer binding), pero su contenido es **agnóstico de cliente** y
> lo consumen ambos. Renombrar esa ruta a algo neutro (`.atlasmemory/`) está previsto
> para una v2, porque tocaría los tres archivos a la vez.

## Requisitos

- Node.js 18+ (probado con 22) — sin `npm install`
- **OpenCode** con custom tools (`.opencode/tools/`), y/o **Claude Code** con MCP
- **Proyecto Java** con fuentes en `*/src/main/java/**/*.java` (Maven multi-módulo)

## Contenido

```text
atlasmemory/
├── README.md
├── QUICKSTART.md
├── LICENSE
├── install.mjs                    ← instalador cross-platform (Node)
├── install.sh                     ← wrapper Linux/macOS → install.mjs
├── AGENTS.md                      ← reglas (OpenCode)
├── CLAUDE.md                      ← reglas (Claude Code)
├── .mcp.json                      ← registro del servidor MCP
├── docs/
│   ├── arquetipo-catalogo-agente.md
│   ├── evaluacion-scripts.md
│   └── mejoras-catalogo-2026-07.md
├── scripts/
│   ├── index-catalog.mjs          ← compartido
│   └── smoke-catalog.mjs
├── mcp/
│   └── server.mjs                 ← binding Claude Code (sin dependencias)
├── .claude/
│   └── skills/reuse-first/SKILL.md
└── .opencode/
    ├── opencode.json
    ├── tools/catalog.ts           ← binding OpenCode
    ├── skills/reuse-first/SKILL.md
    └── memory/.gitignore
```

`catalog.json` **no** se versiona: se genera en cada proyecto destino.

## Instalación

```bash
git clone https://github.com/YETY93/atlasmemory.git
cd atlasmemory

# Cross-platform (Windows / Linux / macOS) — recomendado:
node install.mjs /ruta/al/proyecto
node install.mjs /ruta/al/proyecto --force   # sobrescribe

# Atajo en Linux/macOS (wrapper que llama a install.mjs):
./install.sh /ruta/al/proyecto
```

> El instalador es Node (mismo runtime que el resto). `install.sh` es solo un wrapper;
> en Windows usa `node install.mjs`.

Copia manual:

```bash
cp -r scripts .opencode .claude mcp .mcp.json AGENTS.md CLAUDE.md /ruta/al/proyecto/
# opcional: docs/
```

En el proyecto destino:

```bash
cd /ruta/al/proyecto
# 1. Editar AGENTS.md y CLAUDE.md (placeholders {{PROJECT_*}})
node scripts/index-catalog.mjs
node scripts/smoke-catalog.mjs

# 2a. OpenCode
opencode

# 2b. Claude Code — reinicia para que cargue .mcp.json y aprueba el servidor
claude
```

> `install.sh` **no sobrescribe** `AGENTS.md` ni `CLAUDE.md` si ya existen (salvo `--force`),
> para no pisar la documentación propia del proyecto destino.

## Tools

| Tool (OpenCode) | Tool (Claude Code) | Uso |
|------|------|-----|
| `catalog_exists` | `mcp__atlasmemory__catalog_exists` | **Siempre** antes de crear Data/port/UC/entity/mapper |
| `catalog_search` | `mcp__atlasmemory__catalog_search` | Explorar por nombre, método o tag |
| `catalog_get` | `mcp__atlasmemory__catalog_get` | Detalle + métodos |
| `catalog_related` | `mcp__atlasmemory__catalog_related` | implements / uses / produces / extends |
| `catalog_reindex` | `mcp__atlasmemory__catalog_reindex` | Tras cambios estructurales |

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
| `AGENTS.md` / `CLAUDE.md` | Descripción, build, invariantes (placeholders `{{PROJECT_*}}`) |
| `atlasmemory.config.json` | Checklists de `CREATE_NEW` a tus convenciones (ver abajo) |
| Tags en `index-catalog.mjs` | Opcional (`extractTags`) |

### Dos supuestos de Clarisa (importante para otros proyectos)

El arquetipo nace del binding Clarisa. Para **otro repo Clarisa** es copy-paste; para un
Java distinto hay que ajustar dos cosas:

1. **Indexer Java/Maven hexagonal.** `index-catalog.mjs` recorre `src/main/java` y clasifica
   por convenciones (`*Data`, `I*`, `*UC`, `*RS`, `@Entity`, `*Mapper`). Otro stack →
   editar el indexer.
2. **Checklists de `CREATE_NEW`.** Mencionan `CRUDData`, `emQuery/emCommand`, `tenant`,
   `@Produces`. Esto **sí es configurable sin tocar código**: copia
   `atlasmemory.config.example.json` como `atlasmemory.config.json` en la raíz y edita
   `createHints`. Ambos bindings lo leen; sin el archivo, usan los defaults de Clarisa.

Ver [QUICKSTART.md](./QUICKSTART.md) para el flujo de instalación paso a paso.

## Documentación

- `docs/arquetipo-catalogo-agente.md` — modelo de conocimiento y niveles
- `docs/evaluacion-scripts.md` — auditoría técnica del indexer
- `docs/mejoras-catalogo-2026-07.md` — hardening (scoring, stale, etc.)

## Licencia

MIT — ver [LICENSE](./LICENSE).

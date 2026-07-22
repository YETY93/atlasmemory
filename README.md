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
| **Alcance** | Nivel 1: un repo · Nivel 2: N repos ([workspace](#nivel-2-workspace-cross-repo)) |
| **Sistema operativo** | ✅ Windows · ✅ Linux · ✅ macOS |
| **Dependencias** | Solo Node.js 18+ (sin `npm install`) |

## Dos niveles

| Nivel | Qué responde | Instalador | Servidor MCP |
|-------|--------------|-----------|--------------|
| **1 — proyecto** | ¿Ya existe esto **en este repo**? | `install.mjs` | `atlasmemory` |
| **2 — workspace** | ¿Ya se resolvió **en un repo hermano**? | `install-workspace.mjs` | `atlasworkspace` |

El nivel 1 es la fuente de verdad y funciona solo. El nivel 2 es una vista de solo
lectura sobre N memorias de nivel 1 ya generadas, y es opcional.

Explicación completa de cómo encajan: **[docs/dos-niveles.md](./docs/dos-niveles.md)**.

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
├── install.mjs                    ← instalador nivel 1 (un repo)
├── install.sh                     ← wrapper Linux/macOS → install.mjs
├── install-workspace.mjs          ← instalador nivel 2 (cross-repo)
├── AGENTS.md                      ← reglas (OpenCode)
├── CLAUDE.md                      ← reglas (Claude Code)
├── .mcp.json                      ← registro del servidor MCP
├── docs/
│   ├── dos-niveles.md             ← cómo encajan nivel 1 y nivel 2
│   ├── arquetipo-catalogo-agente.md
│   ├── snippet-memoria.md
│   ├── evaluacion-scripts.md
│   └── mejoras-catalogo-2026-07.md
├── lib/
│   ├── catalog-engine.mjs         ← motor nivel 1 (compartido por los bindings)
│   └── workspace-engine.mjs       ← motor nivel 2
├── scripts/
│   ├── index-catalog.mjs          ← indexer Java (nivel 1)
│   ├── smoke-catalog.mjs
│   ├── index-workspace.mjs        ← agregador de catálogos (nivel 2)
│   └── smoke-workspace.mjs
├── mcp/
│   ├── server.mjs                 ← binding Claude Code, nivel 1
│   └── workspace-server.mjs       ← binding Claude Code, nivel 2
├── .claude/
│   └── skills/{reuse-first,precedent-first}/SKILL.md
└── .opencode/
    ├── opencode.json
    ├── tools/catalog.ts           ← binding OpenCode, nivel 1
    ├── tools/workspace.ts         ← binding OpenCode, nivel 2
    ├── skills/{reuse-first,precedent-first}/SKILL.md
    └── memory/.gitignore
```

Nada generado se versiona: ni `catalog.json` (nivel 1), ni `workspace-index.json` ni
`atlasmemory.workspace.json` (nivel 2). Se producen en cada destino.

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

## Nivel 2: workspace (cross-repo)

La memoria de nivel 1 vive dentro de un repo y no ve nada más. El **workspace** es una
vista de solo lectura sobre N memorias ya generadas, para responder *"¿esto ya se
resolvió en otro repo?"*.

```text
Github/
├── atlasmemory-workspace/
│   ├── atlasmemory.workspace.json    ← registry de proyectos
│   ├── mcp/workspace-server.mjs      ← binding Claude Code (server `atlasworkspace`)
│   ├── scripts/index-workspace.mjs
│   └── memory/workspace-index.json   ← índice liviano, generado
├── api-factura/     .opencode/memory/catalog.json   ← nivel 1, fuente de verdad
├── api-comun/       .opencode/memory/catalog.json
└── api-equivalente/ .opencode/memory/catalog.json
```

```bash
node install-workspace.mjs /ruta/a/la/carpeta/padre
cd /ruta/a/la/carpeta/padre/atlasmemory-workspace
node scripts/index-workspace.mjs
```

El instalador detecta los repos hermanos que ya tienen catálogo, escribe el registry, e
instala los bindings de consulta **tanto en el padre como en cada repo hijo**: registra
el servidor MCP (fusionando el `.mcp.json` sin tocar el `atlasmemory` local), copia el
plugin de OpenCode y las skills. Así, trabajando dentro de `api-factura` tenés las dos
capas a la vez: `mcp__atlasmemory__*` (local, autoritativa) y `mcp__atlasworkspace__*`
(cross-repo, consultiva). Con `--no-children` se instala solo en el padre.

| Tool | Uso |
|------|-----|
| `workspace_search` | ¿Existe algo así en otro proyecto? Devuelve hits etiquetados con `project` |
| `workspace_get` | Detalle completo de un componente ajeno, para estudiar cómo se implementó |
| `workspace_projects` | Proyectos registrados, conteos y frescura |
| `workspace_reindex` | Reconstruye el índice; con `project` reindexa antes ese repo desde Java |

Igual que en el nivel 1, las tools son las mismas en ambos clientes; en Claude Code
llevan el prefijo `mcp__atlasworkspace__`.

| Pieza | OpenCode | Claude Code | Compartido |
|-------|----------|-------------|------------|
| Motor | — | — | `lib/workspace-engine.mjs` |
| Índice | — | — | `memory/workspace-index.json` |
| Config | — | `.mcp.json` (padre + hijos) | `atlasmemory.workspace.json` |
| Tools | `.opencode/tools/workspace.ts` | `mcp/workspace-server.mjs` | — |
| Skill | `.opencode/skills/precedent-first/` | `.claude/skills/precedent-first/` | — |

El plugin de OpenCode se replica en cada root pero **no importa el motor de forma
estática**: la ruta relativa al workspace cambia entre el padre y los hijos, así que lo
resuelve en runtime (env `ATLASMEMORY_WORKSPACE`, o buscando `atlasmemory.workspace.json`
hacia arriba) y lo carga con `import()` dinámico. Un solo archivo sirve en los dos niveles.

### Precedente, no reuso

**El workspace nunca devuelve `REUSE_EXISTING`, devuelve `PRECEDENT_FOUND`.** Los repos
de un workspace suelen ser desplegables independientes sin dependencia Maven entre sí:
un componente de otro repo **no es importable**, y aconsejar reutilizarlo produciría
código que no compila. Lo que sirve es el patrón, no la clase.

El flujo es: `catalog_exists` local dice `CREATE_NEW` → `workspace_search` busca cómo se
resolvió en otro lado → `workspace_get` para ver el contrato → escribís tu versión.

Como efecto secundario, `workspace_search` agrupa los homónimos en
`sameNameInSeveralProjects` con sus `methodCounts`: si el mismo nombre existe en 4 repos
con distinta cantidad de métodos, esas copias divergieron.

### Decisiones de diseño

- **No re-parsea Java.** Agrega los `catalog.json` que cada repo ya genera. Si un
  proyecto no tiene catálogo, el índice lo reporta en vez de inventarlo.
- **Índice liviano.** Guarda nombres de métodos, no firmas: ~22% de lo que pesan los
  catálogos sumados. Las firmas se cargan bajo demanda en `workspace_get`.
- **Frescura barata.** Compara mtimes de los `catalog.json` hijos (N stats), no recorre
  los árboles `.java` de N repos en cada llamada.
- **El nivel 1 no cambia.** El binding local sigue siendo la fuente de verdad y funciona
  igual sin workspace instalado.

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

- **`docs/dos-niveles.md`** — cómo encajan nivel 1 y nivel 2, ciclo de vida, limitaciones
- `docs/arquetipo-catalogo-agente.md` — modelo de conocimiento y niveles
- `docs/snippet-memoria.md` — bloque para pegar en un `CLAUDE.md`/`AGENTS.md` existente
- `docs/evaluacion-scripts.md` — auditoría técnica del indexer
- `docs/mejoras-catalogo-2026-07.md` — hardening (scoring, stale, etc.)

## Licencia

MIT — ver [LICENSE](./LICENSE).

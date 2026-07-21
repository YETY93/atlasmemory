# CLAUDE.md — {{PROJECT_NAME}} (atlasmemory)

Memoria del proyecto para Claude Code.

> **El agente consulta conocimiento, no redescubre el repositorio.**

## Qué es

{{PROJECT_DESCRIPTION}}

## Build

```bash
{{BUILD_COMMANDS}}
```

Arquitectura y convenciones detalladas: ver `README.md` (y `AGENTS.md` para OpenCode).

## Memoria del proyecto (MCP `atlasmemory`)

Este repo expone su memoria vía un servidor MCP (`mcp/server.mjs`), registrado en
`.mcp.json`. Claude Code lo carga automáticamente y las tools aparecen con el prefijo
`mcp__atlasmemory__`:

| Tool (Claude Code) | Cuándo |
|--------------------|--------|
| `mcp__atlasmemory__catalog_exists` | **Siempre** antes de crear Data/port/UC/entity/mapper |
| `mcp__atlasmemory__catalog_search` | Explorar por nombre, método o tag |
| `mcp__atlasmemory__catalog_get` | Detalle + métodos de un componente |
| `mcp__atlasmemory__catalog_related` | Quién implementa / usa / produce / extends |
| `mcp__atlasmemory__catalog_reindex` | Tras cambios estructurales en el código |

Store compartido con OpenCode: `.opencode/memory/catalog.json`
(generado por `scripts/index-catalog.mjs`; el MCP lee el mismo archivo).

> Si una respuesta trae `stale: true`, el índice está desactualizado respecto a las
> fuentes `.java` → ejecuta `catalog_reindex` antes de confiar en el resultado.

## Reuse-first (obligatorio)

**Antes de crear** cualquier adaptador de persistencia (`*Data`), puerto (`I*`),
caso de uso (`*UC`), entidad, mapper o endpoint (`*RS`):

1. Llama a `catalog_exists` (o `catalog_search`) con el nombre candidato.
2. Si `advice` = `REUSE_EXISTING` → reutiliza o extiende el componente; **no** dupliques.
3. Si `advice` = `CREATE_NEW` → sigue el `createHint` / checklist de capas.
4. Tras crear o renombrar componentes relevantes → `catalog_reindex`.

Orden de creación si hace falta algo nuevo (hexagonal típico):

`port (I*)` → `adapter/data (*Data)` → `usecase (*UC)` → wiring (`UseCaseConfig` / DI) → `rest (*RS)`.

## Nomenclatura (ajustar al proyecto)

| Rol | Patrón típico |
|-----|----------------|
| Puerto | `I*` |
| Persistencia | `*Data` / `*Repository` |
| Caso de uso | `*UC` / `*Service` |
| REST | `*RS` / `*Controller` |
| DTO | `*Dto` |
| Entidad | `@Entity` |
| Mapper | `*Mapper` |

## Invariantes (ajustar al proyecto)

- Respetar capas y dirección de dependencias del proyecto.
- No inventar componentes que ya existen en la memoria.
- Tras cambios estructurales: reindexar.

## Primera instalación

```bash
node scripts/index-catalog.mjs      # genera la memoria
node scripts/smoke-catalog.mjs      # opcional
# reinicia Claude Code para que cargue .mcp.json, luego:
#   mcp__atlasmemory__catalog_exists  name=<AlgunaClase>
```

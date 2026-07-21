# AGENTS.md — {{PROJECT_NAME}}

Memoria del proyecto para agentes de IA.

> **El agente consulta conocimiento, no redescubre el repositorio.**

## Qué es

{{PROJECT_DESCRIPTION}}

## Build

```bash
{{BUILD_COMMANDS}}
```

Arquitectura y convenciones detalladas: ver `CLAUDE.md` y/o `README.md` si existen.

## Reuse-first (obligatorio)

**Antes de crear** cualquier adaptador de persistencia (`*Data`), puerto (`I*`), caso de uso (`*UC`), entidad, mapper o endpoint (`*RS`):

1. Llama a `catalog_exists` (o `catalog_search`) con el nombre candidato.
2. Si `advice` = `REUSE_EXISTING` → reutiliza o extiende el componente; **no** crees un duplicado.
3. Si `advice` = `CREATE_NEW` → sigue el `createHint` / checklist de capas.
4. Tras crear o renombrar componentes relevantes → `catalog_reindex`.

Orden de creación si hace falta algo nuevo (hexagonal típico):

`port (I*)` → `adapter/data (*Data)` → `usecase (*UC)` → wiring (`UseCaseConfig` / DI) → `rest (*RS)`.

## Tools de memoria

| Tool | Cuándo |
|------|--------|
| `catalog_exists` | **Siempre** antes de crear Data/port/UC/entity/mapper |
| `catalog_search` | Explorar por nombre, método o tag |
| `catalog_get` | Detalle + métodos de un componente |
| `catalog_related` | Quién implementa / usa / produce / extends |
| `catalog_reindex` | Tras cambios estructurales en el código |

Store: `.opencode/memory/catalog.json` (generado por `scripts/index-catalog.mjs`).

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

## Skill

Cargar skill `reuse-first` cuando la tarea implique crear o localizar persistencia, puertos o casos de uso.

## Primera instalación

```bash
node scripts/index-catalog.mjs
node scripts/smoke-catalog.mjs   # opcional
```

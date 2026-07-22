# Snippet para un `CLAUDE.md` existente

Si tu proyecto **ya tenía** un `CLAUDE.md`, el instalador **no lo modifica** (para no
pisar tu documentación). Copia el bloque de abajo y **pégalo al final** de tu
`CLAUDE.md` para que Claude Code sepa que existe la memoria y la consulte.

Ajusta la nomenclatura (`*Data`, `I*`, `*UC`, `*RS`) a la de tu proyecto si es distinta.

> Para `AGENTS.md` (OpenCode) es el mismo bloque, pero **sin** el prefijo
> `mcp__atlasmemory__` en los nombres de tools: `catalog_exists`, `catalog_search`, etc.

---

## ✂️ Copiar desde aquí

```markdown
## Project memory (atlasmemory)

> **El agente consulta conocimiento, no redescubre el repositorio.**

Este repo tiene una memoria indexada de sus componentes (puertos, adaptadores, casos
de uso, entidades, mappers, REST) y sus relaciones, expuesta vía el servidor MCP
`atlasmemory` (`mcp/server.mjs`, registrado en `.mcp.json`).

| Tool | Cuándo usarla |
|------|---------------|
| `mcp__atlasmemory__catalog_exists` | **Siempre**, antes de crear `*Data`, puerto `I*`, `*UC`, entidad o mapper |
| `mcp__atlasmemory__catalog_search` | Explorar por nombre, método o tag |
| `mcp__atlasmemory__catalog_get` | Detalle + métodos de un componente |
| `mcp__atlasmemory__catalog_related` | Quién implementa / usa / produce / extiende |
| `mcp__atlasmemory__catalog_reindex` | Tras cambios estructurales en el código |

Store: `.opencode/memory/catalog.json`, generado por `scripts/index-catalog.mjs`.

### Reuse-first (obligatorio)

Antes de crear un adaptador de persistencia (`*Data`), puerto (`I*`), caso de uso
(`*UC`), entidad, mapper o endpoint (`*RS`):

1. Llama a `catalog_exists` con el nombre candidato.
2. `advice = REUSE_EXISTING` → reutiliza o extiende; **no** crees un duplicado.
3. `advice = CREATE_NEW` → sigue el `createHint` devuelto.
4. Tras crear o renombrar componentes → `catalog_reindex`.

Orden de creación cuando algo nuevo hace falta de verdad:
`port (I*)` → `adapter/data (*Data)` → `usecase (*UC)` → wiring DI → `rest (*RS)`.

**Interpretar la respuesta:**
- `REUSE_EXISTING` solo se devuelve con **match exacto** de nombre.
- `CREATE_NEW` con `nearMisses` significa "nada coincide exactamente", **no** "no hay
  nada parecido" — revisa los `nearMisses` antes de crear.
- Si la respuesta trae `stale: true`, el índice está desactualizado respecto a las
  fuentes: ejecuta `catalog_reindex` antes de confiar en el resultado.
```

## ✂️ Hasta aquí

---

# Bloque extra: si además instalaste el workspace (nivel 2)

Pegá esto **después** del bloque anterior, solo en los repos que forman parte de un
workspace cross-repo.

## ✂️ Copiar desde aquí

```markdown
### Precedente cross-repo (workspace)

Este repo forma parte de un workspace de atlasmemory: hay un segundo servidor MCP
(`atlasworkspace`) que ve las memorias de los repos hermanos.

| Tool | Cuándo usarla |
|------|---------------|
| `mcp__atlasworkspace__workspace_search` | Cuando `catalog_exists` local devuelve `CREATE_NEW` |
| `mcp__atlasworkspace__workspace_get` | Ver cómo se implementó en el otro repo |
| `mcp__atlasworkspace__workspace_projects` | Qué repos entran y si el índice está fresco |
| `mcp__atlasworkspace__workspace_reindex` | Tras reindexar algún repo |

**Precedente, no reuso.** El workspace nunca devuelve `REUSE_EXISTING`, devuelve
`PRECEDENT_FOUND`: los repos no dependen entre sí por Maven, así que un componente ajeno
**no es importable**. Lo que traés es el patrón (qué puertos usó, cómo dividió capas,
qué métodos expuso), no la clase. Si sí existe dependencia Maven entre los dos repos,
entonces es reuso de verdad: importalo en vez de duplicarlo.

Orden obligatorio: **primero la memoria local** (autoridad), después el workspace
(consultivo). Si `catalog_exists` dice `REUSE_EXISTING`, no consultes el workspace.

Buscá por el concepto de dominio pelado (`DocumentoEquivalente`), no por el nombre
completo del candidato: el scoring es por substring y `IDocEquivalentePosData` no
encuentra `DocEquivalentePosData`.
```

## ✂️ Hasta aquí

---
name: precedent-first
description: >
  Cuando la memoria local dice CREATE_NEW, consulta el workspace cross-repo
  (mcp__atlasworkspace__workspace_search / workspace_get) para ver si el mismo
  problema ya se resolvió en un repo hermano y copiar ese patrón. Usar al crear
  puertos I*, adaptadores *Data, casos de uso *UC, mappers o endpoints en un
  proyecto que forma parte de un workspace de atlasmemory.
---

# Precedent-first (Claude Code)

## Objetivo

Que un componente nuevo se parezca a cómo el equipo ya resolvió lo mismo en otro
repo, en vez de inventar una tercera forma.

Esta skill es el **paso siguiente** a [reuse-first], no su reemplazo:

```
catalog_exists (local)  →  REUSE_EXISTING  →  reutilizás, fin. El workspace no se toca.
                        →  CREATE_NEW      →  workspace_search: ¿hay precedente?
```

## Precedente ≠ reuso (lo más importante)

Los repos de un workspace suelen ser **desplegables independientes sin dependencia
Maven entre sí**. Un componente de otro proyecto **no se puede importar**: si escribís
`import co.clarisa.api.comun.ad.data.CiudadData` desde `factura`, no compila.

Por eso el workspace nunca devuelve `REUSE_EXISTING`, devuelve `PRECEDENT_FOUND`.
Lo que traés del otro repo es **el patrón**: qué puertos usó, cómo dividió las capas,
qué métodos expuso, cómo nombró las cosas. No la clase.

**Antes de copiar, verificá si existe dependencia Maven real entre los dos repos.**
Si existe, es reuso de verdad y hay que importarlo, no duplicarlo. Si no existe —el
caso normal— escribís tu propia versión siguiendo el patrón.

## Tools (servidor MCP `atlasworkspace`)

| Tool | Uso |
|------|-----|
| `mcp__atlasworkspace__workspace_search` | ¿Existe algo así en otro proyecto? |
| `mcp__atlasworkspace__workspace_get` | Detalle completo de un componente ajeno |
| `mcp__atlasworkspace__workspace_projects` | Proyectos registrados y frescura |
| `mcp__atlasworkspace__workspace_reindex` | Reconstruir el índice |

Si el servidor no aparece, revisá el `.mcp.json` del repo y reiniciá Claude Code.

## Pasos

1. **Primero lo local.** `catalog_exists` en la memoria del proyecto. Si dice
   `REUSE_EXISTING`, terminaste: no consultes el workspace.
2. **Buscar precedente.** `workspace_search` con el concepto de dominio, no con el
   nombre completo del candidato.
3. **Estudiar el mejor candidato.** `workspace_get` con `name` + `project` para ver
   métodos, anotaciones y —clave— `uses`: los puertos de los que depende. Eso te dice
   qué contratos vas a necesitar de tu lado.
4. **Abrir el archivo real** si el patrón importa. El campo `path` del resultado es
   relativo a la raíz de ese proyecto.
5. **Escribir tu versión** siguiendo el `createHint` local y el patrón encontrado.
6. **Cerrar.** `catalog_reindex` local; `workspace_reindex` si querés que el nuevo
   componente aparezca como precedente para los demás repos.

## Buscar bien

El scoring es por substring, igual que el local. **Un nombre compuesto no encuentra
sus partes**: `workspace_search query=IFacturaSaludData` no devuelve `IFacturaData`.

Buscá por el **concepto de dominio pelado**, y si hace falta filtrá por `kind`:

- ✅ `query=DocumentoEquivalente kind=usecase`
- ✅ `query=Contingencia`
- ❌ `query=IDocumentoEquivalenteSaludData`

También podés buscar por **nombre de método**: si un componente ajeno tiene un método
que se llama como el que necesitás, aparece con score 0.6 y `methodHits`.

## Interpretar la respuesta

- **`PRECEDENT_FOUND`** — hay componentes parecidos en otros repos. Mirá `project` y
  `path` de cada uno antes de elegir.
- **`NO_MATCH`** — nadie lo resolvió antes. Creá siguiendo solo el `createHint` local.
- **`sameNameInSeveralProjects`** — el mismo nombre existe en varios repos. Si los
  `methodCounts` difieren, esas copias **divergieron**: elegí conscientemente cuál
  seguir y mencionáselo al dev. Si coinciden, no está probado que sean iguales.
- **`staleProjects`** — esos repos cambiaron después de construirse el índice.
  `workspace_reindex` antes de confiar.

## No hacer

- Consultar el workspace **antes** que la memoria local: la local es la autoridad.
- Tratar un hit cross-repo como importable sin verificar la dependencia Maven.
- Copiar una clase entera sin adaptarla a los puertos y capas de tu proyecto.
- Elegir entre copias divergentes en silencio.

## Referencias

- Skill `reuse-first` — el paso previo, dentro del propio repo
- `CLAUDE.md` — reglas e invariantes del proyecto
- `atlasmemory-workspace/atlasmemory.workspace.json` — qué repos entran

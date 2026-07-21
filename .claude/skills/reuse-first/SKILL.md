---
name: reuse-first
description: >
  Antes de crear puertos I*, adaptadores *Data/*Repository, casos de uso *UC,
  entidades, mappers o endpoints, consulta la memoria del proyecto
  (mcp__atlasmemory__catalog_exists / catalog_search) y reutiliza componentes
  existentes. Usar siempre que se pida nueva persistencia, un Data, un
  repositorio, un puerto, o se sospeche código duplicado.
---

# Reuse-first (Claude Code)

## Objetivo

Evolucionar el código existente. No redescubrir el repositorio ni inventar
segundos adaptadores / puertos para la misma responsabilidad.

> El agente consulta conocimiento, no redescubre el repositorio.

## Tools (servidor MCP `atlasmemory`)

| Tool | Uso |
|------|-----|
| `mcp__atlasmemory__catalog_exists` | **Siempre** antes de crear Data/port/UC/entity/mapper |
| `mcp__atlasmemory__catalog_search` | Explorar por nombre, método o tag |
| `mcp__atlasmemory__catalog_get` | Detalle + métodos de un componente |
| `mcp__atlasmemory__catalog_related` | implements / uses / produces / extends |
| `mcp__atlasmemory__catalog_reindex` | Tras cambios estructurales |

Si el servidor no aparece, revisa `.mcp.json` y reinicia Claude Code.

## Pasos

1. **Identificar** el tipo de componente (`port`, `data`, `usecase`, `entity`, `mapper`, `rest`).
2. **Proponer un nombre** candidato según la nomenclatura del proyecto.
3. **Consultar memoria** — `catalog_exists` con ese nombre (y `kind` si se conoce).
   Si hay dudas, `catalog_search` con un fragmento de dominio.
4. **Verificar frescura** — si la respuesta trae `stale: true`, ejecuta
   `catalog_reindex` **antes** de decidir. Un índice viejo puede afirmar que algo
   no existe cuando ya se creó.
5. **Si `REUSE_EXISTING`**
   - `catalog_get` y/o `catalog_related` para ver el contrato real.
   - Reutilizar el puerto/implementación existente.
   - Solo **extender** métodos si falta capacidad.
   - No crear una clase paralela con otro nombre para lo mismo.
6. **Si `CREATE_NEW`**
   - Seguir `impact.createHint.checklist` que devuelve la tool.
   - Orden típico: **port → data → UC → wiring DI → endpoint**.
7. **Cerrar** — `catalog_reindex` si se crearon o renombraron componentes.

## Interpretar la respuesta

- **`REUSE_EXISTING`** se devuelve **solo con match exacto de nombre**. Es una
  afirmación fuerte: existe ese componente.
- **`CREATE_NEW` con `nearMisses`** no significa "no hay nada parecido": significa
  que **nada coincide exactamente**. Revisa los `nearMisses` antes de crear — puede
  haber un componente con otro nombre que cubra la misma responsabilidad.
- **`CREATE_NEW` sin `nearMisses`** es la señal más limpia para crear.
- Un sufijo compartido (`...Data`, `...Dto`) **no** es evidencia de equivalencia; el
  scoring lo penaliza a propósito para no recomendar reutilizar el componente
  equivocado.

## Al reutilizar: revisar el contrato antes de asumirlo

Cuando un `*Data` existe, **compara sus métodos con los del puerto `I*`** que
implementa (`catalog_get` sobre ambos, o `catalog_related`):

- Si el adaptador expone métodos públicos que **no están declarados en el puerto**,
  un caso de uso **no puede** invocarlos: primero hay que declararlos en el puerto.
- Reportar ese hueco es parte del trabajo; no lo resuelvas creando un segundo
  adaptador.

## No hacer

- Crear `*Data` / repositorio sin haber llamado a `catalog_exists`.
- Tratar un `nearMiss` como si fuera un match exacto.
- Confiar en un catálogo `stale` sin reindexar.
- Violar las capas del proyecto (use-case conociendo REST o JPA directo si el
  proyecto lo prohíbe).
- Ignorar relaciones `implements` / `extends` / `uses` ya indexadas.

## Referencias

- `CLAUDE.md` — reglas del proyecto e invariantes
- `README.md` — arquitectura
- `docs/arquetipo-catalogo-agente.md` — modelo de conocimiento (si se copió)

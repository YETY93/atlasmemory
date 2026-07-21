---
name: reuse-first
description: >
  Antes de crear puertos I*, adaptadores *Data/*Repository, casos de uso *UC,
  entidades, mappers o endpoints, consulta la memoria del proyecto
  (catalog_exists / catalog_search) y reutiliza componentes existentes.
  Usar siempre que se pida nueva persistencia, un Data, un repositorio,
  un puerto o se sospeche código duplicado.
---

# Reuse-first

## Objetivo

Evolucionar el código existente. No redescubrir el repositorio ni inventar
segundos adaptadores / puertos para la misma responsabilidad.

> El agente consulta conocimiento, no redescubre el repositorio.

## Pasos

1. **Identificar** el tipo de componente (`port`, `data`, `usecase`, `entity`, `mapper`, `rest`).
2. **Proponer un nombre** candidato según la nomenclatura del proyecto.
3. **Consultar memoria**
   - `catalog_exists` con ese nombre (y `kind` si se conoce).
   - Si hay dudas, `catalog_search` con fragmento de dominio.
4. **Si `REUSE_EXISTING`**
   - `catalog_get` y/o `catalog_related`.
   - Reutilizar el puerto/implementación.
   - Solo **extender** métodos si falta capacidad.
   - No crear una clase paralela con otro nombre para lo mismo.
5. **Si `CREATE_NEW`**
   - Seguir `impact.createHint.checklist`.
   - Orden típico: **port → data → UC → wiring DI → endpoint**.
6. **Cerrar**
   - `catalog_reindex` si se crearon o renombraron componentes.

## No hacer

- Crear `*Data` / repositorio sin haber llamado a `catalog_exists`.
- Violar las capas del proyecto (p. ej. use-case conociendo REST o JPA directo si el proyecto lo prohíbe).
- Ignorar relaciones `implements` / `extends` / `uses` ya indexadas.

## Referencias

- `AGENTS.md` — reglas del proyecto
- `CLAUDE.md` / `README.md` — arquitectura
- `docs/arquetipo-catalogo-agente.md` — modelo de conocimiento (si se copió)

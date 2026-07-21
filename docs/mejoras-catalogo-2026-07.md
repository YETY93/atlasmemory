# Mejoras de catálogo (2026-07-21)

Plantilla pública: atlasmemory.

Aplicación en plantilla de `evaluacion-scripts.md` (cambios 1–7).

| Área | Cambio |
|------|--------|
| `catalog_exists` | REUSE solo con match exacto (`name ===`); nearMisses sin auto-promover |
| `scoreMatch` | startsWith 0.8; endsWith 0.75 / 0.4 si sufijo genérico; includes 0.7 |
| Staleness | `newestJavaMtime` vs `generatedAt` → `stale` + `staleReason` |
| Robustez | cache por mtime; try/catch en JSON.parse; `methodsTruncated` en summarize |
| `catalog_related` | descripción sin `injects` (aún no se emite) |
| Indexer | CTRL keywords en métodos; cap 80 con flag; sin aliases `artifacts`/`edges` |
| Relations | unresolved con un solo `add` |

Re-propagar a proyectos con `install.sh --force` + reindex.

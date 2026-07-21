# Evaluación técnica de los scripts de Memoria Inteligente

> Auditoría de ingeniería de memorias de agente sobre los scripts del arquetipo.
> Basada en **evidencia real**: ejecución del indexer sobre
> `clarisa-back-api-factura` (455 archivos Java) y auditoría del `catalog.json` generado.

| Campo | Valor |
|-------|-------|
| Fecha | 2026-07-21 |
| Proyecto base | `memory-arquetipo` (plantilla) |
| Proyecto piloto auditado | `clarisa-back-api-factura` |
| Evidencia | 455 archivos → 457 componentes, 256 relaciones, 0 crashes |
| Alcance | `index-catalog.mjs`, `catalog.ts`, `smoke-catalog.mjs` |

---

## 1. Veredicto general

Sólido MVP, bien fundamentado en producto, pero con **3 defectos que atacan
directamente la propuesta de valor** ("no duplicar / reutilizar bien").

El indexer corrió limpio sobre un repo real. La detección de módulos y capas salió
**perfecta**. El problema no es que no funcione: es que en varios puntos **da
consejos con exceso de confianza** sin señalar su propia incertidumbre.

| Artefacto | Nota | Estado |
|-----------|------|--------|
| `index-catalog.mjs` | 7/10 | Funciona, ruido controlable |
| `catalog.ts` (tools) | 6/10 | Falso-positivo REUSE es serio |
| `smoke-catalog.mjs` | 7/10 | Correcto, duplicación menor |
| Modelo / docs | 9/10 | Excelente separación modelo / binding / store |

### Evidencia de la corrida

```text
fileCount:        455
artifactCount:    457
relationCount:    256
kindCounts:       dto=198, enum=50, util=41, other=37, port=32, usecase=23,
                  entity=17, mapper=16, data=14, bean=12, rest=12, exception=4, config=1
por módulo:       domain=302, ejb=67, usecase=64, web=24
por layer:        domain=302, ejb=67, usecase=64, web=24   (1:1, correcto)
relaciones:       implements=72, extends=45, produces=21, uses=118, injects=0
unresolved:       50 / 256  (20%)
catalog.json:     1.9 MB
```

---

## 2. Lo que está bien (no tocar)

- **Detección de módulos/capas impecable** — layers 1:1 con módulos Maven. El uso
  consistente de `path.sep` hace que funcione en Windows.
- **Cobertura de `kind`** — 457 componentes clasificados; `other` solo 8%.
- **Robustez** — captura de errores por archivo, `stripComments` preserva líneas,
  brace-matching best-effort. No se cae con 455 archivos.
- **Documento rector (Parte B)** — separación real modelo / binding / store.

---

## 3. Cambios propuestos (con justificación)

Cada cambio incluye: **problema**, **evidencia**, **causa raíz**, **solución** y
**por qué importa**. Ordenados por prioridad.

---

### 🔴 CAMBIO 1 — Eliminar el falso-positivo REUSE (prioridad máxima)

**Archivo:** `.opencode/tools/catalog.ts` — función `scoreMatch` + `exists`

**Problema.** El scoring asigna `0.85` a **cualquier** prefijo o sufijo, y `exists()`
**auto-promueve a match** cuando `score >= 0.85`. Esto produce consejos
`REUSE_EXISTING` apuntando al componente equivocado.

**Evidencia (datos reales del piloto):**

```text
catalog_exists("DocumentoData")  →  REUSE_EXISTING → ConsecutivoDocumentoData
catalog_exists("Factura")        →  match ambiguo: Factura / FacturaData / RespuestaDianFactura
```

`ConsecutivoDocumentoData` **no es** un `DocumentoData`: solo termina igual. El
sufijo `Data` es un ruido casi universal en este dominio.

**Causa raíz.**

```js
// scoreMatch: prefijo/sufijo con el mismo peso que un match casi exacto
else if (name.startsWith(q) || name.endsWith(q)) score = 0.85
// exists: auto-promueve sin verificar kind ni longitud del solapamiento
if (ranked.length && ranked[0].score >= 0.85) match = ranked[0].c
```

**Solución.**

1. **Solo auto-promover con match exacto (`score === 1.0`).** Un `0.85` deja de ser
   `match` y pasa a `nearMisses`, forzando al agente a revisar en vez de asumir.
2. **Penalizar sufijos de rol genéricos** (`Data`, `Dto`, `UC`, `RS`, `Mapper`) en el
   scoring por sufijo: si lo único que coincide es el sufijo de rol, no es señal.
3. **Exigir coincidencia de `kind`** cuando se pasa `kind` para elevar por encima de
   0.7.

```js
const GENERIC_SUFFIXES = ["data", "dto", "uc", "rs", "mapper", "bean", "enum"]
function suffixIsGeneric(name, q) {
  return GENERIC_SUFFIXES.some((s) => name.endsWith(s) && q.endsWith(s) && !name.startsWith(q.slice(0, -s.length)))
}
// en scoreMatch:
else if (name.startsWith(q)) score = 0.8
else if (name.endsWith(q)) score = suffixIsGeneric(name, q) ? 0.4 : 0.75
// en exists: auto-match SOLO exacto
if (exact.length) match = exact[0]
// prefijo/sufijo nunca se auto-promueve: va a nearMisses
```

**Por qué importa.** Es exactamente el fallo que el producto quiere prevenir,
**invertido**: en vez de evitar duplicados, disuade de crear lo que hace falta o
manda a reutilizar el adaptador equivocado. Corromper la decisión REUSE/CREATE
destruye la confianza del agente en toda la memoria.

---

### 🔴 CAMBIO 2 — Cablear la detección de staleness (índice desactualizado)

**Archivo:** `.opencode/tools/catalog.ts` — `loadCatalog`; y `scripts/index-catalog.mjs`

**Problema.** `contentHash` se calcula y guarda en `meta.json`, y el documento lo
vende como mitigación del riesgo "índice desactualizado". Pero **nadie lo recomputa
ni compara**: `loadCatalog` siempre devuelve `stale: false`.

**Evidencia.** El campo `meta.contentHash` existe
(`sha256:1554d839...`) pero `catalog.ts` no lo lee para comparar; la única condición
de `stale` es "el archivo no existe".

**Causa raíz.** El ciclo de vida del doc (Descubrir → … → **Actualización**) no está
implementado en la capa de consulta. La frescura depende 100% de disciplina humana.

**Solución (barata: mtime; robusta: hash).**

- **Opción barata (recomendada para MVP):** comparar el `mtime` más reciente de
  `**/src/main/java/**/*.java` contra `meta.generatedAt`. Si algún fuente es más
  nuevo → `stale: true` + `advice` degradado sugiriendo `catalog_reindex`.
- **Opción robusta:** recomputar `contentHash` y comparar (más caro en I/O).

```js
// loadCatalog, tras leer meta:
const newest = newestJavaMtime(root)            // walk rápido solo de mtimes
const stale = newest && metaData?.generatedAt && newest > Date.parse(metaData.generatedAt)
return { ..., stale, staleReason: stale ? "hay fuentes .java más nuevos que el índice" : null }
```

**Por qué importa.** Sin esto, el agente puede consultar datos viejos **sin ninguna
señal** tras modificar código. Un `REUSE_EXISTING` sobre un componente ya borrado, o
un `CREATE_NEW` sobre algo recién creado, son fallos silenciosos que erosionan la
confianza.

---

### 🟠 CAMBIO 3 — Filtrar keywords de control como nombres de método

**Archivo:** `scripts/index-catalog.mjs` — `extractMethods`

**Problema.** Aparecen métodos-fantasma en el catálogo cuando el regex confunde
sentencias de control con firmas.

**Evidencia (20 casos reales):**

```text
CalculadoraDocumento.switch   XmlNacUC.return      ComunUtil.return
InvoiceMapper.switch          TributoItemDto.return  ConversorNumericoUtil.switch
EstadoDocumentoUC.switch      SeguridadFiltro.return ...
```

**Causa raíz.** El filtro valida el `returnType` contra keywords, pero al chequear el
**nombre** solo mira `if/for/while`:

```js
if (name === "if" || name === "for" || name === "while") continue;  // incompleto
```

Se le escapan `switch`, `return`, `catch`, `else`, `synchronized`, `instanceof`.

**Solución.**

```js
const CTRL = new Set(["if","for","while","switch","catch","return","new",
                      "throw","else","synchronized","instanceof","do","try"])
if (CTRL.has(name)) continue;
```

**Por qué importa.** Aunque son solo 20 sobre miles, contaminan `catalog_get` y el
scoring por método (`methodHits`), dando la impresión de una API que no existe.

---

### 🟠 CAMBIO 4 — Emitir `injects` o quitarlo del contrato

**Archivos:** `.opencode/tools/catalog.ts` (descripción de `catalog_related`);
`scripts/index-catalog.mjs` (`buildRelations`)

**Problema.** La descripción de `catalog_related` promete relaciones `injects`, el
modelo las lista como canónicas… y el catálogo real tiene **`injects: 0`**.

**Evidencia.** Solo se emiten `uses` (118), `implements` (72), `extends` (45),
`produces` (21). Cero `injects`.

**Causa raíz.** No hay extracción de inyección por campo (`@Inject`); las
dependencias solo se leen del constructor de `*UC` y se etiquetan como `uses`.

**Solución (elegir una):**

- **A (honestidad, barata):** quitar `injects` de la descripción de la tool y del
  contrato hasta implementarlo.
- **B (implementarlo):** en `parseJavaFile`, detectar campos `@Inject`/`@EJB` y
  emitir relación `injects` from-componente → to-tipo.

**Por qué importa.** Un contrato que promete datos inexistentes hace que el agente
consulte algo que siempre vuelve vacío y pierda confianza en la tool.

---

### 🟠 CAMBIO 5 — Señalar truncamiento en el cap de 80 métodos

**Archivo:** `scripts/index-catalog.mjs` — `extractMethods` / `parseJavaFile`

**Problema.** El corte `if (methods.length >= 80) break` trunca **en silencio**.

**Evidencia.** `ValidarUtil` quedó con exactamente 80 métodos; el agente no sabe que
hay más.

**Solución.** Devolver una bandera y exponerla en `summarize`/`get`:

```js
// extractMethods retorna { methods, truncated }
const truncated = methods.length >= 80
// componente:
methodsTruncated: truncated
```

**Por qué importa.** El agente cree ver la interfaz completa cuando no. Peor en
utilidades grandes, que son justo las que más se quieren reutilizar.

---

### 🟡 CAMBIO 6 — Eliminar alias duplicados y cachear el catálogo

**Archivos:** `scripts/index-catalog.mjs` (escritura); `.opencode/tools/catalog.ts`
(lectura)

**Problema.** El `catalog.json` pesa **1.9 MB** porque duplica todo: `components` +
`artifacts` y `relations` + `edges` son alias idénticos "de transición". Además
`catalog.ts` **re-lee y re-parsea 1.9 MB en cada llamada**, sin cache.

**Causa raíz.**

```js
artifacts: slimComponents,   // duplica ~950 KB
edges: relations,            // duplica relaciones
```

**Solución.**

1. Eliminar los alias `artifacts`/`edges`. Mantener solo `components`/`relations`
   (el modelo rector ya los prefiere). El lector ya hace fallback, así que no rompe.
2. Cachear en `catalog.ts` por `mtime` del archivo: recargar solo si cambió.

**Por qué importa.** ~950 KB menos por proyecto y menos parseo por llamada. A escala
piloto pasa el objetivo <100 ms, pero es deuda innecesaria que crece con el repo.

---

### 🟡 CAMBIO 7 — Endurecer `loadCatalog` ante catálogo corrupto

**Archivo:** `.opencode/tools/catalog.ts` — `loadCatalog`

**Problema.** `JSON.parse(fs.readFileSync(...))` sin `try/catch`. Un `catalog.json`
corrupto (reindex interrumpido) **tumba la tool** en vez de devolver el error amable.

**Solución.**

```js
let data
try { data = JSON.parse(fs.readFileSync(catalog, "utf8")) }
catch (e) { return { error: `Catálogo ilegible: ${e.message}. Ejecuta catalog_reindex.`, stale: true, components: [], relations: [], indexes: {}, meta: null } }
```

**Por qué importa.** Convierte un crash en un mensaje accionable que el agente sabe
resolver (`reindex`).

---

## 4. Higiene menor (opcional)

| Ítem | Archivo | Acción |
|------|---------|--------|
| Código muerto `add → pop → add` | `index-catalog.mjs` `buildRelations` (~L362) | Simplificar a un solo `add(unresolved)` |
| `scoreMatch` duplicado (smoke + tool, versiones distintas) | ambos | Extraer a módulo compartido; evita drift |
| `uses` solo desde constructor de UC | `index-catalog.mjs` | Documentar como limitación conocida |
| 20% relaciones `unresolved` (cross-módulo) | — | Documentar: "sin relación" ≠ "nadie lo usa" |

---

## 5. Plan de aplicación sugerido

| Fase | Cambios | Dónde primero | Criterio de hecho |
|------|---------|---------------|-------------------|
| **1 — Núcleo** | 1, 2, 3 | Plantilla `memory-arquetipo` | `exists("DocumentoData")` ya **no** da REUSE de `ConsecutivoDocumentoData`; `stale:true` al tocar fuentes; 0 métodos-keyword |
| **2 — Contrato** | 4, 5 | Plantilla | `injects` coherente doc↔código; `methodsTruncated` visible |
| **3 — Deuda** | 6, 7 | Plantilla | `catalog.json` < 1 MB; catálogo corrupto no crashea |
| **4 — Propagación** | todos | `install.sh --force` a repos aplicados | `clarisa-back-api-factura` reindexado y validado |

> **Recomendación:** aplicar en la **plantilla** primero para que todo proyecto nuevo
> herede los arreglos, y luego re-propagar a `clarisa-back-api-factura` con
> `install.sh --force` + `catalog_reindex`.

---

## 6. Conclusión

La **arquitectura de conocimiento** es la parte fuerte y está lista para crecer a los
niveles 4–7. La debilidad está en la **capa de scoring/evaluación** (`catalog.ts`),
que es precisamente donde el agente toma la decisión REUSE vs CREATE.

Con los cambios **1–3** este MVP pasa de "buena demo" a "confiable en producción".
Los cambios 4–7 son endurecimiento y deuda técnica.

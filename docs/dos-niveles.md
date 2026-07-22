# Los dos niveles de atlasmemory

Cómo funciona la herramienta después de agregar la vista cross-repo: qué es cada
pieza, de dónde sale, para qué sirve y qué pasa con lo que ya existía.

---

## Lo primero: tres cosas se llaman "atlasmemory"

Es la principal fuente de confusión. Son tres cosas distintas.

| Nombre | Qué es | Vive en | ¿Git? |
|--------|--------|---------|-------|
| `atlasmemory/` | **El producto.** Plantilla, instaladores, docs | Donde lo clonaste | Sí, repo con remote |
| `atlasmemory` | **El servidor MCP local** de un repo (nivel 1) | Dentro de cada proyecto | No, es un proceso |
| `atlasmemory-workspace/` | **La instancia cross-repo** (nivel 2) | Carpeta padre de tus repos | No, es estado local |

La relación entre ellas es siempre la misma: **`atlasmemory/` es el molde, lo demás son
copias instaladas**. Tocar el molde no cambia las copias; hay que reinstalar.

---

## Nivel 1 — memoria de un proyecto

Lo que ya existía. Un repo, su propio índice, su propio servidor.

```text
mi-proyecto/
├── scripts/index-catalog.mjs        ← lee */src/main/java/**/*.java
│         │
│         ▼
├── .opencode/memory/catalog.json    ← store (generado, no se versiona)
│         │                    │
│         ▼                    ▼
├── .opencode/tools/catalog.ts   mcp/server.mjs
│    (plugin OpenCode)          (servidor MCP `atlasmemory`)
└── lib/catalog-engine.mjs           ← motor compartido por ambos bindings
```

**Para qué sirve:** que el agente no cree un `*Data` que ya existe. Antes de escribir
un puerto, un adaptador o un caso de uso, pregunta al catálogo.

**Su respuesta clave** es `catalog_exists`:

- `REUSE_EXISTING` — existe con ese nombre exacto. Reutilizalo.
- `CREATE_NEW` — no existe. Creá siguiendo el checklist.

`REUSE_EXISTING` solo sale con **match exacto de nombre**. Un sufijo compartido
(`...Data`, `...Dto`) no es evidencia de equivalencia y el scoring lo penaliza a
propósito, para no recomendar reutilizar el componente equivocado.

**El límite:** un repo no ve nada fuera de sí mismo.

---

## Nivel 2 — workspace cross-repo

### De dónde sale

No existe hasta que lo creás. Lo genera un instalador aparte:

```bash
cd atlasmemory
node install-workspace.mjs /ruta/a/la/carpeta/padre
```

Ese comando:

1. Crea `<padre>/atlasmemory-workspace/` con el motor, el servidor MCP y los scripts.
2. **Detecta los repos hermanos que ya tienen memoria de nivel 1** y escribe el registry
   (`atlasmemory.workspace.json`). Los que no tienen catálogo no entran.
3. Instala los bindings de consulta en el padre **y en cada repo hijo**: registra el
   servidor MCP fusionando el `.mcp.json` (sin tocar el `atlasmemory` local), copia el
   plugin de OpenCode y las skills.

Después hay que construir el índice una vez:

```bash
cd <padre>/atlasmemory-workspace
node scripts/index-workspace.mjs
```

### Qué queda

```text
Github/                                    ← la carpeta padre
├── atlasmemory-workspace/
│   ├── atlasmemory.workspace.json         ← qué repos entran (editable)
│   ├── memory/workspace-index.json        ← índice liviano (generado)
│   ├── lib/workspace-engine.mjs
│   ├── mcp/workspace-server.mjs           ← servidor MCP `atlasworkspace`
│   └── scripts/{index,smoke}-workspace.mjs
├── api-factura/       .opencode/memory/catalog.json   ← nivel 1: fuente de verdad
├── api-comun/         .opencode/memory/catalog.json
├── api-equivalente/   .opencode/memory/catalog.json
└── api/               .opencode/memory/catalog.json
```

### Para qué sirve

Para responder **"¿esto ya se resolvió en otro repo?"** cuando el nivel 1 dice
`CREATE_NEW`.

```text
catalog_exists (local)  →  REUSE_EXISTING  →  reutilizás. El workspace no se toca.
                        →  CREATE_NEW      →  workspace_search: ¿hay precedente?
```

### Precedente, no reuso

**Esta es la decisión de diseño central.** El workspace nunca devuelve
`REUSE_EXISTING`; devuelve `PRECEDENT_FOUND`.

Motivo: los repos de un workspace suelen ser **desplegables independientes sin
dependencia Maven entre sí**. Un componente de otro repo **no se puede importar**.
Recomendarlo como reutilizable produciría código que no compila.

Lo que traés del otro repo es el **patrón**: qué puertos usó, cómo dividió las capas,
qué métodos expuso, cómo nombró las cosas. No la clase.

> **Verificá si existe dependencia Maven real entre los dos repos.** Si existe, es reuso
> de verdad y hay que importarlo, no duplicarlo. Si no existe —el caso normal— escribís
> tu propia versión siguiendo el patrón.

Esto no es una precaución teórica. En el workspace que motivó la funcionalidad:

- **0 dependencias Maven** entre los 4 repos (cada uno con su propio `groupId`).
- **73.7% de los nombres de componentes existen en más de un repo** (535 de 726).
- **89 nombres están en los 4 repos a la vez.**

Es decir: mucho copy-paste histórico, cero reuso real. Una tool que dijera
`REUSE_EXISTING` cross-repo estaría mintiendo el 100% de las veces.

### Efecto secundario: divergencia

Como el índice guarda cuántos métodos tiene cada copia, `workspace_search` agrupa los
homónimos en `sameNameInSeveralProjects` con sus `methodCounts`. Si el mismo nombre
existe en 4 repos con distinta cantidad de métodos, esas copias **divergieron**.

Igual cantidad **no** prueba que sean iguales: es una señal barata, no un diff.

---

## Cómo conviven los dos niveles

Dentro de un repo instalado quedan las dos capas, y **no se pisan**:

| | Nivel 1 | Nivel 2 |
|---|---|---|
| Servidor MCP | `atlasmemory` | `atlasworkspace` |
| Prefijo en Claude Code | `mcp__atlasmemory__` | `mcp__atlasworkspace__` |
| Tools | `catalog_exists`, `catalog_search`, `catalog_get`, `catalog_related`, `catalog_reindex` | `workspace_search`, `workspace_get`, `workspace_projects`, `workspace_reindex` |
| Skill | `reuse-first` | `precedent-first` |
| Alcance | Un repo | N repos |
| Autoridad | **Fuente de verdad** | Consultivo |
| Consejo | `REUSE_EXISTING` / `CREATE_NEW` | `PRECEDENT_FOUND` / `NO_MATCH` |

### Dónde ejecutar el agente

| Directorio | ¿Abrir claude/opencode ahí? | Qué obtenés |
|---|---|---|
| Un repo (`api-factura/`) | **Sí, como siempre** | Las dos capas |
| La carpeta padre (`Github/`) | Opcional | Solo el workspace, sin memoria local |
| `atlasmemory-workspace/` | **Nunca** | Es data + un ejecutable, no un proyecto |
| `atlasmemory/` | Solo para desarrollar la herramienta | Es el producto |

**Tu flujo no cambia.** Abrís el agente en el repo donde trabajás. El servidor del
workspace lo lanza el cliente solo, apuntando a la carpeta vecina.

---

## Qué NO hace el workspace

Decisiones deliberadas, no funcionalidad pendiente:

- **No parsea Java.** Agrega los `catalog.json` que cada repo ya generó. Si un proyecto
  no tiene catálogo, lo reporta en vez de inventarlo.
- **No escribe en los repos.** Es solo lectura sobre los catálogos hijos; hay un test
  que lo verifica comparando mtimes.
- **No junta todo en un catálogo gigante.** Guarda nombres de métodos, no firmas: ~22%
  de lo que pesan los catálogos sumados. Las firmas se cargan bajo demanda en
  `workspace_get`.
- **No resuelve relaciones cross-repo.** Una arista de `factura` a un tipo de `comun`
  queda `unresolved:`. Vincularlas sugeriría una dependencia que no existe.
- **No reemplaza al nivel 1.** Sin workspace instalado, cada repo funciona igual que antes.

---

## Ciclo de vida: qué reindexar y cuándo

| Cambió | Comando | Qué actualiza |
|--------|---------|---------------|
| Código Java de un repo | `catalog_reindex` (o `node scripts/index-catalog.mjs`) | El catálogo de ese repo |
| Un repo se reindexó y querés verlo cross-repo | `workspace_reindex` | El índice del workspace |
| Ambas cosas de una | `workspace_reindex` con `project` | Reindexa ese repo desde Java **y** el workspace |
| Agregaste un repo nuevo | Editar el registry + `workspace_reindex` | El índice |
| Cambió la plantilla `atlasmemory/` | `install.mjs --force` / `install-workspace.mjs --force` | Las copias instaladas |

**Frescura automática:** cada respuesta del nivel 1 trae `stale` si hay fuentes `.java`
más nuevas que el índice. Cada respuesta del nivel 2 trae `staleProjects` con los repos
cuyo `catalog.json` cambió después de construirse el índice. Si aparecen, reindexá antes
de confiar en el resultado.

La detección del nivel 2 es barata a propósito: compara mtimes de los `catalog.json`
(N stats), en vez de recorrer los árboles `.java` de N repos en cada llamada.

---

## Qué pasa si borro cada cosa

| Borrás | Consecuencia | Recuperación |
|--------|--------------|--------------|
| `catalog.json` de un repo | Ese repo pierde memoria; el workspace lo reporta sin catálogo | `node scripts/index-catalog.mjs` |
| `memory/workspace-index.json` | Las tools del workspace dan error explícito | `node scripts/index-workspace.mjs` |
| `atlasmemory.workspace.json` | El workspace no sabe qué repos mirar | Reinstalar o reescribirlo a mano |
| `atlasmemory-workspace/` entero | Se pierde el nivel 2; el nivel 1 sigue intacto | `node install-workspace.mjs <padre>` |
| `atlasmemory/` (el repo producto) | No podés reinstalar ni actualizar | `git clone` de nuevo |

---

## La contrapartida honesta: duplicación

El motor `catalog-engine.mjs` está copiado en cada destino: uno por repo, uno en el
workspace, uno en la plantilla. Con 4 repos son 6 copias.

Eso no lo introdujo el workspace — es el modelo de atlasmemory desde el inicio: **cero
dependencias, cero `npm install`, cada destino autocontenido**. El precio es la copia.
La alternativa (publicarlo en npm) elimina la duplicación pero rompe la premisa.

**Consecuencia práctica:** si editás el motor en la plantilla, hay que reinstalar con
`--force` en cada destino o las copias divergen.

---

## Limitaciones conocidas

- **El scoring es por substring, en los dos niveles.** Un nombre compuesto no encuentra
  sus partes: `IFacturaSaludData` no trae `IFacturaData`. Buscá por el concepto de
  dominio pelado (`Factura`, `DocumentoEquivalente`), no por el nombre completo del
  candidato. Las skills lo instruyen, pero depende de que el agente obedezca.
- **`CREATE_NEW` sin `nearMisses` no significa "no hay nada parecido"**, significa "nada
  coincide exactamente". Con nombres compuestos es un falso negativo frecuente.
- **La extracción de métodos tiene ruido** (~6%): el indexer captura `return new Xxx(...)`
  dentro de cuerpos como si fuera un método.
- **Los homónimos dentro de un mismo repo existen** y `catalog_get` devuelve el primero
  en silencio. El nivel 2 sí los devuelve todos, con `ambiguous: true`.
- **El catálogo localiza, no prueba.** Confirmá leyendo el archivo real antes de decidir.

---

## Referencias

- `README.md` — instalación y layout
- `QUICKSTART.md` — paso a paso de los dos niveles
- `docs/arquetipo-catalogo-agente.md` — modelo de conocimiento del nivel 1
- Skills `reuse-first` (nivel 1) y `precedent-first` (nivel 2)

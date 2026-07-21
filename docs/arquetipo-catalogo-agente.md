# Memoria Inteligente del Proyecto

Documento **rector de producto y arquetipo**.

> **El agente consulta conocimiento, no redescubre el repositorio.**

Principio rector: **definir el producto y el modelo de conocimiento antes que las tecnologías**. Si el producto está bien diseñado, después se decide JSON, SQLite, MCP, embeddings u otra cosa. Empezar al revés produce una herramienta muy técnica que no resuelve el problema principal.

| Campo | Valor |
|-------|--------|
| Producto | Memoria Inteligente del Proyecto |
| Lema | El agente consulta conocimiento, no redescubre el repositorio |
| Piloto | `clarisa-back-api-equivalente` (binding Java / Clarisa) |
| Alcance | Por proyecto (cada repo tiene su memoria) |
| Constitución | [Modelo de Conocimiento](#parte-b--modelo-de-conocimiento) |
| Estado | Visión + knowledge model + MVP Niveles 1–3 (+ 7/8/9 lite) |
| Última actualización | 2026-07-20 |

```text
Producto
    ↓
Modelo de Conocimiento   ← constitución (qué se sabe)
    ↓
Niveles de capacidad     ← cómo evoluciona el producto
    ↓
Implementación técnica   ← bindings (Java, JSON, tools…)
```

---

# Parte A — Visión del producto

## Visión

Construir una **Memoria Inteligente del Proyecto** que permita a agentes de IA (OpenCode, Claude Code, Codex, Gemini CLI, etc.) comprender la arquitectura, reutilizar implementaciones existentes y evitar la creación de código duplicado.

La memoria actúa como una **capa intermedia entre el agente y el repositorio de código**.

```text
  Agente (OpenCode / Claude / Codex / …)
              │
              │  consulta conocimiento
              ▼
  ┌─────────────────────────────┐
  │  Memoria Inteligente        │
  │  del Proyecto               │
  └─────────────────────────────┘
              │
              │  indexa / actualiza
              ▼
         Repositorio
```

**Cambio de paradigma:** pasar de un modelo donde **el agente lee código** a uno donde **el agente consulta conocimiento**. Esa diferencia transforma una herramienta de búsqueda en un asistente de arquitectura para proyectos de software empresariales.

### Dolor principal (validado)

Cuando se necesita un componente (p. ej. un adaptador de persistencia, un puerto, un caso de uso), el agente lo crea desde cero aunque ya exista. Debe **saber que existe y reutilizarlo**.

### Principios de producto

1. **Producto y conocimiento antes que tecnología** — el stack se elige al implementar un nivel, no al diseñar el producto.  
2. **Por proyecto** — cada repo tiene su propia memoria; no se mezclan dominios.  
3. **Conocimiento > archivos** — el agente no debe recorrer miles de fuentes en cada sesión.  
4. **Reuse-first / evolución consciente** — evaluar reutilizar o extender antes de crear.  
5. **Agnóstico de cliente** — OpenCode, Claude Code u otros consumen la misma memoria.  
6. **Agnóstico de lenguaje en el modelo** — el producto habla de componentes y relaciones; Java/Kotlin/Go son *bindings*.  
7. **Evolutivo** — 10 niveles; se puede entregar valor desde el Nivel 1 sin tener el 10.  
8. **El agente razona; la memoria conoce** — la memoria no sustituye al arquitecto; le da hechos, impacto y reglas.

---

## ¿Qué será capaz de responder?

El producto se valida por las preguntas que un agente (o un humano) puede hacer **sin reexplorar el repo**:

| # | Pregunta | Nivel mínimo |
|---|----------|--------------|
| 1 | ¿Qué módulos y componentes participan en este proyecto? | 1 |
| 2 | ¿Existe algo equivalente a X? | 2 |
| 3 | ¿Dónde está este símbolo y qué firmas expone? | 2 |
| 4 | ¿Quién usa / implementa / produce este componente? | 3 |
| 5 | ¿Qué componentes puedo reutilizar para esta necesidad? | 3 + 7 |
| 6 | ¿Dónde debo implementar esta funcionalidad? | 7 |
| 7 | ¿Qué dependencias romperé si cambio esto? | 3 + 7 |
| 8 | ¿Qué impacto tiene este cambio? | 7 |
| 9 | ¿Qué reglas estaría violando? | 8 |
| 10 | ¿Qué arquitectura y convenciones sigue este proyecto? | 8 |
| 11 | ¿Qué capacidades de negocio existen y con qué cobertura? | 5–6 |
| 12 | ¿Qué capacidades quedarían incompletas tras el cambio? | 6–7 |
| 13 | ¿Cómo evolucionó esta capacidad? | 10 |
| 14 | ¿Hay implementaciones con la misma *intención* aunque el nombre sea distinto? | 4 |

El **MVP** debe responder con fiabilidad las preguntas **1–7** (y la 9 de forma lite vía reglas documentadas).

---

# Parte B — Modelo de Conocimiento

> Esta sección es la **constitución** del producto.  
> No habla de Java, OpenCode, MCP ni SQLite.  
> El indexador, el grafo, el catálogo y las tools **representan** este modelo; no lo sustituyen.

La memoria del proyecto **solo conoce seis tipos de cosa**:

```text
Componente · Relación · Capacidad · Regla · Estado · Contexto
```

Todo lo demás (JSON, SQL, tools, embeddings) es **serialización o consulta** de estas seis piezas.

---

## 1. Componente

Unidad de conocimiento **estructural**: algo que “existe” en el proyecto y se puede nombrar, localizar y describir.

### Definición

Un **Componente** es un artefacto del proyecto con identidad estable, tipo, ubicación y (opcionalmente) estructura interna (miembros).

### Atributos mínimos

| Atributo | Descripción |
|----------|-------------|
| `id` | Identidad estable en la memoria |
| `kind` | Tipo de componente (ver taxonomía) |
| `name` | Nombre simple |
| `qualifiedName` | Nombre cualificado (p. ej. FQN, ruta lógica) |
| `location` | Dónde vive (path, módulo, paquete) |
| `members` | Métodos, campos, constructores… (si aplica) |
| `metadata` | Anotaciones, modificadores, tags técnicos |

### Taxonomía de `kind` (agnóstica)

```text
module | package | type | member | resource | config | other
```

Refinamientos de `type` (aún agnósticos):

```text
class | interface | enum | record | struct | trait | …
```

Refinamientos de **rol de arquitectura** (opcionales, por binding):

```text
port | adapter | use-case | entity | dto | mapper | endpoint | …
```

### Binding Java / Clarisa (ejemplo, no constitución)

| Kind / rol | Representación Java típica |
|------------|----------------------------|
| type / class | `class Foo` |
| type / interface | `interface IFoo` |
| type / enum | `enum FooEnum` |
| type / record | `record Foo(...)` |
| member | método, campo, constructor |
| port | `I*Data`, `I*` en capa application |
| adapter (data) | `*Data` @Stateless |
| use-case | `*UC` |
| endpoint | `*RS` |
| entity | `@Entity` |
| dto | `*Dto` |
| mapper | `*Mapper` |
| module | módulo Maven |

El modelo **no** exige Jakarta EE. El piloto Clarisa es el primer binding.

---

## 2. Relación

Unidad de conocimiento **estructural entre componentes**.

### Definición

Una **Relación** conecta dos componentes con un tipo dirigido y semántica fija.

```text
from  --[type]-->  to
```

### Tipos canónicos (agnósticos)

| type | Significado |
|------|-------------|
| `uses` | A depende de / invoca / recibe B |
| `implements` | A realiza el contrato de B |
| `extends` | A hereda o especializa B |
| `produces` | A expone/instancia B (factory, producer) |
| `injects` | A recibe B por inyección de dependencias |
| `maps` | A transforma entre B y C (o A mapea B) |
| `contains` | A contiene B (módulo→tipo, tipo→miembro) |
| `publishes` | A publica un evento/mensaje B |
| `listens` | A escucha / reacciona a B |
| `depends-on` | Dependencia de módulo/paquete (build) |

### Binding Clarisa (ejemplos)

| Relación | Ejemplo |
|----------|---------|
| `implements` | `DocEquivalentePosData` → `IDocEquivalentePosData` |
| `uses` | `DocEquivalentePosUC` → `IDocEquivalentePosData` |
| `produces` | `UseCaseConfig` → `DocEquivalentePosUC` |
| `injects` | `DocEquivalentePosRS` → `DocEquivalentePosUC` |
| `extends` | `DocEquivalentePosData` → `CRUDData` |

---

## 3. Capacidad

Unidad de conocimiento de **dominio / negocio**.

### Definición

Una **Capacidad** agrupa componentes y relaciones alrededor de una intención de negocio nombrable.

Identidad sugerida (estable, legible):

```text
{dominio}.{verbo}
```

Ejemplos:

```text
cliente.create
cliente.update
factura.emitir
notaCredito.generar
documentoEquivalentePos.persistir
documentoEquivalentePos.consultarEstadoDian
```

### Qué conoce una capacidad

- Componentes que la implementan (endpoints, use-cases, adapters, entities, DTOs)  
- Relaciones relevantes entre ellos  
- Validaciones y procesos asociados  
- **Estado** de cobertura (ver §5)  

### Nota de producto

Las capacidades **no** se inventan solo con nombres de clase. Se construyen con reglas de dominio, convenciones del proyecto y (más adelante) semántica. En el MVP pueden existir como *tags* o estar ausentes; el modelo ya las define para no reescribir el producto después.

---

## 4. Regla

Unidad de conocimiento **normativo**: cómo *debe* construirse o evolucionar el proyecto.

### Definición

Una **Regla** es una restricción o convención que el agente no debe violar al proponer cambios.

### Categorías

| Categoría | Ejemplos |
|-----------|----------|
| Arquitectura | Los use-cases no conocen la capa de entrega (REST). Los DTO no son entidades. |
| Nomenclatura | Los DTO terminan en `Dto`. Los puertos se prefijan `I`. |
| Dependencias | `usecase` no depende de `web` ni de `ejb`. |
| Dominio | Toda consulta de datos de tenant filtra por `tenant`. |
| Estilo | Excepciones de dominio, no excepciones genéricas en la API. |

### Representación

- **Lite (MVP):** documentos versionados (`CLAUDE.md`, `AGENTS.md`, skill `reuse-first`).  
- **Full (Nivel 8):** reglas estructuradas consultables (`id`, `statement`, `scope`, `severity`).  

Las reglas **no** se deducen solo del indexador; se **declaran** (y opcionalmente se validan contra el grafo).

---

## 5. Estado

Unidad de conocimiento sobre **completitud o vigencia**.

### Definición

El **Estado** califica un componente, una capacidad o un proceso respecto a su implementación o ciclo de vida.

### Valores canónicos

| Estado | Significado |
|--------|-------------|
| `implemented` | Existe y se considera usable |
| `partial` | Existe de forma incompleta |
| `missing` | Se espera / se necesita y no está |
| `obsolete` | Existe pero no debe usarse para trabajo nuevo |
| `unknown` | La memoria no puede afirmarlo aún |

### Uso

- En el MVP, un componente indexado suele ser `implemented`.  
- `missing` / `partial` cobran sentido con **Capacidades** y cobertura (Niveles 5–6).  
- `obsolete` puede venir de **Contexto** o de reglas (“este mapper será eliminado”).

---

## 6. Contexto

Unidad de conocimiento **situacional** que no se deduce solo del AST.

### Definición

El **Contexto** aporta significado humano o de proceso alrededor de componentes y capacidades.

### Ejemplos

```text
Este módulo es legado.
Este mapper será eliminado en el próximo release.
Este proceso depende de la DIAN.
No tocar UseCaseConfig sin añadir @Produces.
El binding de este repo es Jakarta EE 8 (javax.*), no jakarta.*.
```

### Fuentes

- Documentación del repo  
- ADRs  
- Anotaciones en el knowledge store  
- Entrada humana / agente con confirmación  

El indexador automático **no** inventa contexto de negocio; como mucho sugiere candidatos.

---

## Cómo se relacionan las seis piezas

```text
                    ┌──────────┐
                    │  Regla   │  (norma)
                    └────┬─────┘
                         │ aplica a
                         ▼
┌────────────┐     ┌──────────┐     ┌────────────┐
│ Componente │◄───►│ Relación │◄───►│ Componente │
└─────┬──────┘     └──────────┘     └─────┬──────┘
      │                                   │
      │  participa en                     │
      └──────────────┬────────────────────┘
                     ▼
              ┌────────────┐
              │ Capacidad  │  (dominio)
              └─────┬──────┘
                    │ calificada por
                    ▼
              ┌────────────┐
              │   Estado   │
              └────────────┘

         Contexto ──anota──► Componente | Capacidad | Regla
```

### Lectura operativa

| Pregunta del agente | Piezas que usa |
|---------------------|----------------|
| ¿Existe X? | Componente |
| ¿Quién lo implementa? | Relación |
| ¿Es del dominio factura? | Capacidad |
| ¿Puedo crear un DTO-entidad? | Regla |
| ¿Está el update hecho? | Estado |
| ¿Es código legado? | Contexto |

---

## Ciclo de vida del conocimiento

El conocimiento **no nace solo del indexador**. Vive un ciclo continuo:

```text
Repositorio
    │
    ▼
Descubrimiento      (qué hay: módulos, paths, tipos)
    │
    ▼
Comprensión         (miembros, firmas, anotaciones)
    │
    ▼
Normalización       (mapear a Componente / Relación / … del modelo)
    │
    ▼
Validación          (consistencia, stale, reglas mínimas)
    │
    ▼
Persistencia        (store del proyecto: JSON, SQLite, …)
    │
    ▼
Consulta            (tools / MCP / API de conocimiento)
    │
    ▼
Actualización       (reindex, corrección humana, nuevo contexto)
    │
    └──────────────► (vuelve a Descubrimiento o Persistencia)
```

| Fase | Entrada | Salida | Piezas del modelo |
|------|---------|--------|-------------------|
| Descubrimiento | FS, build | inventario | Componente (id, location) |
| Comprensión | fuentes | estructura | Componente.members, metadata |
| Normalización | estructura cruda | grafo canónico | Componente + Relación (+ tags→Capacidad) |
| Validación | grafo + meta | grafo confiable o `stale` | Estado |
| Persistencia | grafo | store versionado | todas |
| Consulta | pregunta del agente | hechos + evaluación | todas las relevantes |
| Actualización | cambios en repo o humano | store fresco | Contexto, Estado, … |

---

## Separación modelo vs binding vs store

| Capa | Responsabilidad | Ejemplo |
|------|-----------------|---------|
| **Modelo de conocimiento** | Ontología del producto | Componente, Relación, Capacidad… |
| **Binding de lenguaje** | Cómo se reconoce en un ecosistema | Java: class, interface, `@Stateless` |
| **Binding de arquitectura** | Roles del proyecto piloto | port, data, UC, RS (Clarisa hexagonal) |
| **Store** | Persistencia | `catalog.json`, futuro SQLite |
| **Consulta** | Interfaz a agentes | tools OpenCode, futuro MCP |

Cambiar el store **no** cambia el modelo.  
Añadir Kotlin **no** cambia el modelo; añade un binding.

---

# Parte C — Niveles de capacidad del producto

Cada nivel es una **capacidad de producto** sobre el Modelo de Conocimiento.  
La tecnología se elige *dentro* del nivel, no al revés.

---

## Nivel 1. Descubrimiento del Proyecto

### Objetivo

Que el sistema conozca el proyecto sin que el agente lea miles de archivos.

### Qué se construye

Un explorador que recorre el proyecto e identifica **Componentes** de alto nivel:

- módulos, paquetes  
- tipos (clases, interfaces, enums, records…)  
- recursos y configuración  
- estructura de build y dependencias entre módulos  

### Piezas del modelo

Principalmente **Componente** (`module`, `package`, `type`, `resource`, `config`).

### Resultado esperado

Representación de la **estructura**. Solo sabe **qué existe**, no aún el detalle interno.

### Criterio de valor

> “¿Qué módulos y paquetes tiene este proyecto?” → respuesta rápida, sin exploración ad hoc del agente.

---

## Nivel 2. Indexación Estructural

### Objetivo

Comprender el **contenido** de cada componente.

### Qué se construye

Un indexador que rellena **miembros y metadata**:

- métodos, constructores, atributos  
- firmas, tipos de retorno, parámetros  
- anotaciones / decoradores / atributos del lenguaje  
- herencia e interfaces (como datos del componente; las aristas formales son Nivel 3)  

Señales de framework son **metadata del binding** (CDI, EJB, JPA, REST, etc.), no el núcleo del modelo.

### Piezas del modelo

**Componente** enriquecido (+ pistas para **Relación** y **Estado** `implemented`).

### Resultado esperado

- ¿Dónde está este símbolo?  
- ¿Qué firmas expone?  
- ¿Existe un adaptador / puerto / servicio con este nombre?  

### Criterio de valor

> “¿Existe el adaptador de persistencia de documento POS y qué operaciones expone?” → sí, con firmas.

---

## Nivel 3. Modelo de Relaciones

### Objetivo

Entender **cómo interactúan** los componentes.

### Qué se construye

El grafo de **Relaciones** del proyecto:

```text
Endpoint  --injects-->  UseCase  --uses-->  Port
                                              ▲
                                         implements
                                              │
                                           Adapter
```

### Piezas del modelo

**Relación** (`uses`, `implements`, `produces`, `injects`, `extends`, `maps`, …).

### Resultado esperado

Pensar en **conexiones**, no solo en archivos.

### Criterio de valor

> “Dado este puerto, ¿quién lo implementa y quién lo usa?” → grafo corto y accionable.

---

## Nivel 4. Modelo Semántico

### Objetivo

Comprender el **significado** (intención), no solo los nombres.

### Qué se construye

Similitud entre componentes/miembros por intención:

- `crearCliente` ≈ `registrarCliente` ≈ `insertarCliente`  

Típicamente embeddings u otras técnicas de similitud **sobre** el grafo ya normalizado.

### Piezas del modelo

Enriquece la **Consulta** sobre Componentes (y más adelante Capacidades). No crea un séptimo tipo de entidad.

### Resultado esperado

Encontrar equivalentes aunque el nombre no coincida.

### Criterio de valor

> “Necesito persistir un documento POS” → encuentra la operación correcta sin el string exacto.

### Nota

**No es el primer entregable.** Solo aporta valor cuando Niveles 1–3 son confiables.

---

## Nivel 5. Modelo de Capacidades del Negocio

### Objetivo

Agrupar el conocimiento técnico alrededor del **dominio**.

### Qué se construye

**Capacidades** (`cliente.create`, `factura.emitir`, …) y su mapa de componentes.

### Piezas del modelo

**Capacidad** (+ Componentes y Relaciones participantes).

### Resultado esperado

> La capacidad *Cliente* está cubierta por estos artefactos (no solo “existe ClienteService”).

### Criterio de valor

> “¿Qué hay implementado alrededor de documento equivalente SPD?” → mapa de capacidad.

---

## Nivel 6. Modelo de Cobertura

### Objetivo

Detectar **qué está implementado y qué falta** por capacidad o proceso.

### Qué se construye

Indicadores de **Estado** sobre capacidades:

```text
cliente
  create     implemented
  read       implemented
  update     missing
  delete     missing
```

### Piezas del modelo

**Estado** sobre **Capacidad** (y a veces sobre procesos compuestos).

### Resultado esperado

Huecos funcionales visibles sin inspección manual.

### Criterio de valor

> “¿Qué falta del flujo de nota débito POS?” → checklist con huecos.

---

## Nivel 7. Motor de Impacto y Evolución

### Objetivo

Evaluar **qué tocar, qué reutilizar y qué impacto tiene un cambio** — de forma objetiva.

> No es un “recomendador genérico”. **Detecta, analiza y evalúa.**  
> Responde: *¿qué cambia si hago esto?* y *¿debo reutilizar o crear?*

### Qué se construye

Un motor de evaluación sobre el grafo y las reglas que responde:

- ¿Existe un componente equivalente?  
- ¿Estoy a punto de duplicar?  
- ¿Qué componentes debo modificar?  
- ¿Qué relaciones se ven afectadas?  
- ¿Qué patrón / capas usa este proyecto para este tipo de cambio?  

Salidas típicas: `REUSE_EXISTING` | `EXTEND_EXISTING` | `CREATE_NEW` + lista de impacto.

### Piezas del modelo

Consulta de **Componente + Relación + Regla** (+ Capacidad/Estado cuando existan).

### Resultado esperado

El agente deja de crear componentes nuevos innecesariamente y ve el **impacto**.

### Criterio de valor (dolor actual)

> Ante “necesito un adaptador de persistencia para X”, la memoria responde reutilizar el existente o crear con checklist de capas e impacto.

---

## Nivel 8. Memoria Arquitectónica

### Objetivo

Exponer y aplicar las **Reglas** del proyecto.

### Qué se construye

Conocimiento normativo consultable:

- capas y dependencias permitidas  
- nomenclatura  
- patrones  
- reglas de dominio (multi-tenant, errores, etc.)  

### Piezas del modelo

**Regla** (+ **Contexto** cuando matiza la regla).

### Resultado esperado

El código propuesto respeta la arquitectura del proyecto.

### Criterio de valor

> Un cambio nuevo no viola capas, nomenclatura ni reglas de tenant.

### Lite (MVP)

`CLAUDE.md` + `AGENTS.md` + skill `reuse-first` como fuente de reglas; aún no hace falta un motor formal de validación.

---

## Nivel 9. Integración con Agentes

### Objetivo

Que **cualquier agente** consulte la memoria sin reexplorar el repo.

### Qué se construye

Capa de **Consulta** del ciclo de vida: tools nativas, MCP u otra API estable.

Operaciones de producto (no de tecnología):

- buscar componente  
- obtener componente  
- buscar relaciones  
- evaluar existencia / reutilización (impacto)  
- obtener reglas aplicables  
- (más adelante) buscar capacidad, cobertura, impacto de cambio  

### Piezas del modelo

Todas las que el nivel de madurez ya materialice.

### Resultado esperado

Los agentes consumen **conocimiento**, no hacen `find` masivo por defecto.

### Criterio de valor

> Dos clientes distintos (p. ej. OpenCode y Claude Code) obtienen las mismas respuestas de reutilización sobre la misma memoria.

---

## Nivel 10. Modelo de Evolución

### Objetivo

Comprender **cómo evolucionar** el proyecto de forma coherente con el conocimiento acumulado.

> El **arquitecto sigue siendo el agente** (o el humano).  
> La memoria aporta hechos, impacto, huecos y reglas para que el agente **planifique** bien.  
> Este nivel **no** convierte la memoria en un agente autónomo.

### Qué se construye

Capacidad de responder planes de evolución del tipo:

**Usuario:** Implementa actualización de clientes.

**Memoria (entradas al razonamiento del agente):**

- Componentes existentes del dominio cliente  
- Relaciones entre ellos  
- Estado de cobertura: create/read ok; update/delete missing  
- Reglas: no crear un segundo repositorio; extender capas correctas  
- Impacto: use-case, adapter, mapper, (opcional) endpoint  

El **agente** decide el plan; la memoria **no “programa”**, informa la evolución posible.

### Piezas del modelo

Integración de **Capacidad + Estado + Relación + Regla + Contexto**.

### Resultado esperado

El agente **evoluciona** el sistema existente en lugar de reescribirlo desde cero.

### Criterio de valor

> Ante una feature, el plan nombra componentes a tocar y prohíbe duplicados justificados por la memoria.

---

# Parte D — Producto final (visión completa)

Al completar los 10 niveles, el resultado no es un buscador de código, sino una **Memoria Inteligente del Proyecto** que:

1. Representa el proyecto con un **Modelo de Conocimiento** estable (6 piezas).  
2. Mantiene el **ciclo de vida** del conocimiento (descubrir → consultar → actualizar).  
3. Comprende estructura y relaciones.  
4. (Avanzado) entiende intención, capacidades y cobertura.  
5. Evalúa impacto y reutilización.  
6. Expone reglas arquitectónicas.  
7. Se integra con cualquier agente vía una capa de consulta.  
8. Soporta la **evolución** del sistema sin redescubrir el repo.  

En esencia: **el agente consulta conocimiento, no redescubre el repositorio.**

---

# Parte E — Arquetipo técnico del MVP

Esta sección **no redefine el producto**. Es el **binding de implementación** de:

- Modelo: **Componente + Relación** (+ **Regla/Contexto** lite por docs)  
- Niveles: **1, 2, 3** + **7 lite** + **8 lite** + **9 lite**  
- Piloto: Clarisa `clarisa-back-api-equivalente`  

Capacidad, Estado rico y semántica quedan definidos en el modelo pero **fuera del código del MVP**.

## Decisiones del MVP

| Decisión | Valor | Por qué |
|----------|--------|---------|
| Piezas del modelo en store | Componente + Relación | Suficiente para “¿existe?” y “¿quién lo usa?” |
| Reglas / contexto | Documentos + skill | Nivel 8 lite sin motor formal |
| Evaluación (N7 lite) | `catalog_exists` → REUSE / CREATE | Resuelve el dolor sin ML |
| Consulta (N9 lite) | Custom tools OpenCode | Disponible ya; MCP después si hace falta |
| Store | JSON único por proyecto | Suficiente a escala del piloto; reemplazable |
| Binding lenguaje | Java | Primer binding, no el techo del producto |
| Binding arquitectura | Hexagonal Clarisa | port / data / UC / RS / … |

Cuando el JSON se quede corto, se **cambia el store** sin cambiar el Modelo de Conocimiento ni los niveles.

## Layout por proyecto

```text
proyecto/
├── AGENTS.md                              # Reglas lite + reuse-first
├── CLAUDE.md                              # Arquitectura / reglas del binding
├── docs/
│   └── arquetipo-catalogo-agente.md       # este documento rector
├── .opencode/
│   ├── opencode.json
│   ├── tools/
│   │   └── catalog.ts                     # Consulta (N9 lite)
│   ├── skills/
│   │   └── reuse-first/
│   │       └── SKILL.md                   # Evaluación (N7 lite)
│   └── memory/
│       ├── catalog.json                   # Componentes + Relaciones
│       └── meta.json
└── scripts/
    └── index-catalog.mjs                  # Descubrimiento + comprensión + normalización
```

## Flujo de producto (MVP)

```text
Usuario pide feature
        │
        ▼
  skill reuse-first (N7 lite)
        │
        ▼
  catalog_exists / catalog_search   ← Consulta sobre Componente (+ Relación)
        │
   ┌────┴────┐
 found     not found
   │         │
 REUSE     CREATE_NEW + checklist de capas (N8 lite / Reglas)
```

---

## Schema de memoria (serialización del modelo)

Nombres de archivo orientados a implementación; el contenido **mapea** a Componente y Relación.

### `meta.json`

```json
{
  "$schema": "project-memory-meta/v1",
  "project": "clarisa-back-api-equivalente",
  "catalogVersion": 1,
  "generatedAt": "2026-07-20T20:00:00Z",
  "sourceRoot": ".",
  "modules": [
    "clarisa-back-api-equivalente-domain",
    "clarisa-back-api-equivalente-usecase",
    "clarisa-back-api-equivalente-ejb",
    "clarisa-back-api-equivalente-web"
  ],
  "fileCount": 0,
  "artifactCount": 0,
  "contentHash": "sha256:...",
  "knowledgeModelVersion": 1,
  "productLevelsCovered": [1, 2, 3],
  "indexer": {
    "name": "index-catalog",
    "version": "1.0.0",
    "languageBinding": "java",
    "architectureBinding": "clarisa-hexagonal"
  }
}
```

### `catalog.json`

```json
{
  "version": 1,
  "project": "clarisa-back-api-equivalente",
  "generatedAt": "ISO-8601",
  "components": [],
  "relations": [],
  "indexes": {
    "byName": {},
    "byKind": {},
    "byModule": {}
  }
}
```

> Nota: en implementaciones previas del borrador se usaba `artifacts` / `edges`.  
> En el modelo rector se prefieren **`components` / `relations`**. El indexer puede emitir alias durante la transición.

### Componente (serialización)

| Campo | Modelo | Descripción |
|-------|--------|-------------|
| `id` | Componente.id | p. ej. `type:co.clarisa...DocEquivalentePosData` |
| `kind` | Componente.kind | ver taxonomía + roles del binding |
| `name` | Componente.name | nombre simple |
| `qualifiedName` | Componente.qualifiedName | FQN |
| `path` | location | path relativo |
| `module` | location | módulo |
| `layer` | metadata (binding arch.) | `domain` \| `usecase` \| `ejb` \| `web` |
| `package` | location | package |
| `modifiers` | metadata | |
| `annotations` | metadata | |
| `extends` | pista → Relación `extends` | |
| `implements` | pista → Relación `implements` | |
| `methods` | members | |
| `fields` | members | opcional |
| `produces` | pista → Relación `produces` | |
| `summary` | metadata | |
| `tags` | metadata / prep Capacidad | `pos`, `spd`, … |
| `state` | Estado | default `implemented` si está en el índice |
| `lineStart` | location | opcional |

### Member (método)

```json
{
  "name": "persistirDocumento",
  "returnType": "Long",
  "params": [
    { "name": "factura", "type": "DocEquivalentePosDto" },
    { "name": "tenant", "type": "Long" }
  ],
  "annotations": ["Override"]
}
```

### Relación (serialización)

```json
{
  "from": "type:co.clarisa.api.equivalente.data.DocEquivalentePosData",
  "to": "type:co.clarisa.api.equivalente.port.IDocEquivalentePosData",
  "type": "implements"
}
```

### Roles del binding Clarisa (`kind` extendido en store)

```text
port | data | usecase | bean | entity | mapper | rest
| dto | enum | exception | util | config | other
```

| kind (binding) | Heurística Java |
|----------------|-----------------|
| `port` | `.../port/I*.java` |
| `data` | `.../data/*Data.java` + `@Stateless` |
| `usecase` | `*UC` en usecase |
| `bean` | `*Bean` + `@Stateless` |
| `entity` | `@Entity` |
| `mapper` | `*Mapper` / `@Mapper` |
| `rest` | `*RS` en web |
| `dto` | `*Dto` en domain |
| `enum` | `*Enum` |
| `exception` | `*Exception` |
| `config` | `UseCaseConfig` |
| `util` | util/helpers |
| `other` | fallback |

---

## API de consulta (N9 lite + N7 lite)

Tools en `.opencode/tools/catalog.ts` (nombres de implementación; semántica de producto entre paréntesis):

| Tool | Operación de producto | Niveles |
|------|----------------------|---------|
| `catalog_search` | buscar componentes | 1–2 |
| `catalog_get` | obtener componente | 2 |
| `catalog_related` | relaciones de un componente | 3 |
| `catalog_exists` | existencia + **evaluación** REUSE/CREATE | 2 + **7** |
| `catalog_reindex` | ciclo: actualización | 1–3 |

### `catalog_exists` (contrato de evaluación)

**Existe:**

```json
{
  "exists": true,
  "exact": true,
  "match": {},
  "nearMisses": [],
  "advice": "REUSE_EXISTING",
  "impact": {
    "reuseHint": "Usar IDocEquivalentePosData / DocEquivalentePosData. No crear otro adaptador de persistencia."
  }
}
```

**No existe:**

```json
{
  "exists": false,
  "advice": "CREATE_NEW",
  "impact": {
    "createHint": {
      "layers": ["port", "data"],
      "checklist": [
        "Crear IXxxData en usecase/port",
        "Crear XxxData @Stateless en ejb/data extends CRUDData",
        "emQuery lecturas / emCommand escrituras",
        "Filtrar por tenant",
        "Si hay UC nuevo: @Produces en UseCaseConfig"
      ]
    }
  }
}
```

### Scoring de búsqueda (N2; no es N4)

| Match | Score |
|-------|-------|
| Nombre exacto | 1.0 |
| Prefijo/sufijo | 0.85 |
| Substring name/FQN | 0.7 |
| Método | 0.6 |
| Tag | 0.5 |

La similitud por **intención** sin coincidencia léxica es **Nivel 4**.

---

## Indexer (ciclo de vida: descubrir → normalizar → persistir)

`scripts/index-catalog.mjs`:

1. **Descubrimiento:** walk `*/src/main/java/**/*.java` (excluir `target/`).  
2. **Comprensión:** package, tipo, herencia, anotaciones, métodos.  
3. **Normalización:** mapear a Componentes + roles del binding Clarisa.  
4. **Relaciones:** `implements`, `extends`; parse de `UseCaseConfig` → `produces`.  
5. (Posterior) constructores de `*UC` → `uses`.  
6. **Persistencia:** `catalog.json` + `meta.json`.  

```bash
node scripts/index-catalog.mjs
node scripts/index-catalog.mjs --out .opencode/memory
```

Escala piloto: ~37 data, ~41 ports, ~31 UC. Objetivo de consulta: &lt; ~100 ms.

---

## Reglas lite (N8) y skill (N7)

### `AGENTS.md` (mínimo)

1. Qué es el proyecto (3 líneas).  
2. Build.  
3. **Reuse-first obligatorio** → `catalog_exists` antes de crear port / data / UC / entity / mapper.  
4. Puntero a `CLAUDE.md`.  
5. Nomenclatura e invariantes (tenant, emQuery/emCommand).  
6. Tools de la memoria.  

### Skill `reuse-first`

```yaml
---
name: reuse-first
description: >
  Antes de crear puertos, adaptadores de datos, casos de uso, entidades o mappers,
  consulta la memoria del proyecto, evalúa impacto y reutiliza componentes existentes.
---
```

Pasos: identificar componente → `catalog_exists` → get/related si hay match → crear solo si `CREATE_NEW` (port → data → UC → UseCaseConfig → RS) → reindex.

### `opencode.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": ["AGENTS.md", "CLAUDE.md"]
}
```

---

## Ejemplo de valor (piloto)

Pregunta: *“¿Creo un Data para documento equivalente POS?”*

Memoria (Componentes + Relaciones + evaluación):

- Componente port `IDocEquivalentePosData`  
- Componente data `DocEquivalentePosData` — relación `implements`  
- Miembros: `persistirDocumento`, …  
- `advice`: **REUSE_EXISTING**  

El agente **no** crea un segundo adaptador.

---

# Parte F — Roadmap de producto

| Fase | Niveles | Valor de producto | Piezas del modelo materializadas |
|------|---------|-------------------|----------------------------------|
| **MVP** | 1–3, 7 lite, 8 lite, 9 lite | Inventario, firmas, grafo, evaluación reuse | Componente, Relación, Regla/Contexto (docs) |
| **v1** | 3 completo, 7 robusto | Impacto de cambio (quién se rompe) | Relaciones UC↔port↔endpoint |
| **v2** | 5, 6 | Capacidades y cobertura | Capacidad, Estado |
| **v3** | 4 | Búsqueda por intención | (consulta semántica sobre lo anterior) |
| **v4** | 9 full, 10 | Multi-cliente + evolución asistida | Todas + planes de evolución |

### Orden de implementación del MVP

| # | Tarea | Nivel | Hecho cuando |
|---|--------|-------|--------------|
| 1 | Indexer + store de componentes/relaciones en equivalente | 1–2–3 | Conteos ≈ realidad del repo |
| 2 | Tools exists / search / get | 2, 7, 9 | Encuentra `DocEquivalentePosData` |
| 3 | `AGENTS.md` + skill `reuse-first` | 7–8 | Regla reuse-first explícita |
| 4 | related + edges UseCaseConfig | 3 | Grafo port↔data↔UC |
| 5 | reindex | ciclo de vida | Regeneración confiable |
| 6 | Prueba de reutilización | 7 | “Crea Data POS” → reutiliza |
| 7 | Plantilla a otros repos | 9 | Mismo producto, otro binding de paths |

---

# Criterios de aceptación del MVP

1. `catalog_exists(DocEquivalentePosData)` → `REUSE_EXISTING`.  
2. `catalog_exists(IDocEquivalentePosData)` → componente + relaciones.  
3. Búsqueda por fragmento encuentra candidatos existentes (p. ej. paginación).  
4. Sin match → `CREATE_NEW` + checklist de capas (Reglas lite).  
5. El agente no inventa un segundo adaptador si la memoria lo tiene.  
6. Consulta &lt; ~100 ms.  
7. Memoria local por proyecto.  
8. El store es una serialización del **Modelo de Conocimiento**, no un invento ad hoc.

---

# Riesgos de producto

| Riesgo | Mitigación |
|--------|------------|
| Empezar por embeddings/MCP y no por el modelo | Constitución = Parte B; tech al final |
| Confundir indexador con producto | Ciclo de vida + 6 piezas |
| Índice desactualizado | `contentHash` + reindex (fase Actualización) |
| Agente ignora la memoria | Skill + AGENTS + `advice` en tools |
| Sobre-modelar Capacidades antes de tener grafo | Capacidad en el modelo; código en v2 |
| Acoplar el producto a Java | Modelo agnóstico; Java solo binding |

---

# Anexo — Opciones de tecnología (no son el roadmap)

> Este anexo existe para implementación. **No** define el producto.  
> Se puede reescribir sin tocar Partes A–D.

| Necesidad | Opciones razonables | MVP |
|-----------|---------------------|-----|
| Store de componentes/relaciones | JSON, SQLite, otros | JSON |
| Indexer Java | Regex, JavaParser, tree-sitter | Regex/AST ligero |
| Consulta agentes | OpenCode tools, MCP, HTTP | OpenCode tools |
| Semántica (N4) | Embeddings + vector store | Fuera de MVP |
| Multi-cliente (N9 full) | MCP local/remoto | Después del MVP |

### Mapa nivel → tecnología (solo referencia de implementación)

| Nivel | ¿Tech especial ya? | Candidatos cuando toque implementar |
|-------|--------------------|-------------------------------------|
| 1 | Mínima | Walk FS + parse de build |
| 2 | Sí | Parser del lenguaje del binding |
| 3 | Sí | Edges en JSON / grafo en SQLite |
| 4 | No al inicio | Embeddings |
| 5–6 | No al inicio | Reglas de dominio + Estado |
| 7 | Parcial con 1–3 | Motor de reglas sobre el grafo |
| 8 | Docs al inicio | Reglas estructuradas después |
| 9 | Al exponer | Tools → MCP |
| 10 | Al final | Orquestación de consulta + plan del agente |

**Regla:** no introducir embeddings, vector DB ni MCP porque “suenan a IA”. Se introducen cuando un nivel **no se puede cumplir** con el conocimiento ya materializado.

---

# Contexto del piloto Clarisa (binding)

- Java 17, Jakarta EE 8 (`javax.*`), WildFly/EAP 23  
- Hexagonal: `domain` ← `usecase` ← `ejb` / `web` (+ `ear`)  
- Use cases = POJOs; wiring en `web/config/UseCaseConfig`  
- Persistencia: `emQuery` / `emCommand`  
- Multi-tenant por JWT  

Detalle de reglas del binding: `CLAUDE.md` y `README.md` del repositorio.

---

# Estado del documento

| Campo | Valor |
|-------|--------|
| Visión | Definida (Parte A) |
| Modelo de Conocimiento | Definido — 6 piezas + ciclo de vida (Parte B) |
| Niveles | 1–10; N7 = impacto/evolución; N10 = modelo de evolución (no “agente arquitecto”) |
| MVP | Niveles 1–3 + 7/8/9 lite sobre Componente + Relación |
| Tecnología | Anexo; no es el roadmap |
| Implementación de código | Pendiente |
| Principio | Producto y conocimiento primero; el agente consulta conocimiento, no redescubre el repositorio |

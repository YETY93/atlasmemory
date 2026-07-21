#!/usr/bin/env node
/**
 * atlasmemory — servidor MCP (Model Context Protocol) para Claude Code.
 *
 * Binding de CONSULTA aditivo: expone la misma memoria de proyecto que el plugin
 * de OpenCode (.opencode/tools/catalog.ts), pero por MCP stdio, para que
 * Claude Code (u otros clientes MCP) consuman EXACTAMENTE el mismo catalog.json.
 *
 * - Cero dependencias (solo builtins de Node).
 * - No toca nada de OpenCode. Lee el mismo store: .opencode/memory/catalog.json
 * - Transporte: JSON-RPC 2.0 delimitado por saltos de línea sobre stdin/stdout.
 *   IMPORTANTE: stdout es el canal del protocolo → todo log va a stderr.
 *
 * Root del proyecto: process.env.ATLASMEMORY_ROOT || process.cwd()
 *
 * Registro en Claude Code (.mcp.json en la raíz del proyecto):
 *   { "mcpServers": { "atlasmemory": { "command": "node", "args": ["mcp/server.mjs"] } } }
 */

import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const SERVER_NAME = "atlasmemory"
const SERVER_VERSION = "1.0.0"
const DEFAULT_PROTOCOL = "2024-11-05"

const MEMORY_DIR = ".opencode/memory"
const CATALOG_FILE = "catalog.json"
const META_FILE = "meta.json"
const GENERIC_SUFFIXES = ["data", "dto", "uc", "rs", "mapper", "bean", "enum"]

function projectRoot() {
  return process.env.ATLASMEMORY_ROOT || process.cwd()
}

// ---------------------------------------------------------------------------
// Store (idéntico en semántica a .opencode/tools/catalog.ts)
// ---------------------------------------------------------------------------

let catalogCache = null

function memoryPaths(root) {
  const dir = path.join(root, MEMORY_DIR)
  return {
    dir,
    catalog: path.join(dir, CATALOG_FILE),
    meta: path.join(dir, META_FILE),
    indexer: path.join(root, "scripts", "index-catalog.mjs"),
  }
}

function newestJavaMtime(root) {
  let newest = 0
  function walk(dir) {
    if (!fs.existsSync(dir)) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === "target" || entry.name === "node_modules" || entry.name === ".git") continue
        walk(full)
      } else if (entry.isFile() && entry.name.endsWith(".java")) {
        try {
          const mt = fs.statSync(full).mtimeMs
          if (mt > newest) newest = mt
        } catch {
          /* skip */
        }
      }
    }
  }
  walk(root)
  return newest || null
}

function emptyCatalogError(message) {
  return {
    error: message,
    stale: true,
    staleReason: message,
    components: [],
    relations: [],
    indexes: {},
    meta: null,
  }
}

function loadCatalog(root) {
  const { catalog, meta } = memoryPaths(root)
  if (!fs.existsSync(catalog)) {
    return emptyCatalogError(`Catalog not found at ${catalog}. Run catalog_reindex first.`)
  }

  let catalogMtimeMs
  try {
    catalogMtimeMs = fs.statSync(catalog).mtimeMs
  } catch (e) {
    return emptyCatalogError(`No se pudo leer el catálogo: ${e.message}. Ejecuta catalog_reindex.`)
  }

  if (catalogCache && catalogCache.root === root && catalogCache.catalogMtimeMs === catalogMtimeMs) {
    return catalogCache.payload
  }

  let data
  try {
    data = JSON.parse(fs.readFileSync(catalog, "utf8"))
  } catch (e) {
    return emptyCatalogError(`Catálogo ilegible: ${e.message}. Ejecuta catalog_reindex.`)
  }

  let metaData = null
  if (fs.existsSync(meta)) {
    try {
      metaData = JSON.parse(fs.readFileSync(meta, "utf8"))
    } catch {
      metaData = null
    }
  }

  const components = data.components || data.artifacts || []
  const relations = data.relations || data.edges || []
  const generatedAt = data.generatedAt || metaData?.generatedAt || null
  const generatedMs = generatedAt ? Date.parse(generatedAt) : NaN
  const newest = newestJavaMtime(root)
  const stale = Boolean(newest) && Number.isFinite(generatedMs) && newest > generatedMs
  const staleReason = stale ? "hay fuentes .java más nuevos que el índice — ejecuta catalog_reindex" : null

  const payload = {
    components,
    relations,
    indexes: data.indexes || {},
    meta: metaData,
    stale,
    staleReason,
    warning: staleReason,
    generatedAt,
    project: data.project,
  }

  catalogCache = { root, catalogMtimeMs, payload }
  return payload
}

// ---------------------------------------------------------------------------
// Scoring y helpers (paridad con catalog.ts)
// ---------------------------------------------------------------------------

function suffixIsGeneric(name, q) {
  return GENERIC_SUFFIXES.some(
    (s) => name.endsWith(s) && q.endsWith(s) && !name.startsWith(q.slice(0, -s.length))
  )
}

function scoreMatch(component, query) {
  const q = query.toLowerCase()
  const name = (component.name || "").toLowerCase()
  const fqn = (component.fqn || component.qualifiedName || "").toLowerCase()
  let score = 0
  const methodHits = []

  if (name === q) score = 1.0
  else if (name.startsWith(q)) score = 0.8
  else if (name.endsWith(q)) score = suffixIsGeneric(name, q) ? 0.4 : 0.75
  else if (name.includes(q) || fqn.includes(q)) score = 0.7

  for (const m of component.methods || []) {
    const mn = (m.name || "").toLowerCase()
    if (mn === q) {
      score = Math.max(score, 0.65)
      methodHits.push(m.name)
    } else if (mn.includes(q)) {
      score = Math.max(score, 0.6)
      methodHits.push(m.name)
    }
  }

  for (const t of component.tags || []) {
    if (String(t).toLowerCase() === q || String(t).toLowerCase().includes(q)) {
      score = Math.max(score, 0.5)
    }
  }

  return { score, methodHits }
}

function summarize(c) {
  const out = {
    id: c.id,
    kind: c.kind,
    name: c.name,
    fqn: c.fqn || c.qualifiedName,
    path: c.path,
    module: c.module,
    layer: c.layer,
    implements: c.implements || [],
    extends: c.extends || null,
    tags: c.tags || [],
    summary: c.summary || "",
    methodCount: (c.methods || []).length,
    state: c.state || "implemented",
  }
  if (c.methodsTruncated) out.methodsTruncated = true
  return out
}

function staleFields(catalog) {
  return {
    stale: catalog.stale,
    staleReason: catalog.staleReason || null,
    warning: catalog.warning || null,
    generatedAt: catalog.generatedAt,
  }
}

/**
 * Checklists por defecto (binding Clarisa / hexagonal Jakarta EE).
 * Se sobrescriben por proyecto con `atlasmemory.config.json` → `createHints`.
 */
const DEFAULT_CHECKLISTS = {
  default: {
    layers: ["port", "data"],
    checklist: [
      "Crear IXxxData en usecase/port",
      "Crear XxxData @Stateless en ejb/data extends CRUDData implements IXxxData",
      "emQuery para lecturas / emCommand para escrituras",
      "Filtrar por tenant en consultas de datos del tenant",
      "Si hay UC nuevo: agregar @Produces en UseCaseConfig",
      "Tras crear: catalog_reindex",
    ],
  },
  usecase: {
    layers: ["usecase", "config"],
    checklist: [
      "Crear *UC como POJO en usecase (constructor con puertos)",
      "Agregar @Produces en web/config/UseCaseConfig",
      "No poner lógica de JPA en el UC",
      "Tras crear: catalog_reindex",
    ],
  },
  rest: {
    layers: ["rest"],
    checklist: [
      "Crear *RS en web/rest",
      "Inyectar UC producido por UseCaseConfig",
      "Usar @RolesAllowed y tenant del UsuarioPrincipal",
      "Tras crear: catalog_reindex",
    ],
  },
}

const CONFIG_FILE = "atlasmemory.config.json"
let configCache = null

/** Config opcional del proyecto. Si no existe o es inválida → null (usa defaults). */
function loadConfig(root) {
  const file = path.join(root, CONFIG_FILE)
  let mtimeMs = null
  try {
    mtimeMs = fs.statSync(file).mtimeMs
  } catch {
    return null // no hay config: comportamiento por defecto
  }
  if (configCache && configCache.root === root && configCache.mtimeMs === mtimeMs) {
    return configCache.value
  }
  let value = null
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (e) {
    process.stderr.write(`[atlasmemory] ${CONFIG_FILE} ilegible (${e.message}); usando defaults\n`)
    value = null
  }
  configCache = { root, mtimeMs, value }
  return value
}

function createChecklist(kindHint, root) {
  const hints = loadConfig(root)?.createHints
  const source = hints && typeof hints === "object" ? hints : DEFAULT_CHECKLISTS
  return source[kindHint] || source.default || DEFAULT_CHECKLISTS.default
}

function relatedOf(catalog, component, depth = 1) {
  const byId = new Map(catalog.components.map((c) => [c.id, c]))
  const results = []
  const visited = new Set([component.id])
  let frontier = [component.id]

  for (let d = 0; d < depth; d++) {
    const next = []
    for (const id of frontier) {
      for (const r of catalog.relations) {
        let other = null
        let direction = null
        if (r.from === id) {
          other = r.to
          direction = "out"
        } else if (r.to === id) {
          other = r.from
          direction = "in"
        }
        if (!other || visited.has(`${id}|${r.type}|${other}`)) continue
        visited.add(`${id}|${r.type}|${other}`)
        const target = byId.get(other)
        results.push({
          type: r.type,
          direction,
          from: r.from,
          to: r.to,
          component: target
            ? summarize(target)
            : { id: other, name: other.replace(/^unresolved:/, ""), unresolved: other.startsWith("unresolved:") },
        })
        if (target && d + 1 < depth) next.push(other)
      }
    }
    frontier = next
  }
  return results
}

// ---------------------------------------------------------------------------
// Handlers de las tools (devuelven un string JSON, igual que el plugin OpenCode)
// ---------------------------------------------------------------------------

function toolSearch(args) {
  const catalog = loadCatalog(projectRoot())
  if (catalog.error) return JSON.stringify(catalog, null, 2)

  const limit = Math.min(Math.max(args.limit || 10, 1), 30)
  let list = catalog.components
  if (args.kind) list = list.filter((c) => c.kind === args.kind)
  if (args.layer) list = list.filter((c) => c.layer === args.layer)
  if (args.module) list = list.filter((c) => (c.module || "").includes(args.module))

  const ranked = list
    .map((c) => {
      const { score, methodHits } = scoreMatch(c, args.query)
      return { c, score, methodHits }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return JSON.stringify(
    {
      ...staleFields(catalog),
      count: ranked.length,
      results: ranked.map(({ c, score, methodHits }) => ({ score, ...summarize(c), methodHits })),
      advice: ranked.length ? "REVIEW_CANDIDATES" : "NO_MATCH",
    },
    null,
    2
  )
}

function toolGet(args) {
  const catalog = loadCatalog(projectRoot())
  if (catalog.error) return JSON.stringify(catalog, null, 2)

  let match = null
  if (args.id) match = catalog.components.find((c) => c.id === args.id)
  if (!match && args.name) {
    const hits = catalog.components.filter((c) => c.name === args.name)
    match = hits[0] || null
    if (!match) {
      const fuzzy = catalog.components.filter((c) => c.name.toLowerCase().includes(String(args.name).toLowerCase()))
      match = fuzzy[0] || null
    }
  }
  if (!match && args.path) {
    match = catalog.components.find((c) => (c.path || "").includes(args.path))
  }

  if (!match) {
    return JSON.stringify({ found: false, advice: "NOT_FOUND", ...staleFields(catalog) }, null, 2)
  }

  const includeMethods = args.includeMethods !== false
  const includeRelated = args.includeRelated !== false
  return JSON.stringify(
    {
      found: true,
      ...staleFields(catalog),
      component: {
        ...summarize(match),
        annotations: match.annotations || [],
        package: match.package,
        produces: match.produces || [],
        uses: match.uses || [],
        methods: includeMethods ? match.methods || [] : undefined,
      },
      related: includeRelated ? relatedOf(catalog, match, 1) : undefined,
    },
    null,
    2
  )
}

function toolExists(args) {
  const root = projectRoot()
  const catalog = loadCatalog(root)
  if (catalog.error) return JSON.stringify(catalog, null, 2)

  const fuzzy = args.fuzzy !== false
  let list = catalog.components
  if (args.kind) list = list.filter((c) => c.kind === args.kind)

  // REUSE solo con match exacto (name === args.name). Nunca auto-promover score.
  const exact = list.filter((c) => c.name === args.name)
  const match = exact[0] || null
  const nearMisses = []

  if (fuzzy) {
    const ranked = list
      .map((c) => ({ c, ...scoreMatch(c, args.name) }))
      .filter((x) => x.score >= 0.6 && (!match || x.c.id !== match.id))
      .sort((a, b) => b.score - a.score)
      .slice(0, match ? 5 : 6)
    for (const r of ranked) nearMisses.push({ score: r.score, ...summarize(r.c) })
  }

  if (match) {
    const related = relatedOf(catalog, match, 1)
    const impl = related.filter((r) => r.type === "implements")
    const reuseHint = [
      `Reutilizar ${match.name} (${match.kind}) en ${match.path}.`,
      match.implements?.length ? `Implementa: ${match.implements.join(", ")}.` : "",
      impl.length ? `Relaciones implements: ${impl.map((r) => r.component.name).join(", ")}.` : "",
      "No crear un componente duplicado del mismo rol.",
    ]
      .filter(Boolean)
      .join(" ")

    return JSON.stringify(
      {
        exists: true,
        exact: true,
        ...staleFields(catalog),
        match: { ...summarize(match), methods: (match.methods || []).map((m) => m.name) },
        nearMisses,
        related: related.slice(0, 20),
        advice: "REUSE_EXISTING",
        impact: { reuseHint },
      },
      null,
      2
    )
  }

  const kindHint =
    args.kind ||
    (String(args.name).startsWith("I")
      ? "port"
      : String(args.name).endsWith("UC")
        ? "usecase"
        : String(args.name).endsWith("Data")
          ? "data"
          : String(args.name).endsWith("RS")
            ? "rest"
            : "data")

  return JSON.stringify(
    {
      exists: false,
      exact: false,
      ...staleFields(catalog),
      match: null,
      nearMisses,
      advice: "CREATE_NEW",
      impact: { createHint: createChecklist(kindHint, root) },
    },
    null,
    2
  )
}

function toolRelated(args) {
  const catalog = loadCatalog(projectRoot())
  if (catalog.error) return JSON.stringify(catalog, null, 2)

  const match = catalog.components.find((c) => c.name === args.name)
  if (!match) {
    return JSON.stringify({ found: false, name: args.name, ...staleFields(catalog) }, null, 2)
  }
  const depth = Math.min(Math.max(args.depth || 1, 1), 2)
  return JSON.stringify(
    { found: true, ...staleFields(catalog), component: summarize(match), related: relatedOf(catalog, match, depth) },
    null,
    2
  )
}

function toolReindex(_args) {
  const root = projectRoot()
  const { indexer, catalog, meta } = memoryPaths(root)
  if (!fs.existsSync(indexer)) {
    return JSON.stringify({ ok: false, error: `Indexer not found: ${indexer}` }, null, 2)
  }
  const result = spawnSync(process.execPath, [indexer, "--root", root], { cwd: root, encoding: "utf8", timeout: 120000 })
  catalogCache = null
  if (result.status !== 0) {
    return JSON.stringify({ ok: false, status: result.status, stdout: result.stdout, stderr: result.stderr }, null, 2)
  }
  let artifactCount = null
  let generatedAt = null
  if (fs.existsSync(meta)) {
    try {
      const m = JSON.parse(fs.readFileSync(meta, "utf8"))
      artifactCount = m.artifactCount
      generatedAt = m.generatedAt
    } catch {
      /* ignore */
    }
  }
  return JSON.stringify(
    { ok: true, artifactCount, generatedAt, catalogPath: catalog, log: (result.stdout || "").trim() },
    null,
    2
  )
}

// ---------------------------------------------------------------------------
// Definición de tools (nombre → schema + handler)
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "catalog_exists",
    description:
      "MUST call before creating any *Data, I* port, *UC, entity, or mapper. Checks project memory for an existing component and returns REUSE_EXISTING or CREATE_NEW with impact checklist.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Candidate name e.g. DocEquivalentePosData or IDocEquivalentePosData" },
        kind: { type: "string", description: "Optional kind filter" },
        fuzzy: { type: "boolean", description: "Include near matches in nearMisses (default true)" },
      },
      required: ["name"],
    },
    handler: toolExists,
  },
  {
    name: "catalog_search",
    description:
      "Search the project memory catalog for existing components (Data, ports I*, UC, entities, mappers, REST). MUST use before creating new persistence adapters or ports.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name fragment, method name, or tag (e.g. DocEquivalentePos, pagin, pos)" },
        kind: { type: "string", description: "Optional kind: port|data|usecase|bean|entity|mapper|rest|dto|enum|config|util|other" },
        layer: { type: "string", description: "Optional layer: domain|usecase|ejb|web" },
        module: { type: "string", description: "Optional Maven module name fragment" },
        limit: { type: "number", description: "Max results (default 10, max 30)" },
      },
      required: ["query"],
    },
    handler: toolSearch,
  },
  {
    name: "catalog_get",
    description: "Get full detail of a project memory component by name, id, or path, including methods and relations.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Simple class/interface name" },
        id: { type: "string", description: "Component id (kind:fqn)" },
        path: { type: "string", description: "Relative path fragment" },
        includeMethods: { type: "boolean", description: "Include methods (default true)" },
        includeRelated: { type: "boolean", description: "Include relations (default true)" },
      },
    },
    handler: toolGet,
  },
  {
    name: "catalog_related",
    description: "Return relation graph neighbors for a component (implements, uses, produces, extends).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Component simple name" },
        depth: { type: "number", description: "Depth 1-2 (default 1)" },
      },
      required: ["name"],
    },
    handler: toolRelated,
  },
  {
    name: "catalog_reindex",
    description: "Regenerate project memory catalog.json from current Java sources (run after adding/removing components).",
    inputSchema: {
      type: "object",
      properties: { force: { type: "boolean", description: "Force reindex (default true)" } },
    },
    handler: toolReindex,
  },
]

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))

// ---------------------------------------------------------------------------
// Transporte MCP: JSON-RPC 2.0 delimitado por líneas sobre stdin/stdout
// ---------------------------------------------------------------------------

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n")
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result })
}

function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } })
}

function handleMessage(msg) {
  // Notificaciones (sin id) no llevan respuesta.
  const isNotification = msg.id === undefined || msg.id === null
  const { method, params, id } = msg

  if (method === "initialize") {
    const requested = params?.protocolVersion
    reply(id, {
      protocolVersion: typeof requested === "string" ? requested : DEFAULT_PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    })
    return
  }

  if (method === "notifications/initialized" || method === "initialized") return
  if (method === "ping") {
    if (!isNotification) reply(id, {})
    return
  }

  if (method === "tools/list") {
    reply(id, { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) })
    return
  }

  if (method === "tools/call") {
    const name = params?.name
    const tool = TOOL_BY_NAME.get(name)
    if (!tool) {
      replyError(id, -32602, `Unknown tool: ${name}`)
      return
    }
    try {
      const text = tool.handler(params?.arguments || {})
      reply(id, { content: [{ type: "text", text }], isError: false })
    } catch (e) {
      reply(id, { content: [{ type: "text", text: `Error en ${name}: ${e.message}` }], isError: true })
    }
    return
  }

  if (isNotification) return
  replyError(id, -32601, `Method not found: ${method}`)
}

function main() {
  process.stderr.write(`[atlasmemory] MCP server v${SERVER_VERSION} — root=${projectRoot()}\n`)
  let buffer = ""
  process.stdin.setEncoding("utf8")
  process.stdin.on("data", (chunk) => {
    buffer += chunk
    let nl
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        process.stderr.write(`[atlasmemory] JSON inválido ignorado: ${line.slice(0, 120)}\n`)
        continue
      }
      try {
        handleMessage(msg)
      } catch (e) {
        process.stderr.write(`[atlasmemory] error manejando mensaje: ${e.message}\n`)
      }
    }
  })
  process.stdin.on("end", () => process.exit(0))
}

main()

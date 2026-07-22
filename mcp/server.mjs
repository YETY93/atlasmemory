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
import { spawnSync } from "node:child_process"
import {
  memoryPaths,
  loadCatalog,
  scoreMatch,
  summarize,
  staleFields,
  createChecklist,
  relatedOf,
  invalidateCatalogCache,
  setEngineLogger,
} from "../lib/catalog-engine.mjs"

const SERVER_NAME = "atlasmemory"
const SERVER_VERSION = "1.0.0"
const DEFAULT_PROTOCOL = "2024-11-05"

function projectRoot() {
  return process.env.ATLASMEMORY_ROOT || process.cwd()
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
  invalidateCatalogCache()
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
  setEngineLogger((m) => process.stderr.write("[atlasmemory] " + m + "\n"))
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

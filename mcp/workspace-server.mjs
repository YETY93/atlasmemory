#!/usr/bin/env node
/**
 * atlasmemory workspace — servidor MCP cross-repo.
 *
 * Binding de nivel 2: consulta N memorias de proyecto a la vez. Se registra bajo
 * el nombre `atlasworkspace`, así convive con el servidor local `atlasmemory`
 * dentro de un mismo repo sin colisión de nombres de tools.
 *
 * Root del workspace: ATLASMEMORY_WORKSPACE || directorio padre de este script.
 * Se resuelve por ubicación del script (no por cwd) porque los repos hijos lo
 * lanzan con `node ../atlasmemory-workspace/mcp/workspace-server.mjs`, donde cwd
 * es el hijo.
 */

import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { invalidateCatalogCache } from "../lib/catalog-engine.mjs"
import {
  buildWorkspaceIndex,
  getFromProject,
  groupByName,
  loadRegistry,
  loadWorkspaceIndex,
  resolveWorkspaceDir,
  searchWorkspace,
  staleProjects,
  writeWorkspaceIndex,
} from "../lib/workspace-engine.mjs"

const SERVER_NAME = "atlasworkspace"
const SERVER_VERSION = "1.0.0"
const DEFAULT_PROTOCOL = "2024-11-05"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const WORKSPACE = resolveWorkspaceDir(path.join(scriptDir, ".."))

/** Aviso de frescura común a todas las respuestas de lectura. */
function freshness(index) {
  const stale = staleProjects(WORKSPACE, index)
  return {
    builtAt: index.builtAt || null,
    staleProjects: stale,
    warning: stale.length
      ? `Índice desactualizado para: ${stale.join(", ")} — ejecutá workspace_reindex`
      : null,
  }
}

function toolSearch(args) {
  const index = loadWorkspaceIndex(WORKSPACE)
  if (index.error) return JSON.stringify(index, null, 2)

  const hits = searchWorkspace(index, args)
  const grouped = groupByName(hits)
  const multi = grouped.filter((g) => g.copies > 1)

  return JSON.stringify(
    {
      ...freshness(index),
      count: hits.length,
      results: hits,
      // Nunca REUSE_EXISTING: los repos del workspace no dependen entre sí, así
      // que un componente ajeno no es importable. Es un patrón a copiar.
      advice: hits.length ? "PRECEDENT_FOUND" : "NO_MATCH",
      note: hits.length
        ? "Componentes de otro proyecto NO son importables salvo que exista dependencia Maven entre los repos. Usalos como precedente: copiá el patrón, no la clase."
        : null,
      sameNameInSeveralProjects: multi.length ? multi : undefined,
    },
    null,
    2
  )
}

function toolGet(args) {
  const index = loadWorkspaceIndex(WORKSPACE)
  const result = getFromProject(WORKSPACE, args)
  return JSON.stringify({ ...(index.error ? {} : freshness(index)), ...result }, null, 2)
}

function toolProjects() {
  const index = loadWorkspaceIndex(WORKSPACE)
  const { projects, error, registryPath } = loadRegistry(WORKSPACE)
  return JSON.stringify(
    {
      workspace: WORKSPACE,
      registryPath,
      error,
      ...(index.error ? { indexError: index.error } : freshness(index)),
      projects: projects.map((p) => {
        const known = (index.projects || []).find((x) => x.id === p.id)
        return {
          id: p.id,
          path: p.declaredPath,
          hasCatalog: p.exists,
          components: known?.components ?? null,
          generatedAt: known?.generatedAt ?? null,
        }
      }),
    },
    null,
    2
  )
}

function toolReindex(args) {
  // Reindexar un proyecto = delegar en SU indexer. El workspace nunca parsea Java.
  const reindexed = []
  if (args.project) {
    const { projects } = loadRegistry(WORKSPACE)
    const target = projects.find((p) => p.id === args.project)
    if (!target) {
      return JSON.stringify({ ok: false, error: `Proyecto '${args.project}' no está en el registry` }, null, 2)
    }
    const indexer = path.join(target.root, "scripts", "index-catalog.mjs")
    const r = spawnSync(process.execPath, [indexer, "--root", target.root], {
      cwd: target.root,
      encoding: "utf8",
      timeout: 180000,
    })
    if (r.status !== 0) {
      return JSON.stringify({ ok: false, project: args.project, stderr: r.stderr, stdout: r.stdout }, null, 2)
    }
    invalidateCatalogCache(target.root)
    reindexed.push(args.project)
  }

  invalidateCatalogCache()
  const { index, warnings } = buildWorkspaceIndex(WORKSPACE)
  const written = writeWorkspaceIndex(WORKSPACE, index)
  return JSON.stringify(
    {
      ok: true,
      reindexedProjects: reindexed,
      builtAt: index.builtAt,
      totalComponents: index.entries.length,
      projects: index.projects.map((p) => ({ id: p.id, components: p.components })),
      warnings,
      indexPath: written,
    },
    null,
    2
  )
}

const TOOLS = [
  {
    name: "workspace_search",
    description:
      "Search for PRECEDENT across all sibling projects in the workspace: has this kind of component already been built in another repo? Returns hits tagged with their project. Results are NOT importable unless a Maven dependency exists between the repos — treat them as patterns to copy. Use after the local catalog_exists returns CREATE_NEW.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name fragment, method name, or tag (e.g. Ciudad, DocEquivalente, pagin)" },
        project: { type: "string", description: "Optional: restrict to one project id" },
        kind: { type: "string", description: "Optional kind: port|data|usecase|bean|entity|mapper|rest|dto|enum|config|util|other" },
        limit: { type: "number", description: "Max results (default 10, max 40)" },
      },
      required: ["query"],
    },
    handler: toolSearch,
  },
  {
    name: "workspace_get",
    description:
      "Get the full detail (methods, annotations, relations) of a component that lives in another project, to study how it was implemented there.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Simple class/interface name" },
        project: { type: "string", description: "Project id that owns it (from workspace_search results)" },
        includeMethods: { type: "boolean", description: "Include method signatures (default true)" },
      },
      required: ["name", "project"],
    },
    handler: toolGet,
  },
  {
    name: "workspace_projects",
    description: "List the projects registered in the workspace, their component counts and index freshness.",
    inputSchema: { type: "object", properties: {} },
    handler: toolProjects,
  },
  {
    name: "workspace_reindex",
    description:
      "Rebuild the workspace index from the child catalogs. With `project`, first re-runs that project's own Java indexer.",
    inputSchema: {
      type: "object",
      properties: { project: { type: "string", description: "Optional project id to reindex from Java sources first" } },
    },
    handler: toolReindex,
  },
]

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))

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
    const tool = TOOL_BY_NAME.get(params?.name)
    if (!tool) {
      replyError(id, -32602, `Unknown tool: ${params?.name}`)
      return
    }
    try {
      reply(id, { content: [{ type: "text", text: tool.handler(params?.arguments || {}) }], isError: false })
    } catch (e) {
      reply(id, { content: [{ type: "text", text: `Error en ${params.name}: ${e.message}` }], isError: true })
    }
    return
  }
  if (isNotification) return
  replyError(id, -32601, `Method not found: ${method}`)
}

function main() {
  process.stderr.write(`[atlasworkspace] MCP server v${SERVER_VERSION} — workspace=${WORKSPACE}\n`)
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
        process.stderr.write(`[atlasworkspace] JSON inválido ignorado: ${line.slice(0, 120)}\n`)
        continue
      }
      try {
        handleMessage(msg)
      } catch (e) {
        process.stderr.write(`[atlasworkspace] error manejando mensaje: ${e.message}\n`)
      }
    }
  })
  process.stdin.on("end", () => process.exit(0))
}

main()

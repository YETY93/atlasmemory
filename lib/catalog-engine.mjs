#!/usr/bin/env node
/**
 * @file Atlasmemory catalog engine — shared logic between OpenCode and MCP bindings.
 *
 * ESM puro, zero deps. Contains all catalog loading, scoring, staleness,
 * summarization, checklists and graph traversal helpers used by both bindings.
 */

import fs from "node:fs"
import path from "node:path"

const MEMORY_DIR = ".opencode/memory"
const CATALOG_FILE = "catalog.json"
const META_FILE = "meta.json"
const CONFIG_FILE = "atlasmemory.config.json"

export const GENERIC_SUFFIXES = ["data", "dto", "uc", "rs", "mapper", "bean", "enum"]

/** @type {{ root: string, catalogMtimeMs: number, payload: object } | null} */
let catalogCache = null

/** @type {{ root: string, mtimeMs: number, value: object | null } | null} */
let configCache = null

/** @type {(message: string) => void} */
let engineLogger = () => {}

/**
 * Set a logging callback. The engine is silent by default.
 * @param {(message: string) => void} fn
 */
export function setEngineLogger(fn) {
  engineLogger = typeof fn === "function" ? fn : () => {}
}

/**
 * Return the memory file paths for a project root.
 * @param {string} root
 * @returns {{ dir: string, catalog: string, meta: string, indexer: string }}
 */
export function memoryPaths(root) {
  const dir = path.join(root, MEMORY_DIR)
  return {
    dir,
    catalog: path.join(dir, CATALOG_FILE),
    meta: path.join(dir, META_FILE),
    indexer: path.join(root, "scripts", "index-catalog.mjs"),
  }
}

/**
 * Find the most recent mtime of any Java source under `src/main/java` (`*.java`).
 * @param {string} root
 * @returns {number | null}
 */
export function newestJavaMtime(root) {
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

/**
 * Build a graceful error payload when the catalog is missing/illegible.
 * @param {string} message
 * @returns {object}
 */
export function emptyCatalogError(message) {
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

/**
 * Load and cache the catalog for a project root.
 *
 * Staleness compares `newestJavaMtime(root)` with `meta.generatedAt`.
 * It does **not** recompute/compare `meta.contentHash`.
 *
 * @param {string} root
 * @returns {CatalogPayload}
 */
export function loadCatalog(root) {
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
  const staleReason = stale
    ? "hay fuentes .java más nuevos que el índice — ejecuta catalog_reindex"
    : null

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

/**
 * Invalidate the in-memory catalog cache. Call after reindexing.
 */
export function invalidateCatalogCache() {
  catalogCache = null
}

/**
 * Check whether a suffix match is generic noise (e.g. `Data`, `Dto`).
 * @param {string} name
 * @param {string} q
 * @returns {boolean}
 */
export function suffixIsGeneric(name, q) {
  return GENERIC_SUFFIXES.some(
    (s) =>
      name.endsWith(s) &&
      q.endsWith(s) &&
      !name.startsWith(q.slice(0, -s.length))
  )
}

/**
 * Score how well a component matches a query.
 * @param {object} component
 * @param {string} query
 * @returns {{ score: number, methodHits: string[] }}
 */
export function scoreMatch(component, query) {
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

/**
 * Build a public summary of a component.
 * @param {object} c
 * @returns {object}
 */
export function summarize(c) {
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

/**
 * Extract staleness fields from a loaded catalog payload.
 * @param {CatalogPayload} catalog
 * @returns {object}
 */
export function staleFields(catalog) {
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
export const DEFAULT_CHECKLISTS = {
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

/**
 * Load optional project config. Returns null if missing or invalid (uses defaults).
 * @param {string} root
 * @returns {object | null}
 */
export function loadConfig(root) {
  const file = path.join(root, CONFIG_FILE)
  let mtimeMs = null
  try {
    mtimeMs = fs.statSync(file).mtimeMs
  } catch {
    return null
  }
  if (configCache && configCache.root === root && configCache.mtimeMs === mtimeMs) {
    return configCache.value
  }
  let value = null
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (e) {
    engineLogger(`${CONFIG_FILE} ilegible (${e.message}); usando defaults`)
    value = null
  }
  configCache = { root, mtimeMs, value }
  return value
}

/**
 * Pick a creation checklist by kind hint.
 * @param {string} kindHint
 * @param {string} root
 * @returns {object}
 */
export function createChecklist(kindHint, root) {
  const hints = loadConfig(root)?.createHints
  const source = hints && typeof hints === "object" ? hints : DEFAULT_CHECKLISTS
  return source[kindHint] || source.default || DEFAULT_CHECKLISTS.default
}

/**
 * Return related components up to a given depth.
 * @param {CatalogPayload} catalog
 * @param {object} component
 * @param {number} [depth]
 * @returns {object[]}
 */
export function relatedOf(catalog, component, depth = 1) {
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
            : {
                id: other,
                name: other.replace(/^unresolved:/, ""),
                unresolved: other.startsWith("unresolved:"),
              },
        })
        if (target && d + 1 < depth) next.push(other)
      }
    }
    frontier = next
  }
  return results
}

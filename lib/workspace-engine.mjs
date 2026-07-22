#!/usr/bin/env node
/**
 * @file Atlasmemory workspace engine — vista cross-repo sobre N memorias de proyecto.
 *
 * Nivel 2 del producto. El nivel 1 (memoria de un repo) sigue siendo la fuente de
 * verdad: este motor NO parsea Java, solo agrega los `catalog.json` ya generados
 * por cada proyecto.
 *
 * ## Por qué "precedente" y no "reuso"
 *
 * Los repos de un workspace suelen ser desplegables independientes sin dependencia
 * Maven entre sí. Un componente de otro repo **no es importable**: recomendarlo
 * como `REUSE_EXISTING` produciría código que no compila. Por eso este motor nunca
 * emite ese consejo — emite `PRECEDENT_FOUND`: "esto ya se resolvió allá, copiá el
 * patrón". La decisión de reutilizar de verdad sigue siendo del binding local.
 *
 * ESM puro, zero deps.
 */

import fs from "node:fs"
import path from "node:path"

import { loadCatalog, memoryPaths, scoreMatch, summarize } from "./catalog-engine.mjs"

export const REGISTRY_FILE = "atlasmemory.workspace.json"
export const INDEX_FILE = path.join("memory", "workspace-index.json")

/** Campos que van al índice liviano. Deliberadamente sin `methods` completos. */
const INDEX_FIELDS = ["id", "kind", "name", "fqn", "path", "module", "layer", "tags"]

/**
 * Resuelve el directorio del workspace.
 * Prioridad: env explícito → ubicación del script que llama → cwd.
 * Se resuelve por ubicación y no por cwd porque el servidor MCP se lanza también
 * desde repos hijos (`node ../atlasmemory-workspace/mcp/workspace-server.mjs`),
 * donde cwd es el hijo, no el workspace.
 * @param {string} [fallbackDir]
 * @returns {string}
 */
export function resolveWorkspaceDir(fallbackDir) {
  if (process.env.ATLASMEMORY_WORKSPACE) return path.resolve(process.env.ATLASMEMORY_WORKSPACE)
  if (fallbackDir) return path.resolve(fallbackDir)
  return process.cwd()
}

/**
 * Lee el registry de proyectos y resuelve sus rutas a absolutas.
 * @param {string} workspaceDir
 * @returns {{ projects: WorkspaceProject[], error: string|null, registryPath: string }}
 */
export function loadRegistry(workspaceDir) {
  const registryPath = path.join(workspaceDir, REGISTRY_FILE)
  if (!fs.existsSync(registryPath)) {
    return { projects: [], error: `No hay registry en ${registryPath}`, registryPath }
  }
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(registryPath, "utf8"))
  } catch (e) {
    return { projects: [], error: `Registry ilegible: ${e.message}`, registryPath }
  }

  const projects = []
  for (const entry of raw.projects || []) {
    if (!entry || entry.enabled === false) continue
    if (!entry.id || !entry.path) continue
    const root = path.resolve(workspaceDir, entry.path)
    projects.push({
      id: entry.id,
      root,
      // Se conserva la ruta relativa del registry: es lo que el dev editó y lo
      // que hay que mostrarle si algo no resuelve.
      declaredPath: entry.path,
      exists: fs.existsSync(memoryPaths(root).catalog),
    })
  }
  return { projects, error: null, registryPath }
}

/**
 * mtime del `catalog.json` de un proyecto (null si no existe).
 * Es el chequeo de frescura barato del workspace: N stats en vez de N recorridos
 * completos del árbol `.java`.
 * @param {string} root
 * @returns {number|null}
 */
export function catalogMtime(root) {
  try {
    return fs.statSync(memoryPaths(root).catalog).mtimeMs
  } catch {
    return null
  }
}

/**
 * Construye el índice liviano a partir de los catálogos hijos.
 * No copia `methods` (solo su cantidad y nombres): 1762 componentes caben en
 * ~250 KB en vez de los ~4 MB que pesan los catálogos completos sumados.
 * @param {string} workspaceDir
 * @returns {{ index: object, warnings: string[] }}
 */
export function buildWorkspaceIndex(workspaceDir) {
  const { projects, error } = loadRegistry(workspaceDir)
  const warnings = []
  if (error) warnings.push(error)

  const entries = []
  const projectMeta = []

  for (const p of projects) {
    if (!p.exists) {
      warnings.push(`${p.id}: sin catalog.json en ${p.declaredPath} — corré 'node scripts/index-catalog.mjs' en ese repo`)
      projectMeta.push({ id: p.id, path: p.declaredPath, components: 0, catalogMtimeMs: null, generatedAt: null })
      continue
    }
    const catalog = loadCatalog(p.root, { checkSources: false })
    if (catalog.error) {
      warnings.push(`${p.id}: ${catalog.error}`)
      continue
    }
    for (const c of catalog.components) {
      const entry = { project: p.id }
      for (const f of INDEX_FIELDS) if (c[f] !== undefined) entry[f] = c[f]
      const methods = c.methods || []
      entry.methodCount = methods.length
      entry.methodNames = methods.map((m) => m.name)
      if (c.implements?.length) entry.implements = c.implements
      if (c.extends) entry.extends = c.extends
      entries.push(entry)
    }
    projectMeta.push({
      id: p.id,
      path: p.declaredPath,
      components: catalog.components.length,
      catalogMtimeMs: catalogMtime(p.root),
      generatedAt: catalog.generatedAt || null,
    })
  }

  return {
    index: {
      version: 1,
      kind: "atlasmemory-workspace-index",
      builtAt: new Date().toISOString(),
      projects: projectMeta,
      entries,
    },
    warnings,
  }
}

/**
 * Carga el índice del workspace desde disco.
 * @param {string} workspaceDir
 * @returns {object}
 */
export function loadWorkspaceIndex(workspaceDir) {
  const file = path.join(workspaceDir, INDEX_FILE)
  if (!fs.existsSync(file)) {
    return { error: `No hay índice en ${file}. Ejecutá workspace_reindex.`, entries: [], projects: [] }
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (e) {
    return { error: `Índice ilegible: ${e.message}. Ejecutá workspace_reindex.`, entries: [], projects: [] }
  }
}

/**
 * Escribe el índice.
 * @param {string} workspaceDir
 * @param {object} index
 * @returns {string} ruta escrita
 */
export function writeWorkspaceIndex(workspaceDir, index) {
  const file = path.join(workspaceDir, INDEX_FILE)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  // Compacto: solo lo lee este motor, y la indentación pesa ~40% del archivo.
  fs.writeFileSync(file, JSON.stringify(index))
  return file
}

/**
 * Proyectos cuyo `catalog.json` cambió después de construirse el índice.
 * @param {string} workspaceDir
 * @param {object} index
 * @returns {string[]} ids desactualizados
 */
export function staleProjects(workspaceDir, index) {
  const { projects } = loadRegistry(workspaceDir)
  const byId = new Map((index.projects || []).map((p) => [p.id, p]))
  const stale = []
  for (const p of projects) {
    const known = byId.get(p.id)
    const now = catalogMtime(p.root)
    if (!known) {
      stale.push(p.id)
      continue
    }
    if (now && known.catalogMtimeMs && now > known.catalogMtimeMs) stale.push(p.id)
    if (now && !known.catalogMtimeMs) stale.push(p.id)
  }
  return stale
}

/**
 * Busca componentes en todos los proyectos del workspace.
 *
 * Reutiliza `scoreMatch` del engine local, así el ranking es el mismo que ve el
 * dev dentro de un repo — incluida la penalización por sufijo genérico.
 *
 * @param {object} index
 * @param {{ query: string, project?: string, kind?: string, limit?: number }} args
 * @returns {object[]}
 */
export function searchWorkspace(index, args) {
  const limit = Math.min(Math.max(args.limit || 10, 1), 40)
  let list = index.entries || []
  if (args.project) list = list.filter((e) => e.project === args.project)
  if (args.kind) list = list.filter((e) => e.kind === args.kind)

  return list
    .map((e) => {
      // scoreMatch espera `methods` como objetos; el índice guarda solo nombres.
      const { score, methodHits } = scoreMatch(
        { ...e, methods: (e.methodNames || []).map((name) => ({ name })) },
        args.query
      )
      return { score, methodHits, entry: e }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, limit)
    .map(({ score, methodHits, entry }) => ({
      score,
      project: entry.project,
      kind: entry.kind,
      name: entry.name,
      fqn: entry.fqn,
      path: entry.path,
      module: entry.module,
      layer: entry.layer,
      implements: entry.implements || [],
      extends: entry.extends || null,
      tags: entry.tags || [],
      methodCount: entry.methodCount,
      methodHits,
    }))
}

/**
 * Agrupa hits por nombre simple para exponer en cuántos proyectos vive cada uno.
 *
 * Distingue proyectos de copias: un repo monolítico puede tener el mismo nombre
 * dos veces en paquetes distintos, y eso no es lo mismo que estar en dos repos.
 * @param {object[]} hits
 * @returns {object[]}
 */
export function groupByName(hits) {
  const groups = new Map()
  for (const h of hits) {
    if (!groups.has(h.name)) groups.set(h.name, [])
    groups.get(h.name).push(h)
  }
  return [...groups.entries()].map(([name, items]) => ({
    name,
    projects: [...new Set(items.map((i) => i.project))],
    copies: items.length,
    // Señal barata de divergencia: si las copias no exponen la misma cantidad de
    // métodos, seguro se separaron. (Igual cantidad no prueba que sean iguales.)
    methodCounts: [...new Set(items.map((i) => i.methodCount))].sort((a, b) => a - b),
  }))
}

/**
 * Detalle completo de un componente: carga el catálogo del proyecto dueño bajo
 * demanda (el índice liviano no guarda firmas de métodos).
 * @param {string} workspaceDir
 * @param {{ name: string, project: string, includeMethods?: boolean }} args
 * @returns {object}
 */
export function getFromProject(workspaceDir, args) {
  const { projects } = loadRegistry(workspaceDir)
  const target = projects.find((p) => p.id === args.project)
  if (!target) {
    return { found: false, error: `Proyecto '${args.project}' no está en el registry`, known: projects.map((p) => p.id) }
  }
  const catalog = loadCatalog(target.root, { checkSources: false })
  if (catalog.error) return { found: false, error: catalog.error }

  const matches = catalog.components.filter((c) => c.name === args.name)
  if (matches.length === 0) {
    return { found: false, error: `'${args.name}' no existe en '${args.project}'` }
  }

  // Los homónimos dentro de un mismo repo son reales (medidos: 6 en factura).
  // Devolverlos todos en vez de un .find() silencioso.
  return {
    found: true,
    project: args.project,
    ambiguous: matches.length > 1,
    components: matches.map((m) => ({
      ...summarize(m),
      package: m.package,
      annotations: m.annotations || [],
      uses: m.uses || [],
      methods: args.includeMethods === false ? undefined : m.methods || [],
    })),
  }
}

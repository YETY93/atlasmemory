import { tool } from "@opencode-ai/plugin"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * Binding OpenCode del workspace de atlasmemory (nivel 2, cross-repo).
 *
 * A diferencia de `catalog.ts`, este archivo NO importa el motor de forma estática:
 * el mismo archivo se instala en la carpeta padre y en cada repo hijo, y la ruta
 * relativa al workspace cambia según dónde esté. Se resuelve en tiempo de ejecución
 * a partir del root que reporta OpenCode y se carga el motor con `import()`.
 */

const WORKSPACE_DIRNAME = "atlasmemory-workspace"
const REGISTRY_FILE = "atlasmemory.workspace.json"

function resolveRoot(context) {
  return context?.worktree || context?.directory || process.cwd()
}

/**
 * Busca el directorio del workspace: primero el env, después junto al root
 * (OpenCode abierto en el padre) y subiendo (OpenCode abierto en un repo hijo).
 * @returns {string | null}
 */
function findWorkspaceDir(startDir) {
  if (process.env.ATLASMEMORY_WORKSPACE) return path.resolve(process.env.ATLASMEMORY_WORKSPACE)

  let dir = path.resolve(startDir)
  for (let i = 0; i < 4; i++) {
    for (const candidate of [path.join(dir, WORKSPACE_DIRNAME), dir]) {
      if (fs.existsSync(path.join(candidate, REGISTRY_FILE))) return candidate
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** Carga el motor desde el workspace encontrado. */
async function loadEngine(context) {
  const workspaceDir = findWorkspaceDir(resolveRoot(context))
  if (!workspaceDir) {
    return {
      error: `No se encontró ${WORKSPACE_DIRNAME}/${REGISTRY_FILE} cerca de ${resolveRoot(context)}. Instalá el workspace con 'node install-workspace.mjs <carpeta padre>'.`,
    }
  }
  const engineFile = path.join(workspaceDir, "lib", "workspace-engine.mjs")
  if (!fs.existsSync(engineFile)) {
    return { error: `Workspace incompleto: falta ${engineFile}` }
  }
  return { workspaceDir, engine: await import(pathToFileURL(engineFile).href) }
}

/** Aviso de frescura común a las respuestas de lectura. */
function freshness(engine, workspaceDir, index) {
  const stale = engine.staleProjects(workspaceDir, index)
  return {
    builtAt: index.builtAt || null,
    staleProjects: stale,
    warning: stale.length ? `Índice desactualizado para: ${stale.join(", ")} — ejecutá workspace_reindex` : null,
  }
}

export const workspace_search = tool({
  description:
    "Search for PRECEDENT across all sibling projects in the workspace: has this kind of component already been built in another repo? Returns hits tagged with their project. Results are NOT importable unless a Maven dependency exists between the repos — treat them as patterns to copy. Use after the local catalog_exists returns CREATE_NEW.",
  args: {
    query: tool.schema.string().describe("Name fragment, method name, or tag (e.g. Ciudad, DocEquivalente, pagin)"),
    project: tool.schema.string().optional().describe("Optional: restrict to one project id"),
    kind: tool.schema
      .string()
      .optional()
      .describe("Optional kind: port|data|usecase|bean|entity|mapper|rest|dto|enum|config|util|other"),
    limit: tool.schema.number().optional().describe("Max results (default 10, max 40)"),
  },
  async execute(args, context) {
    const { engine, workspaceDir, error } = await loadEngine(context)
    if (error) return JSON.stringify({ error }, null, 2)

    const index = engine.loadWorkspaceIndex(workspaceDir)
    if (index.error) return JSON.stringify(index, null, 2)

    const hits = engine.searchWorkspace(index, args)
    const multi = engine.groupByName(hits).filter((g) => g.copies > 1)

    return JSON.stringify(
      {
        ...freshness(engine, workspaceDir, index),
        count: hits.length,
        results: hits,
        // Nunca REUSE_EXISTING: sin dependencia Maven entre repos, un componente
        // ajeno no es importable.
        advice: hits.length ? "PRECEDENT_FOUND" : "NO_MATCH",
        note: hits.length
          ? "Componentes de otro proyecto NO son importables salvo que exista dependencia Maven entre los repos. Usalos como precedente: copiá el patrón, no la clase."
          : null,
        sameNameInSeveralProjects: multi.length ? multi : undefined,
      },
      null,
      2
    )
  },
})

export const workspace_get = tool({
  description:
    "Get the full detail (methods, annotations, ports used) of a component that lives in another project, to study how it was implemented there.",
  args: {
    name: tool.schema.string().describe("Simple class/interface name"),
    project: tool.schema.string().describe("Project id that owns it (from workspace_search results)"),
    includeMethods: tool.schema.boolean().optional().describe("Include method signatures (default true)"),
  },
  async execute(args, context) {
    const { engine, workspaceDir, error } = await loadEngine(context)
    if (error) return JSON.stringify({ error }, null, 2)

    const index = engine.loadWorkspaceIndex(workspaceDir)
    const result = engine.getFromProject(workspaceDir, args)
    return JSON.stringify(
      { ...(index.error ? {} : freshness(engine, workspaceDir, index)), ...result },
      null,
      2
    )
  },
})

export const workspace_projects = tool({
  description: "List the projects registered in the workspace, their component counts and index freshness.",
  args: {},
  async execute(_args, context) {
    const { engine, workspaceDir, error } = await loadEngine(context)
    if (error) return JSON.stringify({ error }, null, 2)

    const index = engine.loadWorkspaceIndex(workspaceDir)
    const { projects, registryPath, error: registryError } = engine.loadRegistry(workspaceDir)

    return JSON.stringify(
      {
        workspace: workspaceDir,
        registryPath,
        error: registryError,
        ...(index.error ? { indexError: index.error } : freshness(engine, workspaceDir, index)),
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
  },
})

export const workspace_reindex = tool({
  description:
    "Rebuild the workspace index from the child catalogs. With `project`, first re-runs that project's own Java indexer.",
  args: {
    project: tool.schema.string().optional().describe("Optional project id to reindex from Java sources first"),
  },
  async execute(args, context) {
    const { engine, workspaceDir, error } = await loadEngine(context)
    if (error) return JSON.stringify({ error }, null, 2)

    const { spawnSync } = await import("node:child_process")
    const reindexed = []

    // Reindexar un proyecto = delegar en SU indexer. El workspace nunca parsea Java.
    if (args.project) {
      const { projects } = engine.loadRegistry(workspaceDir)
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
      reindexed.push(args.project)
    }

    const { index, warnings } = engine.buildWorkspaceIndex(workspaceDir)
    const written = engine.writeWorkspaceIndex(workspaceDir, index)
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
  },
})

import { tool } from "@opencode-ai/plugin"
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
} from "../../lib/catalog-engine.mjs"

function resolveRoot(context) {
  return context?.worktree || context?.directory || process.cwd()
}

export const search = tool({
  description:
    "Search the project memory catalog for existing components (Data, ports I*, UC, entities, mappers, REST). MUST use before creating new persistence adapters or ports.",
  args: {
    query: tool.schema.string().describe("Name fragment, method name, or tag (e.g. DocEquivalentePos, pagin, pos)"),
    kind: tool.schema
      .string()
      .optional()
      .describe("Optional kind filter: port|data|usecase|bean|entity|mapper|rest|dto|enum|config|util|other"),
    layer: tool.schema.string().optional().describe("Optional layer: domain|usecase|ejb|web"),
    module: tool.schema.string().optional().describe("Optional Maven module name fragment"),
    limit: tool.schema.number().optional().describe("Max results (default 10, max 30)"),
  },
  async execute(args, context) {
    const root = resolveRoot(context)
    const catalog = loadCatalog(root)
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
        results: ranked.map(({ c, score, methodHits }) => ({
          score,
          ...summarize(c),
          methodHits,
        })),
        advice: ranked.length ? "REVIEW_CANDIDATES" : "NO_MATCH",
      },
      null,
      2
    )
  },
})

export const get = tool({
  description: "Get full detail of a project memory component by name, id, or path, including methods and relations.",
  args: {
    name: tool.schema.string().optional().describe("Simple class/interface name"),
    id: tool.schema.string().optional().describe("Component id (kind:fqn)"),
    path: tool.schema.string().optional().describe("Relative path fragment"),
    includeMethods: tool.schema.boolean().optional().describe("Include methods (default true)"),
    includeRelated: tool.schema.boolean().optional().describe("Include relations (default true)"),
  },
  async execute(args, context) {
    const root = resolveRoot(context)
    const catalog = loadCatalog(root)
    if (catalog.error) return JSON.stringify(catalog, null, 2)

    let match = null
    if (args.id) match = catalog.components.find((c) => c.id === args.id)
    if (!match && args.name) {
      const hits = catalog.components.filter((c) => c.name === args.name)
      match = hits[0] || null
      if (!match) {
        const fuzzy = catalog.components.filter((c) =>
          c.name.toLowerCase().includes(args.name.toLowerCase())
        )
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
    const out = {
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
    }
    return JSON.stringify(out, null, 2)
  },
})

export const exists = tool({
  description:
    "MUST call before creating any *Data, I* port, *UC, entity, or mapper. Checks project memory for an existing component and returns REUSE_EXISTING or CREATE_NEW with impact checklist.",
  args: {
    name: tool.schema.string().describe("Candidate name e.g. DocEquivalentePosData or IDocEquivalentePosData"),
    kind: tool.schema.string().optional().describe("Optional kind filter"),
    fuzzy: tool.schema.boolean().optional().describe("Allow near matches in nearMisses (default true)"),
  },
  async execute(args, context) {
    const root = resolveRoot(context)
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
      for (const r of ranked) {
        nearMisses.push({ score: r.score, ...summarize(r.c) })
      }
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
          match: {
            ...summarize(match),
            methods: (match.methods || []).map((m) => m.name),
          },
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
      (args.name.startsWith("I")
        ? "port"
        : args.name.endsWith("UC")
          ? "usecase"
          : args.name.endsWith("Data")
            ? "data"
            : args.name.endsWith("RS")
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
  },
})

export const related = tool({
  description: "Return relation graph neighbors for a component (implements, uses, produces, extends).",
  args: {
    name: tool.schema.string().describe("Component simple name"),
    depth: tool.schema.number().optional().describe("Depth 1-2 (default 1)"),
  },
  async execute(args, context) {
    const root = resolveRoot(context)
    const catalog = loadCatalog(root)
    if (catalog.error) return JSON.stringify(catalog, null, 2)

    const match = catalog.components.find((c) => c.name === args.name)
    if (!match) {
      return JSON.stringify({ found: false, name: args.name, ...staleFields(catalog) }, null, 2)
    }
    const depth = Math.min(Math.max(args.depth || 1, 1), 2)
    return JSON.stringify(
      {
        found: true,
        ...staleFields(catalog),
        component: summarize(match),
        related: relatedOf(catalog, match, depth),
      },
      null,
      2
    )
  },
})

export const reindex = tool({
  description: "Regenerate project memory catalog.json from current Java sources (run after adding/removing components).",
  args: {
    force: tool.schema.boolean().optional().describe("Force reindex (default true)"),
  },
  async execute(_args, context) {
    const root = resolveRoot(context)
    const { indexer, catalog, meta } = memoryPaths(root)
    if (!fs.existsSync(indexer)) {
      return JSON.stringify({ ok: false, error: `Indexer not found: ${indexer}` }, null, 2)
    }
    const result = spawnSync(process.execPath, [indexer, "--root", root], {
      cwd: root,
      encoding: "utf8",
      timeout: 120000,
    })
    invalidateCatalogCache()
    if (result.status !== 0) {
      return JSON.stringify(
        {
          ok: false,
          status: result.status,
          stdout: result.stdout,
          stderr: result.stderr,
        },
        null,
        2
      )
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
      {
        ok: true,
        artifactCount,
        generatedAt,
        catalogPath: catalog,
        log: (result.stdout || "").trim(),
      },
      null,
      2
    )
  },
})

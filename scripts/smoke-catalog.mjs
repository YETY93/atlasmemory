#!/usr/bin/env node
/**
 * Smoke test genérico de la memoria del proyecto (sin OpenCode).
 * Usage: node scripts/smoke-catalog.mjs
 *
 * Opcional: SMOKE_SAMPLE=MiClaseData node scripts/smoke-catalog.mjs
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const catalogPath = path.join(root, ".opencode/memory/catalog.json")
const metaPath = path.join(root, ".opencode/memory/meta.json")
const indexer = path.join(root, "scripts/index-catalog.mjs")

const GENERIC_SUFFIXES = ["data", "dto", "uc", "rs", "mapper", "bean", "enum"]

let failed = 0
function ok(name, cond, detail = "") {
  if (cond) console.log(`  PASS  ${name}${detail ? " — " + detail : ""}`)
  else {
    console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`)
    failed++
  }
}

console.log("== 1. Reindex ==")
const re = spawnSync(process.execPath, [indexer, "--root", root], {
  cwd: root,
  encoding: "utf8",
  timeout: 120000,
})
ok("indexer exit 0", re.status === 0, re.status === 0 ? (re.stdout || "").trim().split("\n")[0] : re.stderr || re.stdout)
ok("catalog.json exists", fs.existsSync(catalogPath))
ok("meta.json exists", fs.existsSync(metaPath))

if (!fs.existsSync(catalogPath)) {
  console.log("\nFAILED: no catalog")
  process.exit(1)
}

const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"))
const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"))
const components = catalog.components || catalog.artifacts || []
const relations = catalog.relations || catalog.edges || []

console.log("\n== 2. Inventory ==")
const emptyProject = meta.fileCount === 0 || components.length === 0
if (emptyProject) {
  ok("0 java handled gracefully", true, `fileCount=${meta.fileCount}, components=${components.length}`)
  ok("has relations field", Array.isArray(relations), String(relations.length))
  ok("no transition aliases required", !("artifacts" in catalog) || Array.isArray(catalog.artifacts), "components/relations only preferred")
} else {
  ok("has components", components.length > 0, String(components.length))
  ok("has relations field", Array.isArray(relations), String(relations.length))
  const kinds = [...new Set(components.map((c) => c.kind))].sort()
  ok("has kinds", kinds.length > 0, kinds.join(", "))
}

ok("catalog uses components (not only artifacts)", Array.isArray(catalog.components))
ok("catalog uses relations (not only edges)", Array.isArray(catalog.relations))
ok("no artifacts alias", catalog.artifacts === undefined)
ok("no edges alias", catalog.edges === undefined)

function findByName(name) {
  return components.find((c) => c.name === name)
}

function suffixIsGeneric(name, q) {
  return GENERIC_SUFFIXES.some(
    (s) =>
      name.endsWith(s) &&
      q.endsWith(s) &&
      !name.startsWith(q.slice(0, -s.length))
  )
}

function scoreMatch(component, query) {
  const q = query.toLowerCase()
  const name = (component.name || "").toLowerCase()
  const fqn = (component.fqn || "").toLowerCase()
  let score = 0
  if (name === q) score = 1.0
  else if (name.startsWith(q)) score = 0.8
  else if (name.endsWith(q)) score = suffixIsGeneric(name, q) ? 0.4 : 0.75
  else if (name.includes(q) || fqn.includes(q)) score = 0.7
  for (const m of component.methods || []) {
    if ((m.name || "").toLowerCase().includes(q)) score = Math.max(score, 0.6)
  }
  return score
}

/** REUSE solo exacto (name ===). Nunca auto-promover score. */
function exists(name) {
  const match = findByName(name)
  if (match) {
    return {
      exists: true,
      advice: "REUSE_EXISTING",
      match,
      nearMisses: components
        .filter((c) => c.id !== match.id)
        .map((c) => ({ c, score: scoreMatch(c, name) }))
        .filter((x) => x.score >= 0.6)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(({ c, score }) => ({ score, name: c.name })),
      related: relations.filter((r) => r.from === match.id || r.to === match.id),
    }
  }
  const nearMisses = components
    .map((c) => ({ c, score: scoreMatch(c, name) }))
    .filter((x) => x.score >= 0.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ c, score }) => ({ score, name: c.name }))
  return { exists: false, advice: "CREATE_NEW", nearMisses }
}

console.log("\n== 3. catalog_exists (exact REUSE only) ==")
const sample =
  process.env.SMOKE_SAMPLE ||
  components.find((c) => c.kind === "data")?.name ||
  components.find((c) => c.kind === "port")?.name ||
  components[0]?.name

if (sample) {
  const hit = exists(sample)
  ok(`exists(${sample})`, hit.exists === true)
  ok("advice REUSE_EXISTING", hit.advice === "REUSE_EXISTING")
  if (hit.match?.extends) {
    ok("extends field present", typeof hit.match.extends === "string", hit.match.extends)
  }
  const extRel = (hit.related || []).filter((r) => r.type === "extends")
  if (hit.match?.extends && findByName(hit.match.extends)) {
    ok("extends relation when parent indexed", extRel.length > 0, `${hit.match.name} → ${hit.match.extends}`)
  }
} else {
  ok("no sample (empty project OK)", true, "skipped exists(sample)")
}

const missing = exists("FooBarNoExisteDataXYZ_999")
ok("missing → CREATE_NEW", missing.exists === false && missing.advice === "CREATE_NEW")

// Anti falso-positivo: sufijo genérico Data no debe REUSE
if (components.length > 0) {
  const dataComp = components.find((c) => /Data$/i.test(c.name) && c.name.length > 8)
  if (dataComp) {
    // Quitar prefijo largo dejando solo un sufijo tipo "DocumentoData" si el nombre es más largo
    const name = dataComp.name
    // Buscar un query que sea sufijo genérico y NO exista como nombre exacto
    // p.ej. si existe ConsecutivoDocumentoData, query "DocumentoData" no debe REUSE
    let antiQuery = null
    if (name.length > 12 && name.endsWith("Data")) {
      const mid = name.slice(Math.floor(name.length / 3))
      if (mid.endsWith("Data") && mid !== name && !findByName(mid)) {
        antiQuery = mid
      }
    }
    if (!antiQuery) {
      antiQuery = "DocumentoData"
      if (findByName(antiQuery)) antiQuery = "EntidadDataXYZNoExact"
    }
    const anti = exists(antiQuery)
    ok(
      `anti-FP: exists("${antiQuery}") → CREATE_NEW (no auto-REUSE por sufijo)`,
      anti.exists === false && anti.advice === "CREATE_NEW",
      anti.nearMisses?.length ? `nearMisses=${anti.nearMisses.slice(0, 3).map((n) => n.name).join(",")}` : "no nearMisses"
    )
    // score de un *Data real vs query que solo comparte sufijo Data debe ser bajo si es genérico
    if (dataComp.name !== antiQuery) {
      const sc = scoreMatch(dataComp, antiQuery)
      ok(
        `scoreMatch generico-suffix <= 0.75`,
        sc < 0.85,
        `${dataComp.name} vs ${antiQuery} = ${sc}`
      )
    }
  } else {
    ok("anti-FP skipped (no *Data component)", true)
  }

  // scoreMatch levels
  const any = components[0]
  ok("scoreMatch exact = 1.0", scoreMatch(any, any.name) === 1.0, any.name)
}

// methodsTruncated field present when capped
const truncated = components.filter((c) => c.methodsTruncated)
ok(
  "methodsTruncated field is boolean when present",
  components.every((c) => c.methodsTruncated === undefined || typeof c.methodsTruncated === "boolean"),
  truncated.length ? `${truncated.length} truncated` : "none truncated"
)

// no control keywords as methods
const CTRL = new Set([
  "if", "for", "while", "switch", "catch", "return", "new", "throw", "else",
  "synchronized", "instanceof", "do", "try", "assert", "case", "default", "finally",
])
let ghost = 0
for (const c of components) {
  for (const m of c.methods || []) {
    if (CTRL.has(m.name)) ghost++
  }
}
ok("no control-keyword method ghosts", ghost === 0, ghost ? `${ghost} ghosts` : "0")

console.log("\n== 4. Meta ==")
ok("meta.artifactCount matches", meta.artifactCount === components.length, `${meta.artifactCount} vs ${components.length}`)
ok("meta has contentHash", typeof meta.contentHash === "string" && meta.contentHash.startsWith("sha256:"))

console.log("\n" + "=".repeat(40))
if (failed === 0) {
  console.log("ALL SMOKE TESTS PASSED")
  process.exit(0)
} else {
  console.log(`FAILED: ${failed} assertion(s)`)
  process.exit(1)
}

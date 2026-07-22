#!/usr/bin/env node
/**
 * Smoke test del workspace cross-repo (nivel 2).
 *
 * Ejercita el servidor MCP de verdad, hablándole JSON-RPC por stdin/stdout igual
 * que Claude Code: si esto pasa, el transporte y las 4 tools funcionan.
 *
 * Usage:
 *   node scripts/smoke-workspace.mjs                 # desde el workspace
 *   node scripts/smoke-workspace.mjs --from <repo>   # simulando un repo hijo
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const server = path.join(workspace, "mcp/workspace-server.mjs")
const registryPath = path.join(workspace, "atlasmemory.workspace.json")

const fromArg = process.argv.indexOf("--from")
const cwd = fromArg > -1 && process.argv[fromArg + 1] ? path.resolve(process.argv[fromArg + 1]) : workspace

let failed = 0
function ok(name, cond, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`)
  if (!cond) failed++
}

/**
 * Lanza el servidor, le manda N llamadas y devuelve los payloads parseados.
 * Una sola invocación por tanda: el servidor es stateless entre mensajes.
 */
function call(requests) {
  const lines = requests.map((r, i) =>
    JSON.stringify({ jsonrpc: "2.0", id: i + 1, method: "tools/call", params: r })
  )
  const res = spawnSync(process.execPath, [server], {
    cwd,
    input: lines.join("\n") + "\n",
    encoding: "utf8",
    timeout: 120000,
    env: { ...process.env, ATLASMEMORY_WORKSPACE: "" },
  })
  if (res.status !== 0 && !res.stdout) throw new Error(res.stderr || "server no respondió")
  return res.stdout
    .trim()
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(JSON.parse(l).result.content[0].text))
}

console.log(`Workspace: ${workspace}`)
console.log(`Consultando desde: ${cwd}`)

console.log("\n== 1. Registry ==")
ok("atlasmemory.workspace.json existe", fs.existsSync(registryPath))
if (!fs.existsSync(registryPath)) {
  console.log("\nFAILED: sin registry — corré install-workspace.mjs")
  process.exit(1)
}
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"))
const enabled = (registry.projects || []).filter((p) => p.enabled !== false)
ok("tiene proyectos habilitados", enabled.length > 0, `${enabled.length} proyectos`)
for (const p of enabled) {
  const child = path.resolve(workspace, p.path)
  ok(`${p.id}: catálogo de nivel 1 presente`, fs.existsSync(path.join(child, ".opencode/memory/catalog.json")), p.path)
}

console.log("\n== 2. workspace_projects ==")
const [projects] = call([{ name: "workspace_projects", arguments: {} }])
ok("responde sin error", !projects.error && !projects.indexError, projects.error || projects.indexError || "")
if (projects.indexError) {
  console.log("\nFAILED: falta el índice — corré 'node scripts/index-workspace.mjs'")
  process.exit(1)
}
ok("lista todos los proyectos del registry", projects.projects.length === enabled.length, `${projects.projects.length}/${enabled.length}`)
ok("todos con catálogo", projects.projects.every((p) => p.hasCatalog))
const totalComponents = projects.projects.reduce((n, p) => n + (p.components || 0), 0)
ok("componentes indexados", totalComponents > 0, String(totalComponents))
ok(
  "frescura reportada",
  Array.isArray(projects.staleProjects),
  projects.staleProjects.length ? `stale: ${projects.staleProjects.join(",")} — reindexá` : "al día"
)

console.log("\n== 3. workspace_search ==")
// Se busca un componente real tomado del propio índice, así el test no depende
// de nombres de un proyecto concreto.
const sampleProject = projects.projects.find((p) => p.components > 0)
const sampleCatalog = JSON.parse(
  fs.readFileSync(path.join(path.resolve(workspace, sampleProject.path), ".opencode/memory/catalog.json"), "utf8")
)
const sample = (sampleCatalog.components || []).find((c) => ["data", "usecase", "port", "mapper"].includes(c.kind))
ok("hay un componente de muestra", Boolean(sample), sample ? `${sample.kind}:${sample.name}` : "ninguno")

const [hit, miss, filtered] = call([
  { name: "workspace_search", arguments: { query: sample.name } },
  { name: "workspace_search", arguments: { query: "ZzzNoExisteEnNingunRepo" } },
  { name: "workspace_search", arguments: { query: sample.name, project: sampleProject.id } },
])

ok("encuentra la muestra", hit.count > 0, `${hit.count} hits`)
ok("advice = PRECEDENT_FOUND", hit.advice === "PRECEDENT_FOUND", hit.advice)
// La garantía central del nivel 2: sin dependencia Maven, nada es importable.
ok("NUNCA aconseja REUSE_EXISTING", hit.advice !== "REUSE_EXISTING")
ok("cada hit trae su proyecto", hit.results.every((r) => r.project && r.path))
ok("score exacto = 1", hit.results.some((r) => r.name === sample.name && r.score === 1))
ok("sin match → NO_MATCH", miss.advice === "NO_MATCH" && miss.count === 0)
ok("filtro por project acota", filtered.results.every((r) => r.project === sampleProject.id), `${filtered.count} hits`)

const multi = hit.sameNameInSeveralProjects || []
ok(
  "agrupa homónimos cross-repo",
  Array.isArray(hit.results),
  multi.length ? `${sample.name}: ${multi[0].copies} copias en ${multi[0].projects.length} proyectos, métodos ${JSON.stringify(multi[0].methodCounts)}` : "sin homónimos"
)

console.log("\n== 4. workspace_get ==")
const [detail, badProject] = call([
  { name: "workspace_get", arguments: { name: sample.name, project: sampleProject.id } },
  { name: "workspace_get", arguments: { name: sample.name, project: "no-existe" } },
])
ok("encuentra el componente", detail.found === true)
ok("devuelve firmas de métodos", Array.isArray(detail.components?.[0]?.methods), `${detail.components?.[0]?.methods?.length ?? 0} métodos`)
ok("expone los homónimos internos", typeof detail.ambiguous === "boolean", detail.ambiguous ? "ambiguo" : "único")
ok("proyecto inexistente falla limpio", badProject.found === false && Boolean(badProject.error), badProject.error || "")

console.log("\n== 5. Aislamiento del nivel 1 ==")
// El workspace es de solo lectura sobre los catálogos hijos: no debe tocarlos.
const before = enabled.map((p) => fs.statSync(path.join(path.resolve(workspace, p.path), ".opencode/memory/catalog.json")).mtimeMs)
call([{ name: "workspace_search", arguments: { query: sample.name } }])
const after = enabled.map((p) => fs.statSync(path.join(path.resolve(workspace, p.path), ".opencode/memory/catalog.json")).mtimeMs)
ok("no modifica los catálogos de los repos", before.every((t, i) => t === after[i]))

console.log("\n" + "=".repeat(40))
if (failed) {
  console.log(`${failed} FALLARON`)
  process.exit(1)
}
console.log("ALL SMOKE TESTS PASSED")

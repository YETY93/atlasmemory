#!/usr/bin/env node
/**
 * Instalador del workspace de atlasmemory (nivel 2, cross-repo).
 *
 * Crea `<padre>/atlasmemory-workspace/` con el motor, el servidor MCP y un
 * registry de proyectos; registra el servidor en el `.mcp.json` del padre y —salvo
 * `--no-children`— también en el de cada repo hijo, para poder consultar el
 * workspace sin salir del proyecto en el que estás trabajando.
 *
 * Uso:
 *   node install-workspace.mjs /ruta/al/padre
 *   node install-workspace.mjs /ruta/al/padre --force
 *   node install-workspace.mjs /ruta/al/padre --no-children
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SRC = path.dirname(fileURLToPath(import.meta.url))
const WORKSPACE_DIRNAME = "atlasmemory-workspace"

const argv = process.argv.slice(2)
const force = argv.includes("--force")
const noChildren = argv.includes("--no-children")
const parentArg = argv.find((a) => !a.startsWith("--"))

if (!parentArg) {
  console.error("Uso: node install-workspace.mjs /ruta/al/padre [--force] [--no-children]")
  process.exit(1)
}
if (!fs.existsSync(parentArg) || !fs.statSync(parentArg).isDirectory()) {
  console.error(`El destino no existe o no es un directorio: ${parentArg}`)
  process.exit(1)
}

const PARENT = path.resolve(parentArg)
const WORKSPACE = path.join(PARENT, WORKSPACE_DIRNAME)

/** Motor cross-repo. Vive una sola vez, en el workspace. */
const FILES = [
  "lib/catalog-engine.mjs",
  "lib/workspace-engine.mjs",
  "mcp/workspace-server.mjs",
  "scripts/index-workspace.mjs",
]

/**
 * Archivos que se replican en cada sitio desde donde se consulta el workspace
 * (la carpeta padre y cada repo hijo). El plugin de OpenCode resuelve la ruta
 * del workspace en runtime, así que el mismo archivo sirve en ambos niveles.
 */
const PER_ROOT_FILES = [
  ".opencode/tools/workspace.ts",
  ".opencode/skills/precedent-first/SKILL.md",
  ".claude/skills/precedent-first/SKILL.md",
]

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return null
  }
}

/**
 * Añade/actualiza `mcpServers.atlasworkspace` conservando servidores ajenos
 * (incluido el `atlasmemory` local de cada repo).
 * @returns {"created"|"updated"|"unchanged"|"unreadable"}
 */
function registerServer(mcpFile, args) {
  const desired = { command: "node", args }
  const existing = readJsonSafe(mcpFile)

  if (existing === null && fs.existsSync(mcpFile)) return "unreadable"

  const base = existing || {}
  const servers = { ...(base.mcpServers || {}) }
  if (JSON.stringify(servers.atlasworkspace) === JSON.stringify(desired)) return "unchanged"

  const created = !existing
  servers.atlasworkspace = desired
  fs.mkdirSync(path.dirname(mcpFile), { recursive: true })
  fs.writeFileSync(mcpFile, JSON.stringify({ ...base, mcpServers: servers }, null, 2) + "\n")
  return created ? "created" : "updated"
}

/** Repos hermanos que ya tienen memoria de nivel 1 generada. */
function discoverProjects() {
  const found = []
  for (const entry of fs.readdirSync(PARENT, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === WORKSPACE_DIRNAME) continue
    const dir = path.join(PARENT, entry.name)
    if (!fs.existsSync(path.join(dir, ".opencode", "memory", "catalog.json"))) continue
    // La plantilla se auto-indexa al desarrollarla; no es un proyecto de negocio.
    if (fs.existsSync(path.join(dir, "install-workspace.mjs"))) continue
    found.push(entry.name)
  }
  return found
}

/** `clarisa-back-api-factura` → `factura`; conserva el nombre si no hay prefijo común. */
function shortId(name, all) {
  const parts = name.split("-")
  for (let i = parts.length - 1; i > 0; i--) {
    const candidate = parts.slice(i).join("-")
    if (all.filter((n) => n.endsWith(candidate)).length === 1) return candidate
  }
  return name
}

console.log(`Instalando atlasmemory workspace en: ${WORKSPACE}`)

for (const rel of FILES) {
  const to = path.join(WORKSPACE, rel)
  if (fs.existsSync(to) && !force) {
    console.log(`  skip (existe): ${rel}  (usa --force para sobrescribir)`)
    continue
  }
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(path.join(SRC, rel), to)
  console.log(`  ok: ${rel}`)
}

// --- Registry ---------------------------------------------------------------
const registryPath = path.join(WORKSPACE, "atlasmemory.workspace.json")
const discovered = discoverProjects()

if (fs.existsSync(registryPath) && !force) {
  const current = readJsonSafe(registryPath)
  const known = new Set((current?.projects || []).map((p) => p.path?.replace(/^\.\.\//, "")))
  const nuevos = discovered.filter((d) => !known.has(d))
  console.log(`  skip (existe): atlasmemory.workspace.json  (${current?.projects?.length ?? 0} proyectos)`)
  if (nuevos.length) {
    console.log(`    sin registrar: ${nuevos.join(", ")} — agregalos a mano o usa --force`)
  }
} else {
  const projects = discovered.map((name) => ({
    id: shortId(name, discovered),
    path: `../${name}`,
    enabled: true,
  }))
  fs.writeFileSync(
    registryPath,
    JSON.stringify({ version: 1, projects }, null, 2) + "\n"
  )
  console.log(`  ok: atlasmemory.workspace.json  (${projects.length} proyectos detectados)`)
  for (const p of projects) console.log(`       ${p.id.padEnd(14)} ${p.path}`)
}

// El índice se regenera; no se versiona.
const gitignore = path.join(WORKSPACE, "memory", ".gitignore")
if (!fs.existsSync(gitignore)) {
  fs.mkdirSync(path.dirname(gitignore), { recursive: true })
  fs.writeFileSync(gitignore, "# Generado por scripts/index-workspace.mjs — no editar a mano\n*\n!.gitignore\n")
  console.log(`  ok: memory/.gitignore`)
}

/** Copia tools + skills en un root de consulta. @returns {number} copiados */
function installPerRoot(rootDir) {
  let n = 0
  for (const rel of PER_ROOT_FILES) {
    const to = path.join(rootDir, rel)
    if (fs.existsSync(to) && !force) continue
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(path.join(SRC, rel), to)
    n++
  }
  return n
}

// --- Bindings de consulta ---------------------------------------------------
// El workspace se consulta desde el padre y desde cada repo hijo: cada uno
// necesita su propio registro MCP (Claude Code) y su plugin (OpenCode).
console.log("")
console.log("Bindings de consulta:")

const parentResult = registerServer(path.join(PARENT, ".mcp.json"), [
  `${WORKSPACE_DIRNAME}/mcp/workspace-server.mjs`,
])
const parentFiles = installPerRoot(PARENT)
console.log(`  ${"(padre)".padEnd(14)} mcp: ${parentResult.padEnd(10)} tools+skills: ${parentFiles}/${PER_ROOT_FILES.length}`)

if (!noChildren) {
  const registry = readJsonSafe(registryPath)
  for (const p of registry?.projects || []) {
    const childDir = path.resolve(WORKSPACE, p.path)
    const result = registerServer(path.join(childDir, ".mcp.json"), [
      `../${WORKSPACE_DIRNAME}/mcp/workspace-server.mjs`,
    ])
    const files = installPerRoot(childDir)
    console.log(`  ${p.id.padEnd(14)} mcp: ${result.padEnd(10)} tools+skills: ${files}/${PER_ROOT_FILES.length}`)
  }
}

console.log("")
console.log("Siguiente:")
console.log(`  1. cd "${WORKSPACE}" && node scripts/index-workspace.mjs`)
console.log("  2. Reinicia Claude Code y aprueba el servidor 'atlasworkspace'")
console.log("  3. Probá:  workspace_projects   /   workspace_search query=Ciudad")

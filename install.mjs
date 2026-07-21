#!/usr/bin/env node
/**
 * Instalador cross-platform de atlasmemory (Windows / Linux / macOS).
 * Requiere solo Node 18+ (el mismo runtime que el indexer y el servidor MCP).
 *
 * Uso:
 *   node install.mjs /ruta/al/proyecto
 *   node install.mjs /ruta/al/proyecto --force
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SRC = path.dirname(fileURLToPath(import.meta.url))

const argv = process.argv.slice(2)
const force = argv.includes("--force")
const destArg = argv.find((a) => a !== "--force")

if (!destArg) {
  console.error("Uso: node install.mjs /ruta/al/proyecto [--force]")
  process.exit(1)
}
if (!fs.existsSync(destArg) || !fs.statSync(destArg).isDirectory()) {
  console.error(`El destino no existe o no es un directorio: ${destArg}`)
  process.exit(1)
}
const DEST = path.resolve(destArg)

console.log(`Instalando atlasmemory en: ${DEST}`)
console.log(`Desde plantilla: ${SRC}`)

/** ¿El archivo de reglas ya menciona la memoria? Evita avisos en falso. */
function mentionsMemory(file) {
  try {
    const txt = fs.readFileSync(file, "utf8")
    return /catalog_exists|atlasmemory/i.test(txt)
  } catch {
    return false
  }
}

/** Lee un JSON existente; null si no existe o es ilegible. */
function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return null
  }
}

/**
 * Fusiona `.mcp.json`: conserva los servidores del proyecto y añade/actualiza
 * solo `mcpServers.atlasmemory`. Nunca elimina servidores ajenos.
 * @returns {{content: string, note: string}|null} null = sin cambios necesarios
 */
function mergeMcpJson(destFile, srcFile) {
  const src = readJsonSafe(srcFile) || {}
  const existing = readJsonSafe(destFile)
  if (!existing) return null // ilegible o inexistente → copia normal

  const ours = src.mcpServers?.atlasmemory
  const servers = { ...(existing.mcpServers || {}) }
  const before = JSON.stringify(servers.atlasmemory || null)
  servers.atlasmemory = ours
  if (JSON.stringify(servers.atlasmemory) === before) {
    return { content: null, note: "ya estaba registrado, sin cambios" }
  }
  const merged = { ...existing, mcpServers: servers }
  const others = Object.keys(servers).filter((k) => k !== "atlasmemory")
  return {
    content: JSON.stringify(merged, null, 2) + "\n",
    note: others.length
      ? `fusionado (conserva: ${others.join(", ")})`
      : "fusionado",
  }
}

/**
 * Fusiona `opencode.json`: conserva la config del proyecto y asegura que
 * `instructions` incluya AGENTS.md y CLAUDE.md, sin duplicar ni reordenar.
 */
function mergeOpencodeJson(destFile, srcFile) {
  const src = readJsonSafe(srcFile) || {}
  const existing = readJsonSafe(destFile)
  if (!existing) return null

  const wanted = Array.isArray(src.instructions) ? src.instructions : []
  const current = Array.isArray(existing.instructions) ? existing.instructions : []
  const missing = wanted.filter((i) => !current.includes(i))
  if (missing.length === 0) {
    return { content: null, note: "instructions ya cubiertas, sin cambios" }
  }
  const merged = { ...existing, instructions: [...current, ...missing] }
  return {
    content: JSON.stringify(merged, null, 2) + "\n",
    note: `fusionado (+ instructions: ${missing.join(", ")})`,
  }
}

/**
 * Archivos a copiar. `keep:true` = no sobrescribir si ya existe (salvo --force),
 * porque es contenido que el proyecto destino personaliza.
 * `merge` = si ya existe, fusionar en vez de copiar/omitir (config acumulativa).
 */
const FILES = [
  // Núcleo compartido
  { rel: "scripts/index-catalog.mjs" },
  { rel: "scripts/smoke-catalog.mjs" },
  { rel: "atlasmemory.config.example.json" },
  // Binding OpenCode
  { rel: ".opencode/tools/catalog.ts" },
  { rel: ".opencode/skills/reuse-first/SKILL.md" },
  { rel: ".opencode/opencode.json", merge: mergeOpencodeJson },
  { rel: ".opencode/memory/.gitignore" },
  // Binding Claude Code (MCP)
  { rel: "mcp/server.mjs" },
  { rel: ".mcp.json", merge: mergeMcpJson },
  { rel: ".claude/skills/reuse-first/SKILL.md" },
  // Reglas por cliente — personalizables: no pisar si existen
  { rel: "AGENTS.md", keep: true, placeholders: true, needsSnippet: "OpenCode" },
  { rel: "CLAUDE.md", keep: true, placeholders: true, needsSnippet: "Claude Code" },
  // Documentación (opcional)
  { rel: "docs/arquetipo-catalogo-agente.md", optional: true },
  { rel: "docs/snippet-memoria.md", optional: true },
]

let copied = 0
let skipped = 0
let merged = 0
/** Archivos de reglas preservados: requieren pegar el snippet a mano. */
const needsSnippet = []

for (const f of FILES) {
  const from = path.join(SRC, f.rel)
  const to = path.join(DEST, f.rel)

  if (f.optional && !fs.existsSync(from)) continue

  // Config acumulativa: fusionar en vez de copiar/omitir. Nunca pierde config ajena.
  if (f.merge && fs.existsSync(to)) {
    const result = f.merge(to, from)
    if (result) {
      if (result.content) {
        fs.writeFileSync(to, result.content)
        console.log(`  merge: ${f.rel}  (${result.note})`)
        merged++
      } else {
        console.log(`  ok (sin cambios): ${f.rel}  (${result.note})`)
        skipped++
      }
      continue
    }
    // JSON ilegible → no lo tocamos sin permiso explícito
    if (!force) {
      console.log(`  skip (ilegible): ${f.rel}  (usa --force para reemplazar)`)
      skipped++
      continue
    }
  }

  if (fs.existsSync(to) && f.keep && !force) {
    // Solo avisar si el archivo preservado NO menciona ya la memoria.
    const missingRule = f.needsSnippet && !mentionsMemory(to)
    console.log(
      `  skip (existe): ${f.rel}  (${missingRule ? "SIN regla de memoria — ver aviso abajo" : "se preserva tu documentación"})`
    )
    skipped++
    if (missingRule) needsSnippet.push(f)
    continue
  }
  if (fs.existsSync(to) && !force && !f.keep) {
    console.log(`  skip (existe): ${f.rel}  (usa --force para sobrescribir)`)
    skipped++
    continue
  }

  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
  const note = f.placeholders ? "  (edita placeholders {{PROJECT_*}})" : ""
  console.log(`  ok: ${f.rel}${note}`)
  copied++
}

console.log("")
console.log(`Resumen: ${copied} copiados, ${merged} fusionados, ${skipped} omitidos.`)

if (needsSnippet.length) {
  const snippet = path.join(DEST, "docs", "snippet-memoria.md")
  const hasSnippet = fs.existsSync(snippet)
  console.log("")
  console.log("=".repeat(72))
  console.log("!!  ACCION REQUERIDA — la memoria quedo instalada pero NO anunciada")
  console.log("=".repeat(72))
  for (const f of needsSnippet) {
    console.log(`    ${f.rel} ya existia y no se modifico (${f.needsSnippet}).`)
  }
  console.log("")
  console.log("    Tu agente tiene las tools, pero le falta la regla permanente que")
  console.log("    le dice que consulte la memoria antes de crear componentes.")
  console.log("")
  console.log("    Copia el bloque de:")
  console.log(`      ${hasSnippet ? snippet : path.join(SRC, "docs", "snippet-memoria.md")}`)
  console.log(`    y pegalo al final de: ${needsSnippet.map((f) => f.rel).join(" y ")}`)
  console.log("=".repeat(72))
}

console.log("")
console.log("Siguiente:")
console.log("  1. Edita AGENTS.md y CLAUDE.md (descripción, build, invariantes)")
console.log(`  2. cd "${DEST}" && node scripts/index-catalog.mjs`)
console.log("  3. node scripts/smoke-catalog.mjs")
console.log("  4a. OpenCode:     abre opencode en la raíz y prueba catalog_exists")
console.log("  4b. Claude Code:  reinicia claude (carga .mcp.json) y prueba mcp__atlasmemory__catalog_exists")

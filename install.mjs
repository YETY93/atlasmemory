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

/**
 * Archivos a copiar. `keep:true` = no sobrescribir si ya existe (salvo --force),
 * porque es contenido que el proyecto destino personaliza.
 */
const FILES = [
  // Núcleo compartido
  { rel: "scripts/index-catalog.mjs" },
  { rel: "scripts/smoke-catalog.mjs" },
  { rel: "atlasmemory.config.example.json" },
  // Binding OpenCode
  { rel: ".opencode/tools/catalog.ts" },
  { rel: ".opencode/skills/reuse-first/SKILL.md" },
  { rel: ".opencode/opencode.json" },
  { rel: ".opencode/memory/.gitignore" },
  // Binding Claude Code (MCP)
  { rel: "mcp/server.mjs" },
  { rel: ".mcp.json" },
  { rel: ".claude/skills/reuse-first/SKILL.md" },
  // Reglas por cliente — personalizables: no pisar si existen
  { rel: "AGENTS.md", keep: true, placeholders: true },
  { rel: "CLAUDE.md", keep: true, placeholders: true },
  // Documentación (opcional)
  { rel: "docs/arquetipo-catalogo-agente.md", optional: true },
]

let copied = 0
let skipped = 0

for (const f of FILES) {
  const from = path.join(SRC, f.rel)
  const to = path.join(DEST, f.rel)

  if (f.optional && !fs.existsSync(from)) continue

  if (fs.existsSync(to) && f.keep && !force) {
    console.log(`  skip (existe): ${f.rel}`)
    skipped++
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
console.log(`Resumen: ${copied} copiados, ${skipped} omitidos.`)
console.log("")
console.log("Siguiente:")
console.log("  1. Edita AGENTS.md y CLAUDE.md (descripción, build, invariantes)")
console.log(`  2. cd "${DEST}" && node scripts/index-catalog.mjs`)
console.log("  3. node scripts/smoke-catalog.mjs")
console.log("  4a. OpenCode:     abre opencode en la raíz y prueba catalog_exists")
console.log("  4b. Claude Code:  reinicia claude (carga .mcp.json) y prueba mcp__atlasmemory__catalog_exists")

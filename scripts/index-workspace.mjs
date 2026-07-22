#!/usr/bin/env node
/**
 * Construye el índice del workspace agregando los `catalog.json` de cada proyecto
 * registrado en `atlasmemory.workspace.json`.
 *
 * No parsea Java: cada repo indexa lo suyo con `scripts/index-catalog.mjs`.
 *
 * Uso:
 *   node scripts/index-workspace.mjs
 *   node scripts/index-workspace.mjs --workspace /ruta/al/workspace
 */

import path from "node:path"
import { fileURLToPath } from "node:url"

import { buildWorkspaceIndex, resolveWorkspaceDir, writeWorkspaceIndex } from "../lib/workspace-engine.mjs"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--workspace" && argv[i + 1]) return argv[i + 1]
  }
  return null
}

const workspaceDir = resolveWorkspaceDir(parseArgs(process.argv) || path.join(scriptDir, ".."))

const { index, warnings } = buildWorkspaceIndex(workspaceDir)
const written = writeWorkspaceIndex(workspaceDir, index)

for (const w of warnings) console.warn(`  aviso: ${w}`)

console.log(`Workspace: ${workspaceDir}`)
for (const p of index.projects) {
  console.log(`  ${p.id.padEnd(16)} ${String(p.components).padStart(5)} componentes  ${p.path}`)
}
console.log(`Indexados ${index.entries.length} componentes de ${index.projects.length} proyectos`)
console.log(`Escrito ${written}`)

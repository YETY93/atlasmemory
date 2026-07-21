#!/usr/bin/env node
/**
 * Project memory indexer (MVP levels 1–3).
 * Discovers Java sources, extracts components + relations, writes catalog.json.
 *
 * Usage:
 *   node scripts/index-catalog.mjs
 *   node scripts/index-catalog.mjs --out .opencode/memory
 *   node scripts/index-catalog.mjs --root /path/to/project
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { root: null, out: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--root" && argv[i + 1]) args.root = argv[++i];
    else if (argv[i] === "--out" && argv[i + 1]) args.out = argv[++i];
  }
  return args;
}

function walkJavaFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "target" || entry.name === "node_modules" || entry.name === ".git") continue;
      walkJavaFiles(full, acc);
    } else if (entry.isFile() && entry.name.endsWith(".java")) {
      acc.push(full);
    }
  }
  return acc;
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, "");
}

function detectModule(relPath) {
  const parts = relPath.split(path.sep);
  // Maven multi-module: first directory that looks like a module root
  const idx = parts.findIndex(
    (p) =>
      p.endsWith("-domain") ||
      p.endsWith("-usecase") ||
      p.endsWith("-ejb") ||
      p.endsWith("-web") ||
      p.endsWith("-ear") ||
      p.endsWith("-api") ||
      p.endsWith("-service") ||
      p.endsWith("-core") ||
      p.endsWith("-application") ||
      p.endsWith("-infrastructure") ||
      p.endsWith("-adapter") ||
      /^[a-z0-9]+(-[a-z0-9]+)+$/i.test(p)
  );
  // Prefer path segment that contains src/main/java parent module
  const srcIdx = parts.indexOf("src");
  if (srcIdx > 0) return parts[srcIdx - 1];
  if (idx >= 0) return parts[idx];
  return parts[0] || "unknown";
}

function detectLayer(moduleName, relPath) {
  if (moduleName.includes("-domain")) return "domain";
  if (moduleName.includes("-usecase")) return "usecase";
  if (moduleName.includes("-ejb")) return "ejb";
  if (moduleName.includes("-web")) return "web";
  if (relPath.includes(`${path.sep}domain${path.sep}`)) return "domain";
  if (relPath.includes(`${path.sep}usecase${path.sep}`)) return "usecase";
  if (relPath.includes(`${path.sep}ejb${path.sep}`)) return "ejb";
  if (relPath.includes(`${path.sep}web${path.sep}`)) return "web";
  return "other";
}

function detectKind({ name, typeKeyword, relPath, annotations, pkg }) {
  const n = relPath.replace(/\\/g, "/");
  if (name === "UseCaseConfig" || (annotations.includes("Produces") && name.endsWith("Config"))) return "config";
  if (n.includes("/port/") && (typeKeyword === "interface" || name.startsWith("I"))) return "port";
  if (n.includes("/data/") && name.endsWith("Data")) return "data";
  if (name.endsWith("UC") && (n.includes("/usecase/") || n.includes("-usecase/"))) return "usecase";
  if (name.endsWith("Bean") && annotations.includes("Stateless")) return "bean";
  if (annotations.includes("Entity") || n.includes("/entidades/")) return "entity";
  if (name.endsWith("Mapper") || annotations.includes("Mapper")) return "mapper";
  if (name.endsWith("RS") && (n.includes("/rest/") || n.includes("-web/"))) return "rest";
  if (name.endsWith("Dto") || name.endsWith("DTO")) return "dto";
  if (typeKeyword === "enum" || name.endsWith("Enum")) return "enum";
  if (name.endsWith("Exception")) return "exception";
  if (n.includes("/util/") || n.includes("/utils/")) return "util";
  if (typeKeyword === "interface" && name.startsWith("I")) return "port";
  if (pkg && pkg.includes(".port")) return "port";
  return "other";
}

function extractTags(name, relPath) {
  const tags = new Set();
  const lower = `${name} ${relPath}`.toLowerCase();
  const map = [
    [/pagin/, "paginacion"],
    [/cache/, "cache"],
    [/correo|email/, "correo"],
    [/pdf/, "pdf"],
    [/xml/, "xml"],
    [/json/, "json"],
    [/auth|segur/, "seguridad"],
    [/tenant/, "tenant"],
    [/report/, "reporte"],
    [/factura/, "factura"],
    [/cliente/, "cliente"],
    [/proveedor/, "proveedor"],
    [/dian/, "dian"],
    [/\bpos\b|_pos|pos_/, "pos"],
    [/\bspd\b|_spd|spd_/, "spd"],
    [/\bnac\b|credito/, "nac"],
    [/\bnad\b|debito/, "nad"],
  ];
  for (const [re, tag] of map) {
    if (re.test(lower)) tags.add(tag);
  }
  return [...tags];
}

function extractAnnotationsNear(src, index) {
  const before = src.slice(Math.max(0, index - 800), index);
  const lines = before.split("\n").reverse();
  const anns = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("@")) {
      const m = t.match(/^@([A-Za-z_][A-Za-z0-9_]*)/);
      if (m) anns.push(m[1]);
      continue;
    }
    if (/^(public|protected|private|abstract|final|sealed|non-sealed|static|\s)/.test(t)) continue;
    break;
  }
  return anns;
}

function parseTypeParams(paramsRaw) {
  if (!paramsRaw || !paramsRaw.trim()) return [];
  const params = [];
  let depth = 0;
  let current = "";
  for (const ch of paramsRaw) {
    if (ch === "<") depth++;
    if (ch === ">") depth--;
    if (ch === "," && depth === 0) {
      params.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) params.push(current.trim());

  return params
    .map((p) => {
      const cleaned = p.replace(/@(?:\w+)(?:\([^)]*\))?\s*/g, "").trim();
      const parts = cleaned.split(/\s+/).filter(Boolean);
      if (parts.length === 0) return null;
      const name = parts[parts.length - 1];
      const type = parts.slice(0, -1).join(" ").replace(/\s+/g, " ");
      if (!name || !type) return null;
      return { name, type };
    })
    .filter(Boolean);
}

const CTRL = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "new",
  "throw",
  "else",
  "synchronized",
  "instanceof",
  "do",
  "try",
  "assert",
  "case",
  "default",
  "finally",
]);

/** @returns {{ methods: object[], truncated: boolean }} */
function extractMethods(body, typeKeyword) {
  if (typeKeyword === "enum") return { methods: [], truncated: false };
  const methods = [];
  const seen = new Set();
  let truncated = false;

  // interface / abstract method style
  const re =
    /(?:(?:public|protected|private)\s+)?(?:static\s+)?(?:default\s+)?(?:final\s+)?(?:synchronized\s+)?(?:native\s+)?(?:abstract\s+)?([\w.<>,\[\]\s?]+?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^;{]*)\)\s*(?:throws\s+[^{;]+)?\s*[{;]/g;

  let m;
  while ((m = re.exec(body)) !== null) {
    const returnType = m[1].replace(/\s+/g, " ").trim();
    const name = m[2];
    if (!name || name === typeKeyword) continue;
    if (CTRL.has(returnType)) continue;
    if (returnType.includes(" class") || returnType.includes(" interface") || returnType.includes(" enum")) continue;
    if (CTRL.has(name)) continue;
    // skip constructors roughly: return type equals class name handled elsewhere
    const key = `${name}(${m[3]})`;
    if (seen.has(key)) continue;
    seen.add(key);
    const params = parseTypeParams(m[3]);
    methods.push({
      name,
      returnType,
      params,
      annotations: [],
    });
    if (methods.length >= 80) {
      truncated = true;
      break;
    }
  }
  return { methods, truncated };
}

function extractFirstJavadocSummary(src) {
  const m = src.match(/\/\*\*([\s\S]*?)\*\//);
  if (!m) return "";
  const lines = m[1]
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, "").trim())
    .filter((l) => l && !l.startsWith("@"));
  return (lines[0] || "").replace(/<[^>]+>/g, "").slice(0, 200);
}

function parseJavaFile(absPath, root) {
  const relPath = path.relative(root, absPath);
  let src;
  try {
    src = fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }

  const clean = stripComments(src);
  const pkgMatch = clean.match(/\bpackage\s+([\w.]+)\s*;/);
  const pkg = pkgMatch ? pkgMatch[1] : "";

  const typeRe =
    /\b(?:public\s+|protected\s+|private\s+)?(?:abstract\s+|final\s+|sealed\s+|non-sealed\s+)?(class|interface|enum|record)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*<[^>{]*>)?(?:\s+extends\s+([^{]+?))?(?:\s+implements\s+([^{]+?))?\s*\{/g;

  const components = [];
  let match;
  while ((match = typeRe.exec(clean)) !== null) {
    const typeKeyword = match[1];
    const name = match[2];
    const extendsRaw = (match[3] || "").trim();
    const implementsRaw = (match[4] || "").trim();
    const lineStart = clean.slice(0, match.index).split("\n").length;
    const annotations = extractAnnotationsNear(clean, match.index);
    const module = detectModule(relPath);
    const layer = detectLayer(module, relPath);
    const kind = detectKind({ name, typeKeyword, relPath, annotations, pkg });
    const fqn = pkg ? `${pkg}.${name}` : name;

    const simpleTypeName = (raw) => {
      if (!raw) return null;
      // strip generics even if nested braces are unbalanced in regex capture
      let s = raw.split(",")[0].trim();
      const lt = s.indexOf("<");
      if (lt >= 0) s = s.slice(0, lt);
      s = s.replace(/<.*/g, "").trim();
      return s.split(/\s+/).pop() || null;
    };

    const extendsName = simpleTypeName(extendsRaw);

    const implementsList = implementsRaw
      ? implementsRaw
          .split(",")
          .map((s) => simpleTypeName(s))
          .filter(Boolean)
      : [];

    // body slice (best-effort brace matching from type start)
    const bodyStart = match.index + match[0].length - 1;
    let depth = 0;
    let bodyEnd = clean.length;
    for (let i = bodyStart; i < clean.length; i++) {
      const ch = clean[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          bodyEnd = i;
          break;
        }
      }
    }
    const body = clean.slice(bodyStart, bodyEnd);
    const extracted = extractMethods(body, typeKeyword);
    const methods = extracted.methods.filter((meth) => meth.name !== name);

    // UseCaseConfig produces
    const produces = [];
    if (name === "UseCaseConfig" || kind === "config") {
      const prodRe = /@Produces[\s\S]{0,120}?public\s+(\w+)\s+\w+\s*\(/g;
      let pm;
      while ((pm = prodRe.exec(body)) !== null) {
        produces.push(pm[1]);
      }
    }

    // UC constructor port deps: new FooUC(...) not available; scan fields/ctor params named like ports
    const uses = [];
    if (kind === "usecase") {
      const ctorRe = new RegExp(
        `(?:public\\s+)?${name}\\s*\\(([^)]*)\\)`,
        "m"
      );
      const ctor = body.match(ctorRe);
      if (ctor) {
        for (const p of parseTypeParams(ctor[1])) {
          if (p.type.startsWith("I") || p.type.endsWith("UC") || p.type.endsWith("Data") || p.type.endsWith("Mapper") || p.type.endsWith("Factory")) {
            uses.push(p.type.replace(/<.*>/, ""));
          }
        }
      }
    }

    components.push({
      id: `${kind}:${fqn}`,
      kind,
      name,
      fqn,
      qualifiedName: fqn,
      path: relPath.replace(/\\/g, "/"),
      module,
      layer,
      package: pkg,
      typeKeyword,
      modifiers: [],
      annotations: [...new Set(annotations)],
      extends: extendsName,
      implements: implementsList,
      methods,
      methodsTruncated: extracted.truncated,
      produces: [...new Set(produces)],
      uses: [...new Set(uses)],
      summary: extractFirstJavadocSummary(src),
      tags: extractTags(name, relPath),
      state: "implemented",
      lineStart,
    });
  }
  return components;
}

function buildRelations(components) {
  const byName = new Map();
  for (const c of components) {
    if (!byName.has(c.name)) byName.set(c.name, []);
    byName.get(c.name).push(c);
  }

  const relations = [];
  const add = (from, to, type) => {
    if (!from || !to) return;
    relations.push({ from, to, type });
  };

  for (const c of components) {
    for (const iface of c.implements || []) {
      const targets = byName.get(iface) || [];
      for (const t of targets) add(c.id, t.id, "implements");
      if (targets.length === 0) {
        add(c.id, `unresolved:${iface}`, "implements");
      }
    }
    if (c.extends) {
      const targets = byName.get(c.extends) || [];
      if (targets.length) {
        for (const t of targets) add(c.id, t.id, "extends");
      } else {
        add(c.id, `unresolved:${c.extends}`, "extends");
      }
    }
    for (const p of c.produces || []) {
      const targets = byName.get(p) || [];
      if (targets.length) {
        for (const t of targets) add(c.id, t.id, "produces");
      } else {
        add(c.id, `unresolved:${p}`, "produces");
      }
    }
    for (const u of c.uses || []) {
      const targets = byName.get(u) || [];
      if (targets.length) {
        for (const t of targets) add(c.id, t.id, "uses");
      } else {
        add(c.id, `unresolved:${u}`, "uses");
      }
    }
  }

  // dedupe
  const seen = new Set();
  return relations.filter((r) => {
    const k = `${r.from}|${r.type}|${r.to}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function buildIndexes(components) {
  const byName = {};
  const byKind = {};
  const byModule = {};
  for (const c of components) {
    (byName[c.name] ||= []).push(c.id);
    (byKind[c.kind] ||= []).push(c.id);
    (byModule[c.module] ||= []).push(c.id);
  }
  return { byName, byKind, byModule };
}

function contentHash(files, root) {
  const h = crypto.createHash("sha256");
  const sorted = [...files].sort();
  for (const f of sorted) {
    h.update(path.relative(root, f));
    h.update("\0");
    h.update(fs.readFileSync(f));
    h.update("\0");
  }
  return `sha256:${h.digest("hex")}`;
}

function main() {
  const args = parseArgs(process.argv);
  const root = path.resolve(args.root || path.join(__dirname, ".."));
  const outDir = path.resolve(root, args.out || path.join(".opencode", "memory"));

  const project = path.basename(root);
  const javaFiles = walkJavaFiles(root).filter((f) => f.includes(`${path.sep}src${path.sep}main${path.sep}java${path.sep}`));

  const components = [];
  for (const f of javaFiles) {
    const parsed = parseJavaFile(f, root);
    if (parsed) components.push(...parsed);
  }

  // stable sort
  components.sort((a, b) => a.fqn.localeCompare(b.fqn));

  const relations = buildRelations(components);
  const indexes = buildIndexes(components);
  const generatedAt = new Date().toISOString();
  const hash = contentHash(javaFiles, root);

  // compact methods for size: keep name/return/params only
  const slimComponents = components.map((c) => ({
    id: c.id,
    kind: c.kind,
    name: c.name,
    fqn: c.fqn,
    qualifiedName: c.qualifiedName,
    path: c.path,
    module: c.module,
    layer: c.layer,
    package: c.package,
    typeKeyword: c.typeKeyword,
    annotations: c.annotations,
    extends: c.extends,
    implements: c.implements,
    methods: c.methods.map((m) => ({
      name: m.name,
      returnType: m.returnType,
      params: m.params,
    })),
    methodsTruncated: c.methodsTruncated || false,
    produces: c.produces,
    uses: c.uses,
    summary: c.summary,
    tags: c.tags,
    state: c.state,
    lineStart: c.lineStart,
  }));

  const catalog = {
    version: 1,
    project,
    generatedAt,
    knowledgeModelVersion: 1,
    components: slimComponents,
    relations,
    indexes,
  };

  const modules = [...new Set(slimComponents.map((c) => c.module))].sort();
  const kindCounts = {};
  for (const c of slimComponents) kindCounts[c.kind] = (kindCounts[c.kind] || 0) + 1;

  const meta = {
    $schema: "project-memory-meta/v1",
    project,
    catalogVersion: 1,
    knowledgeModelVersion: 1,
    generatedAt,
    sourceRoot: ".",
    modules,
    fileCount: javaFiles.length,
    artifactCount: slimComponents.length,
    relationCount: relations.length,
    kindCounts,
    contentHash: hash,
    productLevelsCovered: [1, 2, 3],
    indexer: {
      name: "index-catalog",
      version: "1.0.0",
      languageBinding: "java",
      architectureBinding: "hexagonal-ports-adapters",
    },
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "catalog.json"), JSON.stringify(catalog, null, 2));
  fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2));

  console.log(`Indexed ${slimComponents.length} components, ${relations.length} relations from ${javaFiles.length} files`);
  console.log(`Kinds: ${JSON.stringify(kindCounts)}`);
  console.log(`Wrote ${path.join(outDir, "catalog.json")}`);
  console.log(`Wrote ${path.join(outDir, "meta.json")}`);
}

main();

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const CODE_DIRS = ["app", "components", "lib", "scripts"];
const SQL_DIRS = [".", "supabase/migrations"];
const IGNORED_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  "coverage",
  "supabase/.branches",
]);

function walk(dir, extensions) {
  const fullDir = join(ROOT, dir);
  let entries;

  try {
    entries = readdirSync(fullDir);
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const path = join(fullDir, entry);
    const rel = relative(ROOT, path);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      if (!IGNORED_DIRS.has(entry) && !IGNORED_DIRS.has(rel)) {
        files.push(...walk(rel, extensions));
      }
      continue;
    }

    if ([...extensions].some((ext) => path.endsWith(ext))) {
      files.push(path);
    }
  }

  return files;
}

function extractCodeReferences() {
  const tableRefs = [];
  const rpcRefs = [];
  const codeFiles = CODE_DIRS.flatMap((dir) =>
    walk(dir, new Set([".ts", ".tsx"]))
  );

  const fromRegex = /\.from\(\s*["']([a-zA-Z_][a-zA-Z0-9_]*)["']\s*\)/g;
  const rpcRegex = /\.rpc\(\s*["']([a-zA-Z_][a-zA-Z0-9_]*)["']\s*[,)]/g;

  for (const file of codeFiles) {
    const text = readFileSync(file, "utf8");
    const rel = relative(ROOT, file);

    for (const match of text.matchAll(fromRegex)) {
      tableRefs.push({ name: match[1], file: rel });
    }

    for (const match of text.matchAll(rpcRegex)) {
      rpcRefs.push({ name: match[1], file: rel });
    }
  }

  return { tableRefs, rpcRefs };
}

function extractSqlDefinitions() {
  const tables = new Set();
  const functions = new Set();
  const sqlFiles = SQL_DIRS.flatMap((dir) => walk(dir, new Set([".sql"])));

  const tableRegex =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:(?:public|auth)\.)?([a-zA-Z_][a-zA-Z0-9_]*)/gi;
  const functionRegex =
    /create\s+(?:or\s+replace\s+)?function\s+(?:(?:public|auth)\.)?([a-zA-Z_][a-zA-Z0-9_]*)/gi;

  for (const file of sqlFiles) {
    const text = readFileSync(file, "utf8");

    for (const match of text.matchAll(tableRegex)) {
      tables.add(match[1]);
    }

    for (const match of text.matchAll(functionRegex)) {
      functions.add(match[1]);
    }
  }

  return { tables, functions };
}

function summarize(refs, defined) {
  const byName = new Map();

  for (const ref of refs) {
    if (defined.has(ref.name)) continue;
    const files = byName.get(ref.name) ?? new Set();
    files.add(ref.file);
    byName.set(ref.name, files);
  }

  return [...byName.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function printMissing(kind, missing) {
  if (missing.length === 0) {
    console.log(`OK: all referenced ${kind} are defined in checked-in SQL.`);
    return;
  }

  console.log(`Missing ${kind} definitions (${missing.length}):`);
  for (const [name, files] of missing) {
    const sample = [...files].slice(0, 4).join(", ");
    const suffix = files.size > 4 ? `, +${files.size - 4} more` : "";
    console.log(`  - ${name}: ${sample}${suffix}`);
  }
}

const warnOnly = process.argv.includes("--warn");
const { tableRefs, rpcRefs } = extractCodeReferences();
const { tables, functions } = extractSqlDefinitions();

const missingTables = summarize(tableRefs, tables);
const missingRpcs = summarize(rpcRefs, functions);

console.log(
  `Checked ${tableRefs.length} table references and ${rpcRefs.length} RPC references.`
);
console.log(
  `Found ${tables.size} SQL table definitions and ${functions.size} SQL function definitions.\n`
);

printMissing("table", missingTables);
console.log("");
printMissing("RPC", missingRpcs);

if (!warnOnly && (missingTables.length > 0 || missingRpcs.length > 0)) {
  process.exitCode = 1;
}

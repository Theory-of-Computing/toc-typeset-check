// Ad-hoc harness: run the real linter against a .zip on disk.
// Usage: node scripts/run-zip.mjs <path-to-zip>
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { lintProject, summarizeFindings } from "../src/linter/run.ts";
import { parseToctexZip } from "../src/linter/toctex.ts";

const TEXT_EXTENSIONS = new Set([".tex", ".sty", ".bib", ".cls", ".bst", ".txt", ".md"]);

function ext(p) {
  const name = p.toLowerCase().split("/").pop() ?? p;
  if (name.endsWith(".synctex.gz")) return ".synctex.gz";
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot) : "";
}

const zipPath = process.argv[2];
const zip = await JSZip.loadAsync(readFileSync(zipPath));
const files = [];
for (const entry of Object.values(zip.files)) {
  if (entry.dir) continue;
  const bytes = new Uint8Array(await entry.async("uint8array"));
  const lowerPath = entry.name.toLowerCase();
  const f = {
    path: entry.name,
    name: entry.name.split("/").pop() ?? entry.name,
    lowerPath,
    size: bytes.byteLength,
    bytes,
  };
  if (TEXT_EXTENSIONS.has(ext(lowerPath))) f.text = new TextDecoder("utf-8").decode(bytes);
  files.push(f);
}

// Load the canonical ToC distribution the same way the browser does.
const toctexPath = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "toctex.zip");
const journalFiles = existsSync(toctexPath) ? await parseToctexZip(readFileSync(toctexPath)) : new Map();

const project = { rootName: zipPath, files };
const { mainTexPath, findings } = lintProject(project, journalFiles);
const counts = summarizeFindings(findings);

console.log(`Main TeX: ${mainTexPath ?? "(not found)"}`);
console.log(`Files: ${files.length}  |  ${counts.errors} errors, ${counts.warnings} warnings, ${counts.infos} info\n`);
for (const f of findings) {
  const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "project";
  console.log(`[${f.severity.toUpperCase()}] ${f.ruleId} ${loc}\n    ${f.message}`);
}

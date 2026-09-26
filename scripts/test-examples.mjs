// Ad-hoc harness: lint + fix proposals + apply for all example zips.
// Usage: node --import tsx/esm scripts/test-examples.mjs
import { readFileSync, existsSync, readdirSync } from "node:fs";
import JSZip from "jszip";
import { lintProject } from "../src/linter/run.ts";
import { isSystemPath } from "../src/linter/project.ts";
import { parseToctexZip } from "../src/linter/toctex.ts";
import { buildProposals } from "../src/linter/fixes.ts";
import { applyFixes } from "../src/linter/apply.ts";

const TEXT_EXTENSIONS = new Set([".tex", ".sty", ".bib", ".cls", ".bst", ".txt", ".md"]);

function ext(p) {
  const name = p.toLowerCase().split("/").pop() ?? p;
  if (name.endsWith(".synctex.gz")) return ".synctex.gz";
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot) : "";
}

async function readZip(zipPath) {
  const zip = await JSZip.loadAsync(readFileSync(zipPath));
  const files = [];
  const ignoredSystemPaths = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    if (isSystemPath(entry.name)) { ignoredSystemPaths.push(entry.name); continue; }
    const bytes = new Uint8Array(await entry.async("uint8array"));
    const lowerPath = entry.name.toLowerCase();
    const f = { path: entry.name, name: entry.name.split("/").pop() ?? entry.name, lowerPath, size: bytes.byteLength, bytes };
    if (TEXT_EXTENSIONS.has(ext(lowerPath))) {
      try { f.text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { f.text = new TextDecoder("latin1").decode(bytes); }
    }
    files.push(f);
  }
  return { rootName: zipPath, files, ignoredSystemPaths };
}

const journalFiles = existsSync("public/toctex.zip")
  ? await parseToctexZip(readFileSync("public/toctex.zip"))
  : new Map();

const exampleFiles = readdirSync("test/examples").filter(f => f.endsWith(".zip")).sort();
let totalErrors = 0;

for (const zipName of exampleFiles) {
  const zipPath = `test/examples/${zipName}`;
  console.log(`\n${"=".repeat(64)}`);
  console.log(`  ${zipName}`);
  console.log("=".repeat(64));

  let project;
  try {
    project = await readZip(zipPath);
  } catch (e) {
    console.error(`  ERROR reading zip: ${e.message}`);
    totalErrors++;
    continue;
  }

  const { mainTexPath, findings } = lintProject(project, journalFiles);
  console.log(`  Main TeX: ${mainTexPath ?? "(not found)"} | Files: ${project.files.length}`);
  console.log(`  Findings: ${findings.filter(f=>f.severity==="error").length}E  ${findings.filter(f=>f.severity==="warning").length}W  ${findings.filter(f=>f.severity==="info").length}I`);

  let proposals;
  try {
    proposals = buildProposals(findings, project, journalFiles);
  } catch (e) {
    console.error(`  ERROR in buildProposals: ${e.message}\n${e.stack}`);
    totalErrors++;
    continue;
  }

  const hardStops = proposals.filter(p => p.tier === "hard-stop");
  const autoProposals = proposals.filter(p => p.tier === "auto");
  const interactive = proposals.filter(p => p.tier === "interactive");
  console.log(`  Proposals: ${autoProposals.length} auto, ${interactive.length} interactive, ${hardStops.length} hard-stops`);

  for (const p of proposals) {
    const f = p.finding;
    const loc = f.file ? `${f.file.split("/").pop()}${f.line ? `:${f.line}` : ""}` : "project";
    let fixSummary;
    if (p.tier === "auto") {
      if (!p.fixes || p.fixes.length === 0) fixSummary = "(no-op / implicit)";
      else fixSummary = p.fixes.map(fx =>
        fx.kind === "text"        ? `text("${fx.oldText.slice(0,30).replace(/\n/g,"↵")}"→"${fx.newText.slice(0,30).replace(/\n/g,"↵")}")` :
        fx.kind === "file-delete" ? `del(${fx.file.split("/").pop()})` :
        `replace(${fx.file.split("/").pop()})`
      ).join(", ");
    } else {
      fixSummary = `[${p.tier}]`;
    }
    console.log(`    ${f.ruleId}  ${loc}  =>  ${fixSummary}`);
  }

  // Apply all auto fixes and verify roundtrip
  const acceptedFixes = autoProposals.flatMap(p => p.fixes ?? []);
  if (acceptedFixes.length === 0) {
    console.log(`  Roundtrip: skipped (no auto fix actions)`);
    continue;
  }

  let patches;
  try {
    patches = applyFixes(project, acceptedFixes);
  } catch (e) {
    console.error(`  ERROR in applyFixes: ${e.message}\n${e.stack}`);
    totalErrors++;
    continue;
  }

  const patchedFiles = project.files
    .map(f => { const p = patches.get(f.path); if (p === null) return null; return typeof p === "string" ? {...f, text: p} : f; })
    .filter(Boolean);

  const patchedProject = { ...project, files: patchedFiles };
  const { findings: findingsAfter } = lintProject(patchedProject, journalFiles);

  const autoRuleIds = new Set(autoProposals.map(p => p.finding.ruleId));
  const surviving = findingsAfter.filter(f => autoRuleIds.has(f.ruleId));

  if (surviving.length === 0) {
    console.log(`  Roundtrip: OK — all auto findings cleared`);
  } else {
    console.log(`  Roundtrip: PARTIAL — ${surviving.length} auto finding(s) still present after patch:`);
    for (const f of surviving) {
      console.log(`    [${f.ruleId}] ${f.message.slice(0, 90)}`);
    }
  }
}

console.log(`\n${"=".repeat(64)}`);
console.log(totalErrors === 0 ? "All examples processed OK." : `${totalErrors} example(s) had hard errors.`);
if (totalErrors > 0) process.exit(1);

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { lintProject } from "../src/linter/run";
import { allRuleDocs } from "../src/linter/catalog";
import { parseToctexZip } from "../src/linter/toctex";
import type { Project, ProjectFile } from "../src/linter/types";

function loadFixture(name: string): Project {
  const root = join(__dirname, "fixtures", name);
  const files = walk(root).map((path) => {
    const bytes = readFileSync(path);
    const rel = relative(root, path).replaceAll("\\\\", "/");
    const text = /\.(tex|sty|bib|cls|bst|txt|md)$/i.test(path) ? bytes.toString("utf8") : undefined;
    return {
      path: rel,
      name: rel.split("/").pop() ?? rel,
      lowerPath: rel.toLowerCase(),
      size: bytes.byteLength,
      bytes: new Uint8Array(bytes),
      text,
    };
  });
  return { rootName: name, files };
}

function walk(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe("ToC linter MVP", () => {
  it("accepts the minimal fixture without errors", () => {
    const project = loadFixture("good-minimal");
    const { findings } = lintProject(project);
    expect(findings.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("flags representative violations", () => {
    const project = loadFixture("bad-sample");
    const { findings } = lintProject(project);
    const ids = new Set(findings.map((f) => f.ruleId));
    expect(ids.has("TOC011")).toBe(true); // wrong document class
    expect(ids.has("TOC015")).toBe(true); // duplicate tocdetails
    expect(ids.has("TOC026")).toBe(true); // \def
    expect(ids.has("TOC025")).toBe(true); // abstract cite
    expect(ids.has("TOC034")).toBe(true); // direct \ref
  });
});

describe("rule catalog", () => {
  it("documents exactly the rule IDs that rules.ts can emit", () => {
    const source = readFileSync(join(__dirname, "../src/linter/rules.ts"), "utf8");
    const emitted = new Set([...source.matchAll(/ruleId:\s*"(TOC\d+)"/g)].map((m) => m[1]));
    const documented = new Set(allRuleDocs.map((r) => r.id));

    const undocumented = [...emitted].filter((id) => !documented.has(id)).sort();
    const stale = [...documented].filter((id) => !emitted.has(id)).sort();

    expect({ undocumented, stale }).toEqual({ undocumented: [], stale: [] });
  });

  it("has no duplicate rule IDs in the catalog", () => {
    const ids = allRuleDocs.map((r) => r.id);
    expect(ids.length).toBe(new Set(ids).size);
  });
});

describe("journal files", () => {
  function textFile(name: string, text: string): ProjectFile {
    return { path: name, name, lowerPath: name.toLowerCase(), size: text.length, text };
  }

  it("accepts an unmodified journal file and flags a modified one", async () => {
    const journalFiles = await parseToctexZip(readFileSync(join(__dirname, "../public/toctex.zip")));
    const canonical = journalFiles.get("eprint.sty");
    expect(canonical).toBeTypeOf("string");

    const unmodified: Project = { rootName: "t", files: [textFile("eprint.sty", canonical!)] };
    const unmodifiedIds = new Set(lintProject(unmodified, journalFiles).findings.map((f) => f.ruleId));
    expect(unmodifiedIds.has("TOC040")).toBe(false);
    expect(unmodifiedIds.has("TOC026")).toBe(false); // \def inside a journal file is not flagged

    const modified: Project = { rootName: "t", files: [textFile("eprint.sty", `${canonical!}\n\\def\\x{y}`)] };
    const modifiedIds = new Set(lintProject(modified, journalFiles).findings.map((f) => f.ruleId));
    expect(modifiedIds.has("TOC040")).toBe(true);
  });
});

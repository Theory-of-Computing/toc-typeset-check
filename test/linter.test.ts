import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { lintProject } from "../src/linter/run";
import { allRuleDocs } from "../src/linter/catalog";
import { parseToctexZip } from "../src/linter/toctex";
import { isSystemPath } from "../src/linter/project";
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

  it("ignores unmodified distribution .tex/.bib copies left in the upload", async () => {
    const journalFiles = await parseToctexZip(readFileSync(join(__dirname, "../public/toctex.zip")));
    const sampleTex = journalFiles.get("toc-instructions.tex");
    const sampleBib = journalFiles.get("toc-instructions.bib");
    expect(sampleTex).toBeTypeOf("string");
    expect(sampleBib).toBeTypeOf("string");

    const main = "\\documentclass{toc}\n\\begin{document}\n\\end{document}\n";
    const project: Project = {
      rootName: "t",
      files: [
        textFile("paper.tex", main),
        textFile("toc-instructions.tex", sampleTex!),
        textFile("paper.bib", "@article{x, title={T}}"),
        textFile("toc-instructions.bib", sampleBib!),
      ],
    };
    const ids = new Set(lintProject(project, journalFiles).findings.map((f) => f.ruleId));
    expect(ids.has("TOC003")).toBe(false); // distribution .tex doesn't count as a second source
    expect(ids.has("TOC002")).toBe(false); // nor as a second main candidate
    expect(ids.has("TOC006")).toBe(false); // distribution .bib doesn't count as a second .bib

    // An edited copy (template turned into the author's own file) is counted.
    const edited: Project = {
      rootName: "t",
      files: [
        textFile("paper.tex", main),
        textFile("toc-instructions.tex", `${sampleTex!}\n% author edits\n`),
        textFile("paper.bib", "@article{x, title={T}}"),
      ],
    };
    const editedIds = new Set(lintProject(edited, journalFiles).findings.map((f) => f.ruleId));
    expect(editedIds.has("TOC003")).toBe(true);
  });

  it("ignores distribution support files by name even across versions", async () => {
    const journalFiles = await parseToctexZip(readFileSync(join(__dirname, "../public/toctex.zip")));
    const special = journalFiles.get("tocspecial.tex");
    expect(special).toBeTypeOf("string");

    // An older release of a support file (tocspecial.tex) differs in content but
    // is still part of the distribution and must not count as a second source.
    const olderVersion = special!.replace(/Version 0\.\d+/, "Version 0.01") + "\n% trimmed\n";
    const main = "\\documentclass{toc}\n\\begin{document}\n\\end{document}\n";
    const project: Project = {
      rootName: "t",
      files: [textFile("paper.tex", main), textFile("tocspecial.tex", olderVersion)],
    };
    const ids = new Set(lintProject(project, journalFiles).findings.map((f) => f.ruleId));
    expect(ids.has("TOC003")).toBe(false);
  });
});

describe("system artifacts", () => {
  it("recognizes common OS-generated paths", () => {
    expect(isSystemPath("__MACOSX/._paper.tex")).toBe(true);
    expect(isSystemPath("paper/.DS_Store")).toBe(true);
    expect(isSystemPath("._paper.tex")).toBe(true);
    expect(isSystemPath("Thumbs.db")).toBe(true);
    expect(isSystemPath("dir/desktop.ini")).toBe(true);
    expect(isSystemPath("paper.tex")).toBe(false);
    expect(isSystemPath("src/macros.sty")).toBe(false);
  });

  it("warns when system artifacts were present in the upload", () => {
    const project: Project = {
      rootName: "t",
      files: [],
      ignoredSystemPaths: ["__MACOSX/._paper.tex", "__MACOSX/._fig.pdf", "paper/.DS_Store"],
    };
    const findings = lintProject(project).findings.filter((f) => f.ruleId === "TOC041");
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence).toContain("__MACOSX/");
    expect(findings[0].evidence).toContain(".DS_Store");
  });
});

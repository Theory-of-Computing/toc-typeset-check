import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { lintProject } from "../src/linter/run";
import { allRuleDocs } from "../src/linter/catalog";
import { parseToctexZip } from "../src/linter/toctex";
import { isSystemPath } from "../src/linter/project";
import { buildProposals } from "../src/linter/fixes";
import { applyTextFixes, applyFixes } from "../src/linter/apply";
import type { Project, ProjectFile, TextFix, FileDeleteFix } from "../src/linter/types";

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
    expect(ids.has("TOC012")).toBe(true); // wrong document class
    expect(ids.has("TOC016")).toBe(true); // duplicate tocdetails
    expect(ids.has("TOC027")).toBe(true); // \def
    expect(ids.has("TOC026")).toBe(true); // abstract cite
    expect(ids.has("TOC036")).toBe(true); // direct \ref
    expect(ids.has("TOC044")).toBe(true); // operator defined with \newcommand plain-text body
    expect(ids.has("TOC045")).toBe(true); // operator used bare in math mode
    expect(ids.has("TOC046")).toBe(true); // <> used as inner product instead of \langle\rangle
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
    expect(unmodifiedIds.has("TOC042")).toBe(false);
    expect(unmodifiedIds.has("TOC027")).toBe(false); // \def inside a journal file is not flagged

    const modified: Project = { rootName: "t", files: [textFile("eprint.sty", `${canonical!}\n\\def\\x{y}`)] };
    const modifiedIds = new Set(lintProject(modified, journalFiles).findings.map((f) => f.ruleId));
    expect(modifiedIds.has("TOC042")).toBe(true);
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

describe("unused citations", () => {
  function textFile(name: string, text: string): ProjectFile {
    return { path: name, name, lowerPath: name.toLowerCase(), size: text.length, text };
  }

  const bib = [
    "@article{used, title={Used}, author={A}}",
    "@book{alsoused, title={Also}, author={B}}",
    "@inproceedings{orphan, title={Orphan}, author={C}}",
  ].join("\n\n");

  it("flags a .bib entry that is never cited", () => {
    const tex = "\\documentclass{toc}\n\\begin{document}\n\\cite{used}\\citep[p.~3]{alsoused}\n\\end{document}\n";
    const project: Project = { rootName: "t", files: [textFile("paper.tex", tex), textFile("refs.bib", bib)] };
    const findings = lintProject(project).findings.filter((f) => f.ruleId === "TOC034");
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("orphan");
  });

  it("does not flag anything when \\nocite{*} is present", () => {
    const tex = "\\documentclass{toc}\n\\begin{document}\n\\nocite{*}\n\\end{document}\n";
    const project: Project = { rootName: "t", files: [textFile("paper.tex", tex), textFile("refs.bib", bib)] };
    const ids = new Set(lintProject(project).findings.map((f) => f.ruleId));
    expect(ids.has("TOC034")).toBe(false);
  });

  it("treats citation keys case-insensitively and ignores @string/@comment", () => {
    const extras = '@string{j = "Journal"}\n@comment{ignored}\n@article{MixedCase, title={M}}';
    const tex = "\\documentclass{toc}\n\\begin{document}\n\\cite{used,alsoused,orphan}\\citet{mixedcase}\n\\end{document}\n";
    const project: Project = { rootName: "t", files: [textFile("paper.tex", tex), textFile("refs.bib", `${bib}\n\n${extras}`)] };
    const ids = new Set(lintProject(project).findings.map((f) => f.ruleId));
    expect(ids.has("TOC034")).toBe(false);
  });
});

describe("toc-template.tex", () => {
  function singleTex(name: string, text: string): Project {
    return {
      rootName: name,
      singleFile: true,
      files: [{ path: name, name, lowerPath: name.toLowerCase(), size: text.length, text }],
    };
  }

  const templateText = readFileSync(join(__dirname, "../public/toc-template.tex"), "utf8");

  it("produces no errors for the official template uploaded as a single .tex", () => {
    const errors = lintProject(singleTex("toc-template.tex", templateText)).findings.filter((f) => f.severity === "error");
    expect(errors).toEqual([]);
  });

  it("does not flag the author+editor two \\tocdetails blocks as a duplicate", () => {
    const ids = new Set(lintProject(singleTex("toc-template.tex", templateText)).findings.map((f) => f.ruleId));
    expect(ids.has("TOC016")).toBe(false);
  });

  it("does not flag the \\iffalse block marked DON'T TOUCH THIS LINE", () => {
    const ids = new Set(lintProject(singleTex("toc-template.tex", templateText)).findings.map((f) => f.ruleId));
    expect(ids.has("TOC029")).toBe(false);
  });

  it("still flags two populated author \\tocdetails blocks", () => {
    const tex = "\\documentclass{toc}\n\\tocdetails{title={A}}\n\\tocdetails{title={B}}\n\\begin{document}\\end{document}\n";
    const ids = new Set(lintProject(singleTex("p.tex", tex)).findings.map((f) => f.ruleId));
    expect(ids.has("TOC016")).toBe(true);
  });

  it("still flags a plain \\iffalse block without the template marker", () => {
    const tex = "\\documentclass{toc}\n\\begin{document}\n\\iffalse\nold proof\n\\fi\n\\end{document}\n";
    const ids = new Set(lintProject(singleTex("p.tex", tex)).findings.map((f) => f.ruleId));
    expect(ids.has("TOC029")).toBe(true);
  });

  it("reports missing companion files only for a full package, not a single .tex", () => {
    const single = new Set(lintProject(singleTex("toc-template.tex", templateText)).findings.map((f) => f.ruleId));
    expect(single.has("TOC043")).toBe(true); // note that checks were skipped
    expect(single.has("TOC005")).toBe(false); // no .bib, but not reported
    expect(single.has("TOC008")).toBe(false); // missing packages.sty/aumacros.sty, not reported
    expect(single.has("TOC032")).toBe(false); // yourbibfile.bib not found, not reported

    // The same source as part of a package: the missing files are real errors.
    const pkg: Project = {
      rootName: "p",
      files: [{ path: "paper.tex", name: "paper.tex", lowerPath: "paper.tex", size: templateText.length, text: templateText }],
    };
    const multi = new Set(lintProject(pkg).findings.map((f) => f.ruleId));
    expect(multi.has("TOC005")).toBe(true);
    expect(multi.has("TOC032")).toBe(true);
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
    const findings = lintProject(project).findings.filter((f) => f.ruleId === "TOC010");
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence).toContain("__MACOSX/");
    expect(findings[0].evidence).toContain(".DS_Store");
  });
});

// ── fix proposers ─────────────────────────────────────────────────────────────

describe("fix proposers", () => {
  function tex(name: string, text: string): ProjectFile {
    return { path: name, name, lowerPath: name.toLowerCase(), size: text.length, text };
  }

  function singleProject(content: string): Project {
    return { rootName: "paper.tex", singleFile: true, files: [tex("paper.tex", content)] };
  }

  // Helper: run linter, find the proposal for a specific rule, return its first fix.
  function firstFix(project: Project, ruleId: string, journalFiles = new Map<string, string>()) {
    const { findings } = lintProject(project, journalFiles);
    const proposals = buildProposals(findings, project, journalFiles);
    const proposal = proposals.find((p) => p.finding.ruleId === ruleId);
    return { proposal, fix: proposal?.fixes?.[0] };
  }

  it("TOC044 — proposes \\DeclareMathOperator for \\newcommand operator", () => {
    const src = "\\documentclass{toc}\n\\newcommand{\\rank}{rank}\n\\begin{document}\\end{document}";
    const { fix } = firstFix(singleProject(src), "TOC044");
    expect(fix?.kind).toBe("text");
    const tf = fix as TextFix;
    expect(tf.oldText).toBe("\\newcommand{\\rank}{rank}");
    expect(tf.newText).toBe("\\DeclareMathOperator{\\rank}{rank}");
    // Fix is located at the right offset
    expect(src.slice(tf.offset, tf.offset + tf.length)).toBe(tf.oldText);
  });

  it("TOC046 — proposes \\langle...\\rangle for <a, b>", () => {
    const src = "\\documentclass{toc}\n\\begin{document}\n$<u, v>$\n\\end{document}";
    const { fix } = firstFix(singleProject(src), "TOC046");
    expect(fix?.kind).toBe("text");
    const tf = fix as TextFix;
    expect(tf.newText).toBe("\\langle u, v \\rangle");
    expect(src.slice(tf.offset, tf.offset + tf.length)).toBe(tf.oldText);
  });

  it("TOC045 — interactive when operator not defined in preamble", () => {
    const src = "\\documentclass{toc}\n\\begin{document}\n$rank(A) = 1$\n\\end{document}";
    const project = singleProject(src);
    const { findings } = lintProject(project);
    const toc045 = findings.filter((f) => f.ruleId === "TOC045");
    expect(toc045.length).toBeGreaterThan(0);
    const proposals = buildProposals(toc045, project, new Map());
    expect(proposals[0].tier).toBe("interactive");
    expect(proposals[0].fixes).toBeUndefined();
  });

  it("TOC045 — auto-fix when operator is defined via \\DeclareMathOperator", () => {
    const src =
      "\\documentclass{toc}\n\\DeclareMathOperator{\\rank}{rank}\n\\begin{document}\n$rank(A) = 1$\n\\end{document}";
    const project = singleProject(src);
    const { findings } = lintProject(project);
    const toc045 = findings.filter((f) => f.ruleId === "TOC045");
    expect(toc045.length).toBeGreaterThan(0);
    const proposals = buildProposals(toc045, project, new Map());
    expect(proposals[0].tier).toBe("auto");
    expect(proposals[0].fixes).toBeDefined();
    const fix = proposals[0].fixes![0];
    expect(fix.kind).toBe("text");
    if (fix.kind === "text") {
      expect(fix.newText).toBe("\\rank");
    }
  });

  it("TOC045 — auto-fix when operator is defined via \\newcommand", () => {
    const src =
      "\\documentclass{toc}\n\\newcommand{\\rank}{rank}\n\\begin{document}\n$rank(A) = 1$\n\\end{document}";
    const project = singleProject(src);
    const { findings } = lintProject(project);
    const toc045 = findings.filter((f) => f.ruleId === "TOC045");
    expect(toc045.length).toBeGreaterThan(0);
    const proposals = buildProposals(toc045, project, new Map());
    expect(proposals[0].tier).toBe("auto");
  });

  it("TOC012 — proposes \\documentclass{toc} preserving options", () => {
    const src = "\\documentclass[12pt]{article}\n\\begin{document}\\end{document}";
    const project: Project = { rootName: "p", files: [tex("paper.tex", src)] };
    const { fix } = firstFix(project, "TOC012");
    expect(fix?.kind).toBe("text");
    const tf = fix as TextFix;
    expect(tf.newText).toBe("\\documentclass[12pt]{toc}");
    expect(src.slice(tf.offset, tf.offset + tf.length)).toBe(tf.oldText);
  });

  it("TOC030 — inserts \\bibliographystyle{tocplain} before \\bibliography", () => {
    const src = "\\documentclass{toc}\n\\begin{document}\n\\bibliography{refs}\n\\end{document}";
    const project: Project = { rootName: "p", files: [tex("paper.tex", src)] };
    const { findings } = lintProject(project);
    const proposals = buildProposals(findings, project, new Map());
    const prop = proposals.find((p) => p.finding.ruleId === "TOC030");
    const fix = prop?.fixes?.[0] as TextFix | undefined;
    expect(fix?.kind).toBe("text");
    expect(fix?.newText).toContain("\\bibliographystyle{tocplain}");
    expect(fix?.newText).toContain("\\bibliography{refs}");
    expect(src.slice(fix!.offset, fix!.offset + fix!.length)).toBe("\\bibliography{refs}");
  });

  it("TOC004 — proposes deleting generated files", () => {
    const project: Project = {
      rootName: "p",
      files: [tex("paper.tex", ""), tex("paper.aux", ""), tex("paper.log", "")],
    };
    const { findings } = lintProject(project);
    const proposals = buildProposals(findings, project, new Map());
    const prop = proposals.find((p) => p.finding.ruleId === "TOC004");
    expect(prop?.fixes?.length).toBeGreaterThanOrEqual(2);
    const deletedFiles = prop!.fixes!.map((f) => (f as FileDeleteFix).file);
    expect(deletedFiles).toContain("paper.aux");
    expect(deletedFiles).toContain("paper.log");
  });

  it("classifies hard-stop rules as hard-stop with no fixes", () => {
    const project: Project = {
      rootName: "p",
      files: [tex("a.tex", "\\documentclass{toc}\\begin{document}\\end{document}"), tex("b.tex", "\\documentclass{toc}\\begin{document}\\end{document}")],
    };
    const { findings } = lintProject(project);
    const proposals = buildProposals(findings, project, new Map());
    const toc003 = proposals.find((p) => p.finding.ruleId === "TOC003");
    expect(toc003?.tier).toBe("hard-stop");
    expect(toc003?.fixes).toBeUndefined();
  });

  it("fix offsets are consistent: applying the TextFix produces the expected result", () => {
    const src = "\\documentclass{toc}\n\\newcommand{\\sparsity}{sparsity}\n\\begin{document}\\end{document}";
    const { fix } = firstFix(singleProject(src), "TOC044");
    const tf = fix as TextFix;
    const patched = src.slice(0, tf.offset) + tf.newText + src.slice(tf.offset + tf.length);
    expect(patched).toContain("\\DeclareMathOperator{\\sparsity}{sparsity}");
    expect(patched).not.toContain("\\newcommand{\\sparsity}");
  });
});

// ── apply ─────────────────────────────────────────────────────────────────────

describe("applyTextFixes", () => {
  it("applies a single text fix at the correct position", () => {
    const text = "hello world";
    const result = applyTextFixes(text, [
      { kind: "text", file: "f", offset: 6, length: 5, oldText: "world", newText: "there" },
    ]);
    expect(result).toBe("hello there");
  });

  it("applies multiple non-overlapping fixes back-to-front", () => {
    const text = "aaa bbb ccc";
    //            0   4   8
    const result = applyTextFixes(text, [
      { kind: "text", file: "f", offset: 0, length: 3, oldText: "aaa", newText: "AAA" },
      { kind: "text", file: "f", offset: 8, length: 3, oldText: "ccc", newText: "CCC" },
    ]);
    expect(result).toBe("AAA bbb CCC");
  });

  it("handles insertion (length 0) correctly", () => {
    const text = "\\bibliography{refs}";
    const inserted = "\\bibliographystyle{tocplain}\n";
    const result = applyTextFixes(text, [
      { kind: "text", file: "f", offset: 0, length: 0, oldText: "", newText: inserted },
    ]);
    expect(result).toBe(`${inserted}\\bibliography{refs}`);
  });

  it("handles deletion (newText empty) correctly", () => {
    const text = "keep this\ndelete this\nkeep this too";
    const del = "delete this\n";
    const offset = text.indexOf(del);
    const result = applyTextFixes(text, [
      { kind: "text", file: "f", offset, length: del.length, oldText: del, newText: "" },
    ]);
    expect(result).toBe("keep this\nkeep this too");
  });

  it("skips overlapping fixes and keeps the later (lower offset) one", () => {
    const text = "abcdef";
    // Two overlapping patches: offset 0-3 and offset 2-5
    const result = applyTextFixes(text, [
      { kind: "text", file: "f", offset: 0, length: 3, oldText: "abc", newText: "XYZ" },
      { kind: "text", file: "f", offset: 2, length: 3, oldText: "cde", newText: "???" },
    ]);
    // sorted desc: [2-5, 0-3]. First applies 2-5 → "ab???f", then 0-3 would overlap end=5 > lastStart=2, skipped.
    expect(result).toBe("ab???f");
  });
});

describe("applyFixes (full project)", () => {
  function textFile(name: string, text: string): ProjectFile {
    return { path: name, name, lowerPath: name.toLowerCase(), size: text.length, text };
  }

  it("returns patched text for modified files and nothing for untouched ones", () => {
    const project: Project = {
      rootName: "p",
      files: [textFile("paper.tex", "hello world"), textFile("other.tex", "unchanged")],
    };
    const patches = applyFixes(project, [
      { kind: "text", file: "paper.tex", offset: 6, length: 5, oldText: "world", newText: "there" },
    ]);
    expect(patches.get("paper.tex")).toBe("hello there");
    expect(patches.has("other.tex")).toBe(false);
  });

  it("marks deleted files as null", () => {
    const project: Project = {
      rootName: "p",
      files: [textFile("paper.aux", ""), textFile("paper.tex", "src")],
    };
    const patches = applyFixes(project, [{ kind: "file-delete", file: "paper.aux" }]);
    expect(patches.get("paper.aux")).toBeNull();
    expect(patches.has("paper.tex")).toBe(false);
  });

  it("file-replace overrides text patches on the same file", () => {
    const project: Project = {
      rootName: "p",
      files: [textFile("style.sty", "old content")],
    };
    const patches = applyFixes(project, [
      { kind: "text", file: "style.sty", offset: 0, length: 3, oldText: "old", newText: "new" },
      { kind: "file-replace", file: "style.sty", newContent: "canonical" },
    ]);
    expect(patches.get("style.sty")).toBe("canonical");
  });

  it("file-delete overrides everything on the same file", () => {
    const project: Project = {
      rootName: "p",
      files: [textFile("paper.bbl", "bbl content")],
    };
    const patches = applyFixes(project, [
      { kind: "file-replace", file: "paper.bbl", newContent: "replaced" },
      { kind: "file-delete", file: "paper.bbl" },
    ]);
    expect(patches.get("paper.bbl")).toBeNull();
  });
});

describe("propose → apply → re-lint roundtrip", () => {
  function textFile(name: string, text: string): ProjectFile {
    return { path: name, name, lowerPath: name.toLowerCase(), size: text.length, text };
  }

  function applyAllAuto(project: Project, journalFiles = new Map<string, string>()): Project {
    const { findings } = lintProject(project, journalFiles);
    const proposals = buildProposals(findings, project, journalFiles);
    const fixes = proposals.filter((p) => p.tier === "auto").flatMap((p) => p.fixes ?? []);
    const patches = applyFixes(project, fixes);

    // Rebuild project with patched content
    const newFiles = project.files
      .filter((f) => patches.get(f.path) !== null)
      .map((f) => {
        const patched = patches.get(f.path);
        if (typeof patched === "string") return { ...f, text: patched, size: patched.length };
        return f;
      });
    return { ...project, files: newFiles };
  }

  it("TOC044: fixing \\newcommand operator removes the finding on re-lint", () => {
    const src = "\\documentclass{toc}\n\\newcommand{\\rank}{rank}\n\\begin{document}\\end{document}";
    const before: Project = { rootName: "p", singleFile: true, files: [textFile("paper.tex", src)] };
    expect(lintProject(before).findings.some((f) => f.ruleId === "TOC044")).toBe(true);
    const after = applyAllAuto(before);
    expect(lintProject(after).findings.some((f) => f.ruleId === "TOC044")).toBe(false);
  });

  it("TOC046: fixing <a,b> removes the finding on re-lint", () => {
    const src = "\\documentclass{toc}\n\\begin{document}\n$<u, v>$\n\\end{document}";
    const before: Project = { rootName: "p", singleFile: true, files: [textFile("paper.tex", src)] };
    expect(lintProject(before).findings.some((f) => f.ruleId === "TOC046")).toBe(true);
    const after = applyAllAuto(before);
    expect(lintProject(after).findings.some((f) => f.ruleId === "TOC046")).toBe(false);
  });

  it("TOC012: fixing wrong documentclass removes the finding on re-lint", () => {
    const src = "\\documentclass{article}\n\\begin{document}\\end{document}";
    const before: Project = { rootName: "p", files: [textFile("paper.tex", src)] };
    expect(lintProject(before).findings.some((f) => f.ruleId === "TOC012")).toBe(true);
    const after = applyAllAuto(before);
    expect(lintProject(after).findings.some((f) => f.ruleId === "TOC012")).toBe(false);
  });

  it("TOC004: auto-fix deletes all generated files from the project", () => {
    const before: Project = {
      rootName: "p",
      files: [textFile("paper.tex", ""), textFile("paper.aux", ""), textFile("paper.log", "")],
    };
    expect(lintProject(before).findings.some((f) => f.ruleId === "TOC004")).toBe(true);
    const after = applyAllAuto(before);
    expect(after.files.some((f) => f.path === "paper.aux")).toBe(false);
    expect(after.files.some((f) => f.path === "paper.log")).toBe(false);
  });

  it("applying multiple fixes simultaneously does not corrupt the file", () => {
    // File has both TOC044 (bad operator def) and TOC046 (angle bracket) issues.
    const src = [
      "\\documentclass{toc}",
      "\\newcommand{\\rank}{rank}",
      "\\begin{document}",
      "The inner product $<u, v>$ and $rank(A)$.",
      "\\end{document}",
    ].join("\n");
    const before: Project = { rootName: "p", singleFile: true, files: [textFile("paper.tex", src)] };
    const after = applyAllAuto(before);
    const patched = after.files[0].text ?? "";
    expect(patched).toContain("\\DeclareMathOperator{\\rank}{rank}");
    expect(patched).toContain("\\langle u, v \\rangle");
    expect(patched).not.toContain("\\newcommand{\\rank}");
    expect(patched).not.toContain("<u, v>");
  });
});

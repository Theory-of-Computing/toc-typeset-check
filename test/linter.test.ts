import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { lintProject } from "../src/linter/run";
import type { Project } from "../src/linter/types";

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

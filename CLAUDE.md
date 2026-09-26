# toc-typeset-check — Architecture Overview

## What This Is

A **client-side web app** that checks Theory of Computing (ToC) LaTeX submissions against the journal's copy-editing requirements. No files are ever uploaded to a server — all linting runs in the browser via pure TypeScript.

It also has a **secondary entry point** (`src/rules.ts` → `index.html`) that renders a static rules-reference catalog page.

## Tech Stack

- **Vite** for dev server and static site bundling
- **TypeScript** throughout
- **Vitest** for tests
- **JSZip** (the only runtime dependency) for reading `.zip` uploads in-browser

## Directory Map

```
src/
  main.ts          — UI entry point: file-input event, calls lintProject(), renders findings
  rules.ts         — Rules-reference page entry point: renders the rule catalog as HTML
  style.css        — Shared styles (badges, finding cards, etc.)
  linter/
    types.ts       — Core types: ProjectFile, Project, Finding, RuleContext, Rule, Severity
    project.ts     — Reads uploads (ZIP or single .tex), filters system files (macOS __MACOSX/ etc.)
    tex.ts         — TeX parsing helpers: strip comments, find matching braces, parse key-values
    rules.ts       — All lint rules as exported Rule[] array; each rule is (ctx: RuleContext) => Finding[]
    catalog.ts     — Human-readable docs for every rule ID; single source of truth for the rules-reference page
    run.ts         — Thin orchestrator: lintProject(project, journalFiles) -> { mainTexPath, findings }
    toctex.ts      — Loads toctex.zip (journal distribution files) and normalizes for comparison

public/
  toctex.zip       — Official ToC TeX distribution; fetched at runtime for journal-file checks
  toc-template.tex — Template .tex file served for download

scripts/
  update-toctex.mjs — Fetches a fresh toctex.zip from upstream
  run-zip.mjs       — Helper for local testing

test/
  linter.test.ts    — Vitest tests; loads fixtures from test/fixtures/
  fixtures/
    good-minimal/   — Minimal valid ToC package (zero errors expected)
    bad-sample/     — Intentionally broken package that should trigger specific rule IDs
```

## Data Flow

```
User uploads file
  └─ project.ts: readUpload() → Project { rootName, files: ProjectFile[] }

toctex.zip fetched from same origin
  └─ toctex.ts: loadToctex() / parseToctexZip() → Map<string, string>  (basename → normalized content)

run.ts: lintProject(project, journalFiles)
  ├─ project.ts: findMainTex(project) → ProjectFile | undefined
  └─ rules.ts: runRules(ctx) → Finding[]
       (calls each Rule in order; each Rule returns 0–N Finding objects)

main.ts: renders findings grouped by ruleId
```

## Rule System

- All rules live in `src/linter/rules.ts` as functions implementing `Rule = (ctx: RuleContext) => Finding[]`.
- The `rules` array at the bottom lists them in priority order.
- Each `Finding` has: `severity` ("error" | "warning" | "info"), `ruleId` (e.g. "TOC027"), `file`, `line`, `column`, `message`, `evidence`, `suggestion`.
- Rule IDs follow the pattern `TOC\d+`; the next available ID is tracked by the highest number in the file.
- `catalog.ts` must stay in sync with rule IDs emitted by `rules.ts` — a test enforces this.

## Adding a New Rule

1. Write a function `ruleXxx(ctx: RuleContext): Finding[]` in `src/linter/rules.ts`.
2. Add it to the `rules` array at the bottom of the file.
3. Add a `{ id: "TOCnnn", severity, summary }` entry to the appropriate category in `src/linter/catalog.ts`.
4. Add a test case in `test/linter.test.ts` → `"flags representative violations"` if it has a clear fixture trigger.

## Commands

```bash
npm run dev          # Vite dev server
npm run build        # tsc + vite build → dist/
npm test             # vitest run
npm run update-toctex  # fetch fresh toctex.zip
```

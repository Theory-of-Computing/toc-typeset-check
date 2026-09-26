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
  main.ts          — UI entry point: upload → lint → findings → interactive fix session
  rules.ts         — Rules-reference page entry point: renders the rule catalog as HTML
  style.css        — Shared styles (badges, finding cards, fix session UI, etc.)
  linter/
    types.ts       — Core types: ProjectFile, Project, Finding, RuleContext, Rule, Severity,
                     and fix types: FixTier, TextFix, FileReplaceFix, FileDeleteFix, Fix, FixProposal
    project.ts     — Reads uploads (ZIP or single .tex), filters system files (macOS __MACOSX/ etc.)
    tex.ts         — TeX parsing helpers: strip comments, find matching braces, parse key-values
    rules.ts       — All lint rules as exported Rule[] array; each rule is (ctx: RuleContext) => Finding[]
    catalog.ts     — Human-readable docs for every rule ID; single source of truth for the rules-reference page
    run.ts         — Thin orchestrator: lintProject(project, journalFiles) -> { mainTexPath, findings }
    toctex.ts      — Loads toctex.zip (journal distribution files) and normalizes for comparison
    hardstops.ts   — Classifies every rule ID into a FixTier: "hard-stop" | "auto" | "interactive"
    fixes.ts       — buildProposals(findings, project, journalFiles) → FixProposal[]; one proposer per auto rule
    apply.ts       — applyFixes(project, fixes) → Map<path, string|null>; applyTextFixes(text, fixes) → string

public/
  toctex.zip       — Official ToC TeX distribution; fetched at runtime for journal-file checks
  toc-template.tex — Template .tex file served for download

scripts/
  update-toctex.mjs  — Fetches a fresh toctex.zip from upstream
  run-zip.mjs        — Lint a single zip on disk (Node, no browser needed)
  test-examples.mjs  — Lint + propose + apply all zips in test/examples/ and report roundtrip results

test/
  linter.test.ts    — Vitest tests; fixtures + fix proposer + apply + roundtrip tests
  fixtures/
    good-minimal/   — Minimal valid ToC package (zero errors expected)
    bad-sample/     — Intentionally broken package that should trigger specific rule IDs
  examples/
    toc_2090.zip … toc_2276.zip  — Real ToC submission zips for integration testing
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

main.ts: renders findings; user clicks "Fix issues →"
  └─ fixes.ts: buildProposals(findings, project, journalFiles) → FixProposal[]
       (hard-stops shown as warnings; auto proposals shown as diffs; interactive show suggestion text)

User accepts/rejects/skips each proposal
  └─ apply.ts: applyFixes(project, acceptedFixes) → Map<path, string | null>
       (text patches applied back-to-front; file-replace overrides patches; file-delete overrides both)

User downloads → JSZip rebuilds the archive with patched files; deleted files omitted
```

## Rule System

- All rules live in `src/linter/rules.ts` as functions implementing `Rule = (ctx: RuleContext) => Finding[]`.
- The `rules` array at the bottom lists them in priority order.
- Each `Finding` has: `severity` ("error" | "warning" | "info"), `ruleId` (e.g. "TOC027"), `file`, `line`, `column`, `message`, `evidence`, `suggestion`.
- Rule IDs follow the pattern `TOC\d+`; the next available ID is tracked by the highest number in the file.
- `catalog.ts` must stay in sync with rule IDs emitted by `rules.ts` — a test enforces this.

## Fix System

Rules are classified into three tiers in `hardstops.ts`:
- **`hard-stop`**: cannot be fixed automatically (e.g. missing files, content that must be authored)
- **`auto`**: tool proposes a concrete diff; user accepts or rejects
- **`interactive`**: fix is structurally clear but needs a user value/choice (currently shown as a notice with the suggestion)

`fixes.ts` has one proposer function per auto rule. Key design invariants:
- `stripCommentsKeepLines` replaces comment chars with spaces of equal length, so offsets in stripped text map exactly to the same positions in the original file — text patches can be applied directly.
- `applyTextFixes` sorts patches descending by offset and applies back-to-front so earlier patches don't shift the positions of later ones.
- Priority within `applyFixes`: text patches < `file-replace` < `file-delete` (later overrides earlier for the same file path).
- `findOffsetNearLine` searches a 2000-char window around the reported line before falling back to a whole-file search, avoiding false matches on repeated strings.
- A proposer may return `null` to signal that this specific finding instance cannot be auto-fixed (e.g. a prerequisite is missing). `buildProposals` then downgrades that proposal to `"interactive"` so the suggestion text is shown instead of a diff. This lets a rule live in `AUTO_RULES` while gracefully falling back per-finding.

### Adding a fix proposer for an auto rule

1. Add the rule ID to `AUTO_RULES` in `hardstops.ts`.
2. Write `proposeTOCnnn(finding, project, journalFiles): Fix[] | null` in `fixes.ts`.
   - Return `Fix[]` (including `[]` for no-op auto fixes like TOC010) when the fix can be applied.
   - Return `null` when this specific instance lacks a prerequisite and should fall back to interactive.
3. Register it in the `PROPOSERS` map in `fixes.ts`.
4. Add a roundtrip test in `test/linter.test.ts`: propose → apply → re-lint → assert the finding is gone.

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

# Integration test against all real example zips (no browser needed):
node --import tsx/esm scripts/test-examples.mjs
```

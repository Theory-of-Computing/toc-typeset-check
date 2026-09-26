import type { Fix, Finding, FixProposal, FixTier, Project } from "./types";
import { classifyFinding } from "./hardstops";
import { basename } from "./project";

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Build a FixProposal for every finding. Hard-stop and interactive proposals
 * carry no fixes; auto proposals carry the computed Fix array.
 *
 * A proposer may return `null` to signal that this specific finding instance
 * cannot be auto-fixed (e.g. a missing prerequisite), in which case the
 * proposal is downgraded to "interactive" so the suggestion text is shown.
 */
export function buildProposals(
  findings: Finding[],
  project: Project,
  journalFiles: Map<string, string>,
): FixProposal[] {
  return findings.map((finding) => {
    const tier: FixTier = classifyFinding(finding);
    if (tier !== "auto") return { finding, tier };
    const result = proposeFix(finding, project, journalFiles);
    // null → proposer says this instance needs manual intervention
    if (result === null) return { finding, tier: "interactive" };
    return { finding, tier, fixes: result };
  });
}

// ── internal dispatch ─────────────────────────────────────────────────────────

// null return = auto fix not possible for this instance; show interactive notice instead.
type Proposer = (finding: Finding, project: Project, journalFiles: Map<string, string>) => Fix[] | null;

const PROPOSERS: Partial<Record<string, Proposer>> = {
  TOC004: proposeTOC004,
  TOC007: proposeTOC007,
  TOC010: proposeTOC010,
  TOC012: proposeTOC012,
  TOC030: proposeTOC030,
  TOC034: proposeTOC034,
  TOC042: proposeTOC042,
  TOC044: proposeTOC044,
  TOC045: proposeTOC045,
  TOC046: proposeTOC046,
};

function proposeFix(
  finding: Finding,
  project: Project,
  journalFiles: Map<string, string>,
): Fix[] | null | undefined {
  const proposer = PROPOSERS[finding.ruleId];
  if (!proposer) return undefined;
  try {
    return proposer(finding, project, journalFiles);
  } catch {
    return undefined;
  }
}

// ── shared helpers ────────────────────────────────────────────────────────────

const GENERATED_EXTENSIONS = new Set([
  ".aux", ".log", ".out", ".blg", ".bbl", ".brf", ".toc", ".fls",
  ".fdb_latexmk", ".synctex.gz",
]);

function fileExt(path: string): string {
  const name = (path.split("/").pop() ?? path).toLowerCase();
  if (name.endsWith(".synctex.gz")) return ".synctex.gz";
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot) : "";
}

function getFileText(finding: Finding, project: Project): string | undefined {
  return project.files.find((f) => f.path === finding.file)?.text;
}

/**
 * Find the character offset of `needle` in `text`, searching near `nearLine`
 * (1-indexed). Falls back to a whole-file search if the line window misses.
 */
function findOffsetNearLine(text: string, needle: string, nearLine?: number): number | undefined {
  if (!nearLine) {
    const idx = text.indexOf(needle);
    return idx >= 0 ? idx : undefined;
  }
  const lines = text.split("\n");
  let lineStart = 0;
  for (let i = 0; i < nearLine - 1 && i < lines.length; i++) lineStart += lines[i].length + 1;

  // Generous window: 100 bytes before the indicated line start, up to 2000 bytes
  // after, so even long lines and short run-on search targets are covered.
  const from = Math.max(0, lineStart - 100);
  const to = Math.min(text.length, lineStart + 2000);
  const windowIdx = text.slice(from, to).indexOf(needle);
  if (windowIdx >= 0) return from + windowIdx;

  // Fallback: whole-file search — only reached when the occurrence is far from
  // the reported line number (e.g. a search target spanning a page break).
  const idx = text.indexOf(needle);
  return idx >= 0 ? idx : undefined;
}

// ── proposers ─────────────────────────────────────────────────────────────────

// TOC004 — delete generated build artifacts (.aux, .log, .bbl, etc.)
function proposeTOC004(_f: Finding, project: Project): Fix[] {
  return project.files
    .filter((f) => GENERATED_EXTENSIONS.has(fileExt(f.path)))
    .map((f): Fix => ({ kind: "file-delete", file: f.path }));
}

// TOC007 — delete .bbl file
function proposeTOC007(_f: Finding, project: Project): Fix[] {
  return project.files
    .filter((f) => f.lowerPath.endsWith(".bbl"))
    .map((f): Fix => ({ kind: "file-delete", file: f.path }));
}

// TOC010 — system files (__MACOSX, .DS_Store, etc.) are already excluded from
// project.files at read time, so the rebuilt zip will naturally omit them.
function proposeTOC010(): Fix[] {
  return [];
}

// TOC012 — wrong \documentclass{xxx} → \documentclass{toc}
function proposeTOC012(finding: Finding, project: Project): Fix[] {
  const text = getFileText(finding, project);
  if (!text) return [];
  const match = /\\documentclass(\[[^\]]*\])?\s*\{[^}]+\}/.exec(text);
  if (!match) return [];
  const opts = match[1] ?? "";
  const oldText = match[0];
  const newText = `\\documentclass${opts}{toc}`;
  return [{ kind: "text", file: finding.file!, offset: match.index, length: oldText.length, oldText, newText }];
}

// TOC030 — insert \bibliographystyle{tocplain} before \bibliography{...}
function proposeTOC030(finding: Finding, project: Project): Fix[] {
  const text = getFileText(finding, project);
  if (!text) return [];
  const match = /\\bibliography\s*\{[^}]+\}/.exec(text);
  if (!match) return [];
  const oldText = match[0];
  const newText = `\\bibliographystyle{tocplain}\n${oldText}`;
  return [{ kind: "text", file: finding.file!, offset: match.index, length: oldText.length, oldText, newText }];
}

// TOC034 — remove uncited .bib entry (evidence = "@type{key")
function proposeTOC034(finding: Finding, project: Project): Fix[] {
  if (!finding.file || !finding.evidence) return [];
  const text = getFileText(finding, project);
  if (!text) return [];

  // evidence = "@<type>{<key>" where type is lowercased.
  // The actual bib text may use different case and may have spaces between
  // the type and the opening delimiter ({  or  (). Use a regex instead of
  // a literal string search.
  const key = finding.evidence.split("{")[1];
  if (!key) return [];
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const entryPattern = new RegExp(`@\\w+\\s*[{(]\\s*${escapedKey}`, "i");

  // Search near the indicated line first, then fall back to full file.
  const lines = text.split("\n");
  let lineStart = 0;
  for (let i = 0; i < (finding.line ?? 1) - 1 && i < lines.length; i++) {
    lineStart += lines[i].length + 1;
  }
  const from = Math.max(0, lineStart - 100);
  const to = Math.min(text.length, lineStart + 500);
  const windowMatch = entryPattern.exec(text.slice(from, to));
  const startIdx = windowMatch ? from + windowMatch.index : (() => {
    const m = entryPattern.exec(text);
    return m ? m.index : -1;
  })();
  if (startIdx < 0) return [];

  // Walk to the opening delimiter
  let i = startIdx;
  while (i < text.length && text[i] !== "{" && text[i] !== "(") i++;
  if (i >= text.length) return [];

  // Match braces/parens to find the entry's end
  let depth = 0;
  let endIdx = -1;
  for (let j = i; j < text.length; j++) {
    const ch = text[j];
    if (ch === "{" || ch === "(") depth++;
    else if (ch === "}" || ch === ")") {
      depth--;
      if (depth === 0) { endIdx = j + 1; break; }
    }
  }
  if (endIdx < 0) return [];

  // Consume one trailing newline to avoid leaving a blank line
  if (endIdx < text.length && text[endIdx] === "\n") endIdx++;

  const oldText = text.slice(startIdx, endIdx);
  return [{ kind: "text", file: finding.file, offset: startIdx, length: oldText.length, oldText, newText: "" }];
}

// TOC042 — restore modified journal file from canonical toctex.zip content
function proposeTOC042(finding: Finding, _project: Project, journalFiles: Map<string, string>): Fix[] {
  if (!finding.file) return [];
  const canonical = journalFiles.get(basename(finding.file).toLowerCase());
  if (!canonical) return [];
  return [{ kind: "file-replace", file: finding.file, newContent: canonical }];
}

// TOC044 — \newcommand{\op}{word} → \DeclareMathOperator{\op}{word}
function proposeTOC044(finding: Finding, project: Project): Fix[] {
  if (!finding.evidence) return [];
  const text = getFileText(finding, project);
  if (!text) return [];

  // Extract cmdName (\rank) and operatorName (rank) from the evidence string.
  // Body is either {word} (double-braced in source) or plain word.
  const m = /\\newcommand\s*\{(\\[A-Za-z]+)\}(?:\[\d+\])?\s*\{(?:\{([a-z]+)\}|([a-z]+))\}/.exec(
    finding.evidence,
  );
  if (!m) return [];
  const cmdName = m[1];
  const operatorName = m[2] ?? m[3];

  const oldText = finding.evidence;
  const newText = `\\DeclareMathOperator{${cmdName}}{${operatorName}}`;
  const offset = findOffsetNearLine(text, oldText, finding.line);
  if (offset === undefined) return [];
  return [{ kind: "text", file: finding.file!, offset, length: oldText.length, oldText, newText }];
}

// TOC045 — bare operator name used in math mode, e.g. "rank(" instead of "\rank("
// Auto-fix only when the operator is already defined in the project (via
// \DeclareMathOperator, \newcommand, \renewcommand, \providecommand, or \def).
// Returns null when the operator is not defined — the caller will downgrade
// this proposal to "interactive" so the suggestion text is shown instead.
function proposeTOC045(finding: Finding, project: Project): Fix[] | null {
  if (!finding.evidence || !finding.line) return null;

  // evidence = "rank(" or "rank (" — extract the operator name
  const opMatch = /^([A-Za-z]+)\s*\(/.exec(finding.evidence.trim());
  if (!opMatch) return null;
  const opName = opMatch[1];

  if (!isOperatorDefined(opName, project)) return null;

  const text = getFileText(finding, project);
  if (!text) return null;

  // Search for "rank(" (including the paren) so we don't accidentally match
  // the operator name inside a \newcommand or \DeclareMathOperator definition.
  const searchNeedle = `${opName}(`;
  const offset = findOffsetNearLine(text, searchNeedle, finding.line);
  if (offset === undefined) return null;

  // Patch only the bare name portion (not the paren) so the call site becomes \rank(
  const patchOld = opName;
  const patchNew = `\\${opName}`;
  return [{ kind: "text", file: finding.file!, offset, length: patchOld.length, oldText: patchOld, newText: patchNew }];
}

/**
 * Returns true when `opName` (e.g. "rank") is defined anywhere in the project
 * via \DeclareMathOperator, \newcommand, \renewcommand, \providecommand, or \def.
 */
function isOperatorDefined(opName: string, project: Project): boolean {
  // Matches e.g.:
  //   \DeclareMathOperator{\rank}{rank}
  //   \DeclareMathOperator*{\rank}{rank}
  //   \newcommand{\rank}{...}
  //   \def\rank{...}
  const pattern = new RegExp(
    `\\\\(?:DeclareMathOperator\\*?|newcommand|renewcommand|providecommand)\\s*\\{?\\\\${opName}\\b|\\\\def\\s*\\\\${opName}\\b`,
  );
  return project.files.some((f) => {
    const ext = f.lowerPath.slice(f.lowerPath.lastIndexOf("."));
    if (![".tex", ".sty", ".cls"].includes(ext)) return false;
    return pattern.test(f.text ?? "");
  });
}

// TOC046 — <a, b> → \langle a, b \rangle
function proposeTOC046(finding: Finding, project: Project): Fix[] {
  if (!finding.evidence || !finding.line) return [];
  const text = getFileText(finding, project);
  if (!text) return [];

  const oldText = finding.evidence; // e.g. "<v_1, v_2>"
  const inner = oldText.slice(1, -1);
  const commaIdx = inner.indexOf(",");
  if (commaIdx < 0) return [];
  const lhs = inner.slice(0, commaIdx).trim();
  const rhs = inner.slice(commaIdx + 1).trim();
  const newText = `\\langle ${lhs}, ${rhs} \\rangle`;

  const offset = findOffsetNearLine(text, oldText, finding.line);
  if (offset === undefined) return [];
  return [{ kind: "text", file: finding.file!, offset, length: oldText.length, oldText, newText }];
}

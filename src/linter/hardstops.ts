import type { Finding, FixTier } from "./types";

// Rules that cannot be fixed even with user interaction — either the required
// content does not exist in the upload, or the fix requires merging document
// text that only an author can do.
const HARD_STOP_RULES = new Set([
  "TOC003", // multiple .tex files — merging manuscript content
  "TOC005", // no .bib file — cannot create BibTeX from scratch
  "TOC006", // multiple .bib files — cannot merge/deduplicate
  "TOC009", // no .tex file at all
  "TOC035", // \input target missing from upload
  "TOC037", // graphic file missing from upload
  "TOC038", // non-PDF graphic — no in-browser format conversion
  "TOC043", // info-only: single-file upload, package checks skipped
]);

// Rules where the tool can propose and apply a fix automatically, but still
// shows it to the user for approval before touching anything.
const AUTO_RULES = new Set([
  "TOC004", // delete generated build artifacts
  "TOC007", // delete .bbl file
  "TOC010", // delete system-generated files (macOS, Windows)
  "TOC012", // wrong \documentclass → \documentclass{toc}
  "TOC030", // insert \bibliographystyle{tocplain}
  "TOC034", // remove uncited .bib entries
  "TOC042", // restore modified journal file from canonical toctex.zip copy
  "TOC044", // \newcommand operator → \DeclareMathOperator
  "TOC045", // bare operator name — auto-fix if operator is already defined in preamble
  "TOC046", // <a,b> → \langle a, b \rangle
]);

// Rules where the fix is structurally clear but needs a user choice or value.
const INTERACTIVE_RULES = new Set([
  "TOC008", // missing support file — copy from toctex.zip?
  "TOC016", // duplicate \tocdetails — which block to keep?
  "TOC017", // \tocdetails after \begin{document} — move to preamble?
  "TOC018", // missing required \tocdetails key — enter value
  "TOC019", // placeholder value in \tocdetails — enter real value
  "TOC025", // abstract outside frontmatter — move inside?
  "TOC033", // appendix after bibliography — move before?
  "TOC036", // bare \ref — choose replacement macro
  "TOC039", // author name mismatch — which list is authoritative?
  "TOC040", // tocabout label mismatch — correct to what?
  "TOC041", // tocinfo label missing tocabout — add block?
]);

export function classifyFinding(finding: Finding): FixTier {
  if (HARD_STOP_RULES.has(finding.ruleId)) return "hard-stop";
  if (AUTO_RULES.has(finding.ruleId)) return "auto";
  if (INTERACTIVE_RULES.has(finding.ruleId)) return "interactive";
  // Anything not explicitly classified is treated conservatively.
  return "hard-stop";
}

export function isHardStop(finding: Finding): boolean {
  return classifyFinding(finding) === "hard-stop";
}

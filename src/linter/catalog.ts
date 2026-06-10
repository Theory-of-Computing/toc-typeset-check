import type { Severity } from "./types";

export type RuleDoc = {
  id: string;
  severity: Severity;
  summary: string;
};

export type RuleCategory = {
  title: string;
  description: string;
  rules: RuleDoc[];
};

// Canonical list of every check the linter can emit. This is the single source
// of truth for the rules-reference page. When a rule is added or changed in
// `rules.ts`, update its entry here too (a test asserts the IDs stay in sync).
export const ruleCatalog: RuleCategory[] = [
  {
    title: "Project structure",
    description: "Checks across the whole upload: which files are present and which should not be.",
    rules: [
      { id: "TOC001", severity: "error", summary: "No .tex file contains \\documentclass{toc}." },
      { id: "TOC002", severity: "error", summary: "More than one .tex file looks like a ToC main document." },
      { id: "TOC003", severity: "error", summary: "The upload contains more than one .tex file; ToC requires a single .tex source." },
      { id: "TOC004", severity: "warning", summary: "The upload includes generated build artifacts (.aux, .log, .out, .blg, .bbl, .brf, .toc, .fls, .fdb_latexmk, .synctex.gz)." },
      { id: "TOC005", severity: "error", summary: "No .bib file was found; ToC needs BibTeX source, not only a .bbl." },
      { id: "TOC006", severity: "error", summary: "More than one .bib file was found; ToC requires a single .bib file." },
      { id: "TOC007", severity: "warning", summary: "A .bbl file is included, but the package should build from .bib." },
      { id: "TOC008", severity: "error", summary: "A required support file is missing (packages.sty or aumacros.sty)." },
      { id: "TOC009", severity: "error", summary: "No .tex source file was found at all." },
      { id: "TOC041", severity: "warning", summary: "The upload contains system-generated files or folders (e.g. macOS __MACOSX/, .DS_Store; Windows Thumbs.db) that should be removed from the zip." },
    ],
  },
  {
    title: "Main document shape",
    description: "Structural checks on the main .tex file.",
    rules: [
      { id: "TOC010", severity: "error", summary: "Missing \\documentclass{...}." },
      { id: "TOC011", severity: "error", summary: "The main file does not use the toc document class." },
      { id: "TOC012", severity: "error", summary: "Missing \\begin{document}." },
      { id: "TOC013", severity: "error", summary: "Missing \\end{document}." },
    ],
  },
  {
    title: "\\tocdetails metadata block",
    description: "Validates the ToC metadata block and its required keys.",
    rules: [
      { id: "TOC014", severity: "error", summary: "Missing \\tocdetails{...}." },
      { id: "TOC015", severity: "error", summary: "Duplicate \\tocdetails block." },
      { id: "TOC016", severity: "error", summary: "\\tocdetails appears after \\begin{document} instead of in the preamble." },
      { id: "TOC017", severity: "error", summary: "A required \\tocdetails key is missing or empty (title, number_of_pages, number_of_bibitems, number_of_figures, conference_version, author, authorlist, acmclassification, amsclassification, keywords)." },
      { id: "TOC018", severity: "warning", summary: "A \\tocdetails value is still a template placeholder (e.g. NN, XXXXNN, ACM Classifications, AMS Classifications, TODO, TBD, ???)." },
    ],
  },
  {
    title: "Frontmatter & abstract",
    description: "Placement of the frontmatter and abstract environments.",
    rules: [
      { id: "TOC019", severity: "error", summary: "Missing frontmatter environment." },
      { id: "TOC020", severity: "error", summary: "Missing \\end{frontmatter}." },
      { id: "TOC021", severity: "error", summary: "frontmatter appears before \\begin{document}." },
      { id: "TOC022", severity: "warning", summary: "frontmatter is not immediately after \\begin{document}." },
      { id: "TOC023", severity: "error", summary: "Missing abstract environment." },
      { id: "TOC024", severity: "error", summary: "The abstract is not inside the frontmatter environment." },
      { id: "TOC025", severity: "warning", summary: "The abstract contains a citation/reference command; abstracts should be self-contained." },
    ],
  },
  {
    title: "Forbidden / discouraged macros",
    description: "Macro definitions that ToC disallows or discourages.",
    rules: [
      { id: "TOC026", severity: "error", summary: "Use of \\def is not allowed; use \\newcommand or \\DeclareMathOperator." },
      { id: "TOC027", severity: "error", summary: "Use of \\renewcommand is not allowed; it redefines predefined macros and can cause undetected typesetting errors." },
    ],
  },
  {
    title: "Dead / draft text",
    description: "Leftover draft content that should be removed before submission.",
    rules: [
      { id: "TOC028", severity: "warning", summary: "Dead or draft content remains (\\iffalse, comment environment, \\ignore{...}, or a TODO/FIXME marker)." },
    ],
  },
  {
    title: "Bibliography",
    description: "Bibliography style, database, and ordering checks.",
    rules: [
      { id: "TOC029", severity: "error", summary: "Missing \\bibliographystyle{tocplain}." },
      { id: "TOC030", severity: "error", summary: "Missing \\bibliography{...}." },
      { id: "TOC031", severity: "error", summary: "A .bib file named in \\bibliography{...} is not present in the upload." },
      { id: "TOC032", severity: "warning", summary: "An appendix appears after the bibliography." },
    ],
  },
  {
    title: "Input files",
    description: "Resolution of included source files.",
    rules: [
      { id: "TOC033", severity: "error", summary: "A file referenced by \\input{...} or \\include{...} was not found in the upload." },
    ],
  },
  {
    title: "References",
    description: "Cross-reference command usage.",
    rules: [
      { id: "TOC034", severity: "warning", summary: "A bare \\ref{...} was used; prefer a named macro such as \\expref or \\prettyref (equations excepted)." },
    ],
  },
  {
    title: "Graphics",
    description: "Figure files and formats.",
    rules: [
      { id: "TOC035", severity: "error", summary: "An \\includegraphics{...} target file was not found in the upload." },
      { id: "TOC036", severity: "error", summary: "An included graphic is not a PDF; ToC requires graphics to be supplied in .pdf format." },
    ],
  },
  {
    title: "Author consistency",
    description: "Cross-checks author names and labels between \\tocdetails, the frontmatter, and the tocinfo/tocabout blocks.",
    rules: [
      { id: "TOC037", severity: "warning", summary: "Author names in the frontmatter do not exactly match the author field in \\tocdetails." },
      { id: "TOC038", severity: "error", summary: "A tocabout label does not match any \\author or tocinfo label." },
      { id: "TOC039", severity: "error", summary: "A tocinfo label has no matching tocabout block." },
    ],
  },
  {
    title: "Journal-provided files",
    description: "Checks the ToC TeX distribution files (toc.cls, tocbase.cls, eprint.sty, tocplain.bst, etc.). These are not scanned for forbidden macros, but must not be modified by the author.",
    rules: [
      { id: "TOC040", severity: "warning", summary: "A ToC-provided style/class/bst file differs from the official distribution; it may have been modified or be from an older release." },
    ],
  },
];

export const allRuleDocs: RuleDoc[] = ruleCatalog.flatMap((c) => c.rules);

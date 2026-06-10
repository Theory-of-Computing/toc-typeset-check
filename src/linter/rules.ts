import type { Finding, Project, ProjectFile, Rule, RuleContext } from "./types";
import { basename, fileExtension, fileExists, findFile } from "./project";
import {
  findCommandArgs,
  findMatchingBrace,
  lineColAtOffset,
  normalizeLatexText,
  parseTopLevelKeyValues,
  splitAuthorList,
  stripCommentsKeepLines,
} from "./tex";

const generatedExtensions = new Set([
  ".aux",
  ".log",
  ".out",
  ".blg",
  ".bbl",
  ".brf",
  ".toc",
  ".fls",
  ".fdb_latexmk",
  ".synctex.gz",
]);

const placeholderValues = new Set(["NN", "XXXXNN", "ACM Classifications", "AMS Classifications", "TODO", "TBD", "???"]);

export const rules: Rule[] = [
  ruleProjectStructure,
  ruleMainDocumentShape,
  ruleTocDetails,
  ruleFrontmatter,
  ruleForbiddenMacros,
  ruleDeadTextMarkers,
  ruleBibliography,
  ruleInputFiles,
  ruleReferences,
  ruleGraphics,
  ruleAuthorConsistency,
];

export function runRules(ctx: RuleContext): Finding[] {
  return rules.flatMap((rule) => rule(ctx)).sort(compareFindings);
}

function ruleProjectStructure({ project, mainTex }: RuleContext): Finding[] {
  const findings: Finding[] = [];
  const texFiles = project.files.filter((f) => f.lowerPath.endsWith(".tex"));
  const mainCandidates = texFiles.filter((f) =>
    /\\documentclass(?:\[[^\]]*\])?\s*\{toc\}/.test(stripCommentsKeepLines(f.text ?? "")),
  );

  if (mainCandidates.length === 0) {
    findings.push({
      severity: "error",
      ruleId: "TOC001",
      message: "No .tex file with \\documentclass{toc} was found.",
      suggestion: "The main source should start with \\documentclass{toc}.",
    });
  }

  if (mainCandidates.length > 1) {
    findings.push({
      severity: "error",
      ruleId: "TOC002",
      message: "More than one .tex file appears to be a ToC main document.",
      evidence: mainCandidates.map((f) => f.path).join(", "),
      suggestion: "Keep one main .tex file and make other files inputs/macros only if editorial policy allows it.",
    });
  }

  if (texFiles.length > 1) {
    findings.push({
      severity: "warning",
      ruleId: "TOC003",
      message: `The upload contains ${texFiles.length} .tex files.`,
      evidence: texFiles.map((f) => f.path).join(", "),
      suggestion:
        "For copy-editing, a single source file is easiest to handle. Keep this warning configurable if the editor allows small \\input files.",
    });
  }

  const generatedFiles = project.files.filter((f) => generatedExtensions.has(fileExtension(f.path)));
  if (generatedFiles.length > 0) {
    findings.push({
      severity: "warning",
      ruleId: "TOC004",
      message: "The upload includes generated/compiled files.",
      evidence: generatedFiles.map((f) => f.path).slice(0, 12).join(", "),
      suggestion: "Remove build products such as .aux, .log, .out, .blg, .brf, and usually .bbl/.pdf unless requested.",
    });
  }

  const bibFiles = project.files.filter((f) => f.lowerPath.endsWith(".bib"));
  const bblFiles = project.files.filter((f) => f.lowerPath.endsWith(".bbl"));

  if (bibFiles.length === 0) {
    findings.push({
      severity: "error",
      ruleId: "TOC005",
      message: "No .bib file was found.",
      suggestion: "ToC source packages should include BibTeX source, not only a .bbl file.",
    });
  }

  if (bibFiles.length > 1) {
    findings.push({
      severity: "warning",
      ruleId: "TOC006",
      message: "More than one .bib file was found.",
      evidence: bibFiles.map((f) => f.path).join(", "),
      suggestion: "Use a single bibliography database unless the editor asks otherwise.",
    });
  }

  if (bblFiles.length > 0) {
    findings.push({
      severity: "warning",
      ruleId: "TOC007",
      message: "A .bbl file is included even though the source package should be based on a .bib file.",
      evidence: bblFiles.map((f) => f.path).join(", "),
      suggestion: "Remove the .bbl unless explicitly requested.",
    });
  }

  for (const required of ["packages.sty", "aumacros.sty"]) {
    if (!project.files.some((f) => basename(f.path).toLowerCase() === required)) {
      findings.push({
        severity: "error",
        ruleId: "TOC008",
        message: `Missing support file ${required}.`,
        suggestion: `Add ${required} to the source package.`,
      });
    }
  }

  if (!mainTex && texFiles.length === 0) {
    findings.push({
      severity: "error",
      ruleId: "TOC009",
      message: "No .tex source file was found.",
    });
  }

  return findings;
}

function ruleMainDocumentShape({ mainTex }: RuleContext): Finding[] {
  if (!mainTex?.text) return [];
  const clean = stripCommentsKeepLines(mainTex.text);
  const findings: Finding[] = [];

  const docclass = /\\documentclass(?:\[[^\]]*\])?\s*\{([^}]+)\}/.exec(clean);
  if (!docclass) {
    findings.push({
      severity: "error",
      ruleId: "TOC010",
      file: mainTex.path,
      message: "Missing \\documentclass{toc}.",
    });
  } else if (docclass[1].trim() !== "toc") {
    const pos = lineColAtOffset(clean, docclass.index);
    findings.push({
      severity: "error",
      ruleId: "TOC011",
      file: mainTex.path,
      ...pos,
      message: "The main file does not use the ToC document class.",
      evidence: docclass[0],
      suggestion: "Use \\documentclass{toc}.",
    });
  }

  const beginDocument = /\\begin\s*\{document\}/.exec(clean);
  const endDocument = /\\end\s*\{document\}/.exec(clean);
  if (!beginDocument) {
    findings.push({ severity: "error", ruleId: "TOC012", file: mainTex.path, message: "Missing \\begin{document}." });
  }
  if (!endDocument) {
    findings.push({ severity: "error", ruleId: "TOC013", file: mainTex.path, message: "Missing \\end{document}." });
  }

  return findings;
}

function ruleTocDetails({ mainTex }: RuleContext): Finding[] {
  if (!mainTex?.text) return [];
  const clean = stripCommentsKeepLines(mainTex.text);
  const findings: Finding[] = [];
  const blocks = findCommandArgs(clean, "\\tocdetails");

  if (blocks.length === 0) {
    return [
      {
        severity: "error",
        ruleId: "TOC014",
        file: mainTex.path,
        message: "Missing \\tocdetails{...} before \\begin{document}.",
      },
    ];
  }

  if (blocks.length > 1) {
    for (const [i, block] of blocks.slice(1).entries()) {
      const pos = lineColAtOffset(clean, block.match.index ?? 0);
      findings.push({
        severity: "error",
        ruleId: "TOC015",
        file: mainTex.path,
        ...pos,
        message: `Duplicate \\tocdetails block #${i + 2}.`,
        evidence: clean.slice(block.match.index ?? 0, Math.min(block.close + 1, (block.match.index ?? 0) + 120)),
        suggestion: "Keep exactly one populated \\tocdetails block.",
      });
    }
  }

  const first = blocks[0];
  const beginDocument = /\\begin\s*\{document\}/.exec(clean);
  if (beginDocument && first.match.index !== undefined && first.match.index > beginDocument.index) {
    const pos = lineColAtOffset(clean, first.match.index);
    findings.push({
      severity: "error",
      ruleId: "TOC016",
      file: mainTex.path,
      ...pos,
      message: "\\tocdetails appears after \\begin{document}.",
      suggestion: "Move \\tocdetails to the preamble.",
    });
  }

  const keyValues = parseTopLevelKeyValues(first.value);
  const map = new Map(keyValues.map((kv) => [kv.key, kv]));
  const requiredKeys = [
    "title",
    "number_of_pages",
    "number_of_bibitems",
    "number_of_figures",
    "conference_version",
    "author",
    "authorlist",
    "acmclassification",
    "amsclassification",
    "keywords",
  ];

  for (const key of requiredKeys) {
    const kv = map.get(key);
    if (!kv || kv.value.trim() === "") {
      const pos = lineColAtOffset(clean, first.match.index ?? 0);
      findings.push({
        severity: "error",
        ruleId: "TOC017",
        file: mainTex.path,
        ...pos,
        message: `\\tocdetails is missing required key \`${key}\`.`,
      });
    }
  }

  for (const kv of keyValues) {
    const value = kv.value.trim().replace(/[{}]/g, "");
    const looksPlaceholder = placeholderValues.has(value) || /^(X+N+|N+|TBD|TODO|\?\?\?)$/i.test(value);
    if (looksPlaceholder) {
      const pos = lineColAtOffset(clean, first.open + 1 + kv.valueOffset);
      findings.push({
        severity: "warning",
        ruleId: "TOC018",
        file: mainTex.path,
        ...pos,
        message: `Placeholder value in \\tocdetails for \`${kv.key}\`.`,
        evidence: kv.value,
        suggestion: "Replace this placeholder with the final value.",
      });
    }
  }

  return findings;
}

function ruleFrontmatter({ mainTex }: RuleContext): Finding[] {
  if (!mainTex?.text) return [];
  const clean = stripCommentsKeepLines(mainTex.text);
  const findings: Finding[] = [];
  const beginDocument = /\\begin\s*\{document\}/.exec(clean);
  const beginFrontmatter = /\\begin\s*\{frontmatter\}/.exec(clean);
  const endFrontmatter = /\\end\s*\{frontmatter\}/.exec(clean);

  if (!beginFrontmatter) {
    findings.push({ severity: "error", ruleId: "TOC019", file: mainTex.path, message: "Missing frontmatter environment." });
    return findings;
  }

  if (!endFrontmatter) {
    findings.push({ severity: "error", ruleId: "TOC020", file: mainTex.path, message: "Missing \\end{frontmatter}." });
  }

  if (beginDocument && beginFrontmatter.index < beginDocument.index) {
    const pos = lineColAtOffset(clean, beginFrontmatter.index);
    findings.push({
      severity: "error",
      ruleId: "TOC021",
      file: mainTex.path,
      ...pos,
      message: "frontmatter appears before \\begin{document}.",
    });
  }

  if (beginDocument && beginFrontmatter.index > beginDocument.index) {
    const between = clean.slice(beginDocument.index + beginDocument[0].length, beginFrontmatter.index).replace(/\s/g, "");
    if (between.length > 0) {
      const pos = lineColAtOffset(clean, beginFrontmatter.index);
      findings.push({
        severity: "warning",
        ruleId: "TOC022",
        file: mainTex.path,
        ...pos,
        message: "frontmatter is not immediately after \\begin{document}.",
      });
    }
  }

  const abstractStart = /\\begin\s*\{abstract\}/.exec(clean);
  const abstractEnd = /\\end\s*\{abstract\}/.exec(clean);
  if (!abstractStart || !abstractEnd) {
    findings.push({ severity: "error", ruleId: "TOC023", file: mainTex.path, message: "Missing abstract environment." });
    return findings;
  }

  if (abstractStart.index < beginFrontmatter.index || (endFrontmatter && abstractEnd.index > endFrontmatter.index)) {
    const pos = lineColAtOffset(clean, abstractStart.index);
    findings.push({
      severity: "error",
      ruleId: "TOC024",
      file: mainTex.path,
      ...pos,
      message: "The abstract should be inside the frontmatter environment.",
    });
  }

  const abstract = clean.slice(abstractStart.index, abstractEnd.index);
  for (const match of abstract.matchAll(/\\(?:cite|citep|citet|ref|prettyref|expref|eqref)\b/g)) {
    const offset = abstractStart.index + (match.index ?? 0);
    const pos = lineColAtOffset(clean, offset);
    findings.push({
      severity: "warning",
      ruleId: "TOC025",
      file: mainTex.path,
      ...pos,
      message: "The abstract contains a citation/reference command.",
      evidence: match[0],
      suggestion: "Make the abstract self-contained; if a citation is necessary, cite in prose rather than by number.",
    });
  }

  return findings;
}

function ruleForbiddenMacros({ project }: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const file of project.files.filter((f) => f.text !== undefined && /\.(tex|sty)$/i.test(f.path))) {
    const clean = stripCommentsKeepLines(file.text ?? "");
    for (const match of clean.matchAll(/\\def\b/g)) {
      const pos = lineColAtOffset(clean, match.index ?? 0);
      findings.push({
        severity: "error",
        ruleId: "TOC026",
        file: file.path,
        ...pos,
        message: "Do not use \\def.",
        evidence: "\\def",
        suggestion: "Use \\newcommand, \\DeclareMathOperator, or another explicit LaTeX declaration instead.",
      });
    }

    for (const match of clean.matchAll(/\\renewcommand\b/g)) {
      const pos = lineColAtOffset(clean, match.index ?? 0);
      findings.push({
        severity: "warning",
        ruleId: "TOC027",
        file: file.path,
        ...pos,
        message: "Avoid \\renewcommand in ToC submissions unless explicitly approved.",
        evidence: "\\renewcommand",
      });
    }
  }
  return findings;
}

function ruleDeadTextMarkers({ project }: RuleContext): Finding[] {
  const findings: Finding[] = [];
  const patterns: Array<{ regex: RegExp; message: string }> = [
    { regex: /\\iffalse\b/g, message: "Dead source block using \\iffalse remains in the file." },
    { regex: /\\begin\s*\{comment\}/g, message: "Dead source block using the comment environment remains in the file." },
    { regex: /\\ignore\s*\{/g, message: "Possible dead source block using \\ignore{...}." },
    { regex: /\b(?:TODO|FIXME)\b/gi, message: "TODO/FIXME marker remains in the source." },
  ];

  for (const file of project.files.filter((f) => f.text !== undefined && /\.(tex|sty|bib)$/i.test(f.path))) {
    const clean = stripCommentsKeepLines(file.text ?? "");
    for (const { regex, message } of patterns) {
      for (const match of clean.matchAll(regex)) {
        const pos = lineColAtOffset(clean, match.index ?? 0);
        findings.push({
          severity: "warning",
          ruleId: "TOC028",
          file: file.path,
          ...pos,
          message,
          evidence: clean.slice(match.index ?? 0, (match.index ?? 0) + 80).trim(),
        });
      }
    }
  }
  return findings;
}

function ruleBibliography({ mainTex, project }: RuleContext): Finding[] {
  if (!mainTex?.text) return [];
  const clean = stripCommentsKeepLines(mainTex.text);
  const findings: Finding[] = [];

  if (!/\\bibliographystyle\s*\{tocplain\}/.test(clean)) {
    findings.push({
      severity: "error",
      ruleId: "TOC029",
      file: mainTex.path,
      message: "Missing \\bibliographystyle{tocplain}.",
    });
  }

  const bibCommands = findCommandArgs(clean, "\\bibliography");
  if (bibCommands.length === 0) {
    findings.push({ severity: "error", ruleId: "TOC030", file: mainTex.path, message: "Missing \\bibliography{...}." });
    return findings;
  }

  for (const cmd of bibCommands) {
    const bibNames = cmd.value.split(",").map((x) => x.trim()).filter(Boolean);
    for (const bibName of bibNames) {
      const expected = bibName.toLowerCase().endsWith(".bib") ? bibName : `${bibName}.bib`;
      if (!fileExists(project, mainTex.path, expected)) {
        const pos = lineColAtOffset(clean, cmd.match.index ?? 0);
        findings.push({
          severity: "error",
          ruleId: "TOC031",
          file: mainTex.path,
          ...pos,
          message: `Bibliography file \`${expected}\` is referenced but was not found in the upload.`,
          evidence: `\\bibliography{${cmd.value}}`,
        });
      }
    }
  }

  const bibliographyIndex = bibCommands[0].match.index ?? 0;
  const appendix = /\\appendix\b|\\begin\s*\{appendix\}/.exec(clean);
  if (appendix && appendix.index > bibliographyIndex) {
    const pos = lineColAtOffset(clean, appendix.index);
    findings.push({
      severity: "warning",
      ruleId: "TOC032",
      file: mainTex.path,
      ...pos,
      message: "An appendix appears after the bibliography.",
      suggestion: "Move appendices before acknowledgments and bibliography, or remove them if not necessary.",
    });
  }

  return findings;
}

function ruleInputFiles({ mainTex, project }: RuleContext): Finding[] {
  if (!mainTex?.text) return [];
  const clean = stripCommentsKeepLines(mainTex.text);
  const findings: Finding[] = [];

  for (const command of ["\\input", "\\include"]) {
    for (const cmd of findCommandArgs(clean, command)) {
      const requested = cmd.value.trim();
      if (requested.startsWith("|") || requested === "") continue;
      if (!fileExists(project, mainTex.path, requested)) {
        const pos = lineColAtOffset(clean, cmd.match.index ?? 0);
        findings.push({
          severity: "error",
          ruleId: "TOC033",
          file: mainTex.path,
          ...pos,
          message: `Referenced input file \`${requested}\` was not found in the upload.`,
          evidence: `${command}{${requested}}`,
        });
      }
    }
  }

  return findings;
}

function ruleReferences({ project }: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const file of project.files.filter((f) => f.text !== undefined && f.lowerPath.endsWith(".tex"))) {
    const clean = stripCommentsKeepLines(file.text ?? "");
    for (const match of clean.matchAll(/\\ref\s*\{([^}]+)\}/g)) {
      const start = match.index ?? 0;
      const lineStart = clean.lastIndexOf("\n", start) + 1;
      const lineEndRaw = clean.indexOf("\n", start);
      const lineEnd = lineEndRaw >= 0 ? lineEndRaw : clean.length;
      const line = clean.slice(lineStart, lineEnd);
      if (/\\newrefformat\b/.test(line)) continue;

      const pos = lineColAtOffset(clean, start);
      findings.push({
        severity: "warning",
        ruleId: "TOC034",
        file: file.path,
        ...pos,
        message: "Direct \\ref found.",
        evidence: match[0],
        suggestion: "Use an explicit reference macro such as \\expref or \\prettyref for named objects; equations are the main exception.",
      });
    }
  }
  return findings;
}

function ruleGraphics({ project }: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const file of project.files.filter((f) => f.text !== undefined && f.lowerPath.endsWith(".tex"))) {
    const clean = stripCommentsKeepLines(file.text ?? "");
    for (const cmd of findCommandArgs(clean, "\\includegraphics")) {
      const requested = cmd.value.trim();
      const found = findGraphic(project, file.path, requested);
      const pos = lineColAtOffset(clean, cmd.match.index ?? 0);

      if (!found) {
        findings.push({
          severity: "error",
          ruleId: "TOC035",
          file: file.path,
          ...pos,
          message: `Graphic file \`${requested}\` was not found in the upload.`,
          evidence: `\\includegraphics{${requested}}`,
        });
      } else if (![".pdf", ""].includes(fileExtension(found.path))) {
        findings.push({
          severity: "warning",
          ruleId: "TOC036",
          file: file.path,
          ...pos,
          message: `Graphic \`${found.path}\` is not a PDF.`,
          suggestion: "For pdflatex copy-editing, vector PDF figures are usually preferable when possible.",
        });
      }
    }
  }
  return findings;
}

function ruleAuthorConsistency({ mainTex }: RuleContext): Finding[] {
  if (!mainTex?.text) return [];
  const clean = stripCommentsKeepLines(mainTex.text);
  const findings: Finding[] = [];
  const detailBlocks = findCommandArgs(clean, "\\tocdetails");
  const detailMap = detailBlocks[0] ? new Map(parseTopLevelKeyValues(detailBlocks[0].value).map((kv) => [kv.key, kv.value])) : new Map();

  const frontmatterAuthors: string[] = [];
  for (const match of clean.matchAll(/\\author(?:\s*\[[^\]]*\])?\s*\{/g)) {
    const open = clean.indexOf("{", match.index ?? 0);
    const close = open >= 0 ? findMatchingBrace(clean, open) : undefined;
    if (open >= 0 && close !== undefined) {
      frontmatterAuthors.push(normalizeLatexText(clean.slice(open + 1, close)));
    }
  }

  const detailsAuthors = splitAuthorList(detailMap.get("author") ?? "");
  if (detailsAuthors.length > 0 && frontmatterAuthors.length > 0) {
    const missing = detailsAuthors.filter((a) => !frontmatterAuthors.includes(a));
    const extra = frontmatterAuthors.filter((a) => !detailsAuthors.includes(a));
    if (missing.length > 0 || extra.length > 0) {
      const authorIndex = clean.search(/\\author(?:\s*\[[^\]]*\])?\s*\{/);
      const pos = lineColAtOffset(clean, authorIndex >= 0 ? authorIndex : 0);
      findings.push({
        severity: "warning",
        ruleId: "TOC037",
        file: mainTex.path,
        ...pos,
        message: "Author names in frontmatter do not exactly match the author field in \\tocdetails.",
        evidence: `tocdetails=[${detailsAuthors.join("; ")}], frontmatter=[${frontmatterAuthors.join("; ")}]`,
        suggestion: "Check for spelling differences and author-order mismatches.",
      });
    }
  }

  const infoLabels = [...clean.matchAll(/\\begin\s*\{tocinfo\}\s*\[([^\]]+)\]/g)].map((m) => ({ label: m[1], index: m.index ?? 0 }));
  const aboutLabels = [...clean.matchAll(/\\begin\s*\{tocabout\}\s*\[([^\]]+)\]/g)].map((m) => ({ label: m[1], index: m.index ?? 0 }));
  const authorLabels = [...clean.matchAll(/\\author\s*\[([^\]]+)\]/g)].map((m) => ({ label: m[1], index: m.index ?? 0 }));

  const expected = new Set([...authorLabels, ...infoLabels].map((x) => x.label));
  for (const about of aboutLabels) {
    if (!expected.has(about.label)) {
      const pos = lineColAtOffset(clean, about.index);
      findings.push({
        severity: "error",
        ruleId: "TOC038",
        file: mainTex.path,
        ...pos,
        message: `tocabout label \`${about.label}\` does not match any author/tocinfo label.`,
        evidence: `\\begin{tocabout}[${about.label}]`,
        suggestion: "Use the same label in \\author[...], \\begin{tocinfo}[...], and \\begin{tocabout}[...].",
      });
    }
  }

  const aboutSet = new Set(aboutLabels.map((x) => x.label));
  for (const info of infoLabels) {
    if (!aboutSet.has(info.label)) {
      const pos = lineColAtOffset(clean, info.index);
      findings.push({
        severity: "error",
        ruleId: "TOC039",
        file: mainTex.path,
        ...pos,
        message: `tocinfo label \`${info.label}\` has no matching tocabout block.`,
        suggestion: "Add a matching \\begin{tocabout}[...] block or fix the misspelled label.",
      });
    }
  }

  return findings;
}

function findGraphic(project: Project, relativeTo: string, requested: string): ProjectFile | undefined {
  const raw = requested.replace(/^\s*\[[^\]]*\]\s*/, "").trim();
  if (raw === "") return undefined;

  if (/\.[A-Za-z0-9]+$/.test(raw)) {
    return findFile(project, relativeTo, raw);
  }

  for (const extension of [".pdf", ".png", ".jpg", ".jpeg", ".eps"]) {
    const found = findFile(project, relativeTo, raw + extension);
    if (found) return found;
  }

  return undefined;
}

function compareFindings(a: Finding, b: Finding): number {
  const severityOrder = { error: 0, warning: 1, info: 2 } as const;
  if (severityOrder[a.severity] !== severityOrder[b.severity]) {
    return severityOrder[a.severity] - severityOrder[b.severity];
  }
  if ((a.file ?? "") !== (b.file ?? "")) return (a.file ?? "").localeCompare(b.file ?? "");
  return (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0) || a.ruleId.localeCompare(b.ruleId);
}

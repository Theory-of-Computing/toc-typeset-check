export type Severity = "error" | "warning" | "info";

export type ProjectFile = {
  path: string;
  name: string;
  lowerPath: string;
  size: number;
  text?: string;
  bytes?: Uint8Array;
};

export type Project = {
  rootName: string;
  files: ProjectFile[];
  // Paths of system-generated entries (e.g. __MACOSX/, .DS_Store) that were
  // excluded from `files` and should be reported for removal.
  ignoredSystemPaths?: string[];
  // True when the upload was a bare .tex file rather than a source package, so
  // companion files (.bib, packages.sty, figures, \input targets) cannot be
  // present. Checks that a file is missing from the package are skipped.
  singleFile?: boolean;
};

export type Finding = {
  severity: Severity;
  ruleId: string;
  file?: string;
  line?: number;
  column?: number;
  message: string;
  evidence?: string;
  suggestion?: string;
};

export type RuleContext = {
  project: Project;
  mainTex?: ProjectFile;
  // Canonical ToC distribution files (lowercased basename -> normalized
  // content), from unzipping toctex.zip. Empty if the zip could not be loaded.
  journalFiles: Map<string, string>;
};

export type Rule = (ctx: RuleContext) => Finding[];

// ── Fix types ──────────────────────────────────────────────────────────────

export type FixTier =
  | "hard-stop"   // cannot be fixed even interactively
  | "auto"        // proposed diff, user confirms
  | "interactive"; // needs a value or choice from the user before a diff can be shown

/** A text patch: replace `length` chars at `offset` in file `file`. */
export type TextFix = {
  kind: "text";
  file: string;
  offset: number;
  length: number;
  oldText: string;  // for display
  newText: string;
};

/** Swap an entire file's content (e.g. restore a modified journal file). */
export type FileReplaceFix = {
  kind: "file-replace";
  file: string;
  newContent: string;
};

/** Remove a file from the output archive. */
export type FileDeleteFix = {
  kind: "file-delete";
  file: string;
};

export type Fix = TextFix | FileReplaceFix | FileDeleteFix;

export type FixProposal = {
  finding: Finding;
  tier: FixTier;
  /** Populated for "auto" tier. Usually one entry; multi-file deletes have several. */
  fixes?: Fix[];
};

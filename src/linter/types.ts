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

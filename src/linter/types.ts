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

import type { Finding, Project } from "./types";
import { findMainTex } from "./project";
import { runRules } from "./rules";

export function lintProject(
  project: Project,
  journalFiles: Map<string, string> = new Map(),
): { mainTexPath?: string; findings: Finding[] } {
  const mainTex = findMainTex(project);
  const findings = runRules({ project, mainTex, journalFiles });
  return { mainTexPath: mainTex?.path, findings };
}

export function summarizeFindings(findings: Finding[]): { errors: number; warnings: number; infos: number } {
  return {
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    infos: findings.filter((f) => f.severity === "info").length,
  };
}

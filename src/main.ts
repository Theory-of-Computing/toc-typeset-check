import "./style.css";
import { readUpload } from "./linter/project";
import { lintProject, summarizeFindings } from "./linter/run";
import type { Finding } from "./linter/types";

const input = document.querySelector<HTMLInputElement>("#file-input");
const summary = document.querySelector<HTMLElement>("#summary");
const results = document.querySelector<HTMLElement>("#results");

if (!input || !summary || !results) {
  throw new Error("Missing required DOM elements.");
}

const summaryEl = summary;
const resultsEl = results;

input.addEventListener("change", async () => {
  const file = input.files?.[0];
  if (!file) return;

  summaryEl.classList.remove("hidden");
  resultsEl.classList.remove("hidden");
  summaryEl.innerHTML = "Reading file locally…";
  resultsEl.innerHTML = "";

  try {
    const project = await readUpload(file);
    const { mainTexPath, findings } = lintProject(project);
    renderSummary(file.name, project.files.length, mainTexPath, findings);
    renderFindings(findings);
  } catch (error) {
    summaryEl.innerHTML = `<p><strong>Error:</strong> ${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
    results.innerHTML = "";
  }
});

function renderSummary(fileName: string, fileCount: number, mainTexPath: string | undefined, findings: Finding[]): void {
  const counts = summarizeFindings(findings);
  summaryEl.innerHTML = `
    <h2>Summary</h2>
    <p><strong>Upload:</strong> ${escapeHtml(fileName)}</p>
    <p><strong>Files read:</strong> ${fileCount}</p>
    <p><strong>Main TeX:</strong> ${mainTexPath ? escapeHtml(mainTexPath) : "not found"}</p>
    <div class="counts">
      <span class="badge error">${counts.errors} errors</span>
      <span class="badge warning">${counts.warnings} warnings</span>
      <span class="badge info">${counts.infos} info</span>
    </div>
  `;
}

function renderFindings(findings: Finding[]): void {
  if (findings.length === 0) {
    resultsEl.innerHTML = `
      <h2>Findings</h2>
      <p>No findings from the MVP rules. This is not a proof of full ToC compliance.</p>
    `;
    return;
  }

  resultsEl.innerHTML = `
    <h2>Findings</h2>
    ${findings.map(renderFinding).join("")}
  `;
}

function renderFinding(finding: Finding): string {
  const location = finding.file
    ? `${finding.file}${finding.line ? `:${finding.line}${finding.column ? `:${finding.column}` : ""}` : ""}`
    : "project";

  return `
    <article class="finding">
      <div class="finding-header">
        <span class="severity ${finding.severity}">${finding.severity}</span>
        <span class="rule">${escapeHtml(finding.ruleId)}</span>
        <span class="location">${escapeHtml(location)}</span>
      </div>
      <p class="message">${escapeHtml(finding.message)}</p>
      ${finding.evidence ? `<pre>${escapeHtml(finding.evidence)}</pre>` : ""}
      ${finding.suggestion ? `<p class="suggestion"><strong>Suggestion:</strong> ${escapeHtml(finding.suggestion)}</p>` : ""}
    </article>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

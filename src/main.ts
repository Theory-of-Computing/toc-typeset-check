/// <reference types="vite/client" />
import "./style.css";
import { readUpload } from "./linter/project";
import { lintProject, summarizeFindings } from "./linter/run";
import { loadToctex } from "./linter/toctex";
import type { Finding } from "./linter/types";

// toctex.zip is served from the app's own origin (see public/). It is fetched
// and unzipped in the browser, then used for the journal-file checks.
const TOCTEX_URL = `${import.meta.env.BASE_URL}toctex.zip`;

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

    let journalFiles = new Map<string, string>();
    let toctexNote = "";
    try {
      journalFiles = await loadToctex(TOCTEX_URL);
    } catch {
      toctexNote = "Could not load the ToC distribution (toctex.zip); journal-file checks were skipped.";
    }

    const { mainTexPath, findings } = lintProject(project, journalFiles);
    renderSummary(file.name, project.files.length, mainTexPath, findings, toctexNote);
    renderFindings(findings);
  } catch (error) {
    summaryEl.innerHTML = `<p><strong>Error:</strong> ${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
    results.innerHTML = "";
  }
});

function renderSummary(
  fileName: string,
  fileCount: number,
  mainTexPath: string | undefined,
  findings: Finding[],
  toctexNote: string,
): void {
  const counts = summarizeFindings(findings);
  const badges = (
    [
      ["error", counts.errors, "errors"],
      ["warning", counts.warnings, "warnings"],
      ["info", counts.infos, "info"],
    ] as const
  )
    .filter(([, count]) => count > 0)
    .map(([severity, count, label]) => `<span class="badge ${severity}">${count} ${label}</span>`)
    .join("");
  const countsHtml = badges
    ? `<div class="counts">${badges}</div>`
    : `<div class="counts"><span class="badge ok">No issues found</span></div>`;
  summaryEl.innerHTML = `
    <h2>Summary</h2>
    <p><strong>Upload:</strong> ${escapeHtml(fileName)}</p>
    <p><strong>Files read:</strong> ${fileCount}</p>
    <p><strong>Main TeX:</strong> ${mainTexPath ? escapeHtml(mainTexPath) : "not found"}</p>
    ${countsHtml}
    ${toctexNote ? `<p class="notice">${escapeHtml(toctexNote)}</p>` : ""}
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

  // Group by rule ID, preserving the (severity-sorted) order of first
  // appearance. Each rule ID maps to a single severity, so this keeps errors
  // ahead of warnings ahead of info.
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const group = groups.get(finding.ruleId);
    if (group) group.push(finding);
    else groups.set(finding.ruleId, [finding]);
  }

  resultsEl.innerHTML = `
    <h2>Findings</h2>
    ${[...groups.values()].map(renderGroup).join("")}
  `;
}

function renderGroup(group: Finding[]): string {
  const [first, ...rest] = group;
  if (rest.length === 0) return renderFinding(first);

  const label = `Show ${rest.length} more occurrence${rest.length === 1 ? "" : "s"} of ${escapeHtml(first.ruleId)}`;
  return `
    ${renderFinding(first)}
    <details class="more-findings">
      <summary>${label}</summary>
      ${rest.map(renderFinding).join("")}
    </details>
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

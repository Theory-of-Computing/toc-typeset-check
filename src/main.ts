/// <reference types="vite/client" />
declare const __BUILD_DATE__: string;
import "./style.css";
import JSZip from "jszip";
import { readUpload } from "./linter/project";
import { lintProject, summarizeFindings } from "./linter/run";
import { loadToctex } from "./linter/toctex";
import { buildProposals } from "./linter/fixes";
import { applyFixes } from "./linter/apply";
import type { Finding, Project, FixProposal, TextFix, FileDeleteFix, FileReplaceFix } from "./linter/types";

const TOCTEX_URL = `${import.meta.env.BASE_URL}toctex.zip`;

const inputRaw = document.querySelector<HTMLInputElement>("#file-input");
const summaryRaw = document.querySelector<HTMLElement>("#summary");
const resultsRaw = document.querySelector<HTMLElement>("#results");
const fixSessionRaw = document.querySelector<HTMLElement>("#fix-session");

if (!inputRaw || !summaryRaw || !resultsRaw || !fixSessionRaw) {
  throw new Error("Missing required DOM elements.");
}

const input = inputRaw;
const summaryEl = summaryRaw;
const resultsEl = resultsRaw;
const fixSessionEl = fixSessionRaw;

const buildDateEl = document.querySelector<HTMLElement>("#build-date");
if (buildDateEl) buildDateEl.textContent = __BUILD_DATE__;

// ── session state ─────────────────────────────────────────────────────────────

let currentFile: File | null = null;
let currentProject: Project | null = null;
let currentJournalFiles: Map<string, string> = new Map();

interface FixState {
  fixable: FixProposal[];       // auto + interactive, in presentation order
  hardStops: FixProposal[];
  index: number;                // current position in fixable[]
  decisions: Map<number, boolean>; // index → true (accepted) / false (rejected)
  skippedRules: Set<string>;
}
let fixState: FixState | null = null;

// ── upload ────────────────────────────────────────────────────────────────────

input.addEventListener("change", async () => {
  const file = input.files?.[0];
  if (!file) return;

  currentFile = file;
  currentProject = null;
  fixState = null;
  fixSessionEl.classList.add("hidden");
  fixSessionEl.innerHTML = "";

  summaryEl.classList.remove("hidden");
  resultsEl.classList.remove("hidden");
  summaryEl.innerHTML = "Reading file locally…";
  resultsEl.innerHTML = "";

  try {
    const project = await readUpload(file);
    currentProject = project;

    let journalFiles = new Map<string, string>();
    let toctexNote = "";
    try {
      journalFiles = await loadToctex(TOCTEX_URL);
    } catch {
      toctexNote =
        "Could not load the ToC distribution (toctex.zip); journal-file checks were skipped.";
    }
    currentJournalFiles = journalFiles;

    const { mainTexPath, findings } = lintProject(project, journalFiles);
    renderSummary(file.name, project.files.length, mainTexPath, findings, toctexNote);
    renderFindings(findings);
    document.getElementById("btn-start-fix")?.addEventListener("click", startFixSession);
  } catch (error) {
    summaryEl.innerHTML = `<p><strong>Error:</strong> ${escapeHtml(
      error instanceof Error ? error.message : String(error),
    )}</p>`;
    resultsEl.innerHTML = "";
  }
});

// ── findings render ───────────────────────────────────────────────────────────

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
    .map(([sev, count, label]) => `<span class="badge ${sev}">${count} ${label}</span>`)
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
    ${findings.length > 0 ? `
      <div class="fix-launch">
        <button id="btn-start-fix" class="btn-start-fix">Fix issues →</button>
        <p class="fix-experimental">Experimental — proposed changes are shown for review before anything is applied.</p>
      </div>` : ""}
  `;
}

function renderFindings(findings: Finding[]): void {
  if (findings.length === 0) {
    resultsEl.innerHTML = `
      <h2>Findings</h2>
      <p>No findings from the current rules. This is not a proof of full ToC compliance.</p>
    `;
    return;
  }

  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const grp = groups.get(finding.ruleId);
    if (grp) grp.push(finding);
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

// ── fix session ───────────────────────────────────────────────────────────────

function startFixSession(): void {
  if (!currentProject) return;

  const { findings } = lintProject(currentProject, currentJournalFiles);
  const proposals = buildProposals(findings, currentProject, currentJournalFiles);

  const hardStops = proposals.filter((p) => p.tier === "hard-stop");
  const fixable = proposals.filter((p) => p.tier !== "hard-stop");

  fixState = {
    fixable,
    hardStops,
    index: 0,
    decisions: new Map(),
    skippedRules: new Set(),
  };

  resultsEl.classList.add("hidden");
  fixSessionEl.classList.remove("hidden");
  renderFixLoop();
}

function renderFixLoop(): void {
  if (!fixState) return;

  const { fixable, hardStops } = fixState;

  // Skip proposals that already have a decision (e.g. from "Accept all TOC034")
  // or whose rule was bulk-skipped.
  while (fixState.index < fixable.length) {
    if (fixState.decisions.has(fixState.index)) {
      fixState.index++;
      continue;
    }
    if (fixState.skippedRules.has(fixable[fixState.index].finding.ruleId)) {
      fixState.decisions.set(fixState.index, false);
      fixState.index++;
      continue;
    }
    break;
  }

  if (fixState.index >= fixable.length) {
    showCompletion();
    return;
  }

  const current = fixable[fixState.index];
  const total = fixable.length;
  const done = fixState.index;
  const pct = Math.round((done / total) * 100);

  fixSessionEl.innerHTML = `
    <div class="fix-progress">
      <span>Proposal ${done + 1} of ${total}</span>
      <div class="fix-progress-bar">
        <div class="fix-progress-fill" style="width:${pct}%"></div>
      </div>
    </div>

    ${hardStops.length > 0 ? renderHardStopsPanel(hardStops) : ""}

    ${renderProposalCard(current)}
  `;

  // Wire buttons
  document.getElementById("btn-accept")?.addEventListener("click", () => decide(true));
  document.getElementById("btn-reject")?.addEventListener("click", () => decide(false));
  document.getElementById("btn-accept-all")?.addEventListener("click", acceptAllRemaining);
  document.getElementById("btn-skip-rule")?.addEventListener("click", skipAllCurrentRule);
  document.getElementById("btn-continue")?.addEventListener("click", () => decide(undefined));
}

function renderHardStopsPanel(hardStops: FixProposal[]): string {
  return `
    <div class="hard-stops-panel">
      <h3>⚠ ${hardStops.length} issue${hardStops.length === 1 ? "" : "s"} require manual fixes</h3>
      ${hardStops
        .map(
          (p) => `
          <div class="hard-stop-item">
            <span class="severity ${p.finding.severity}">${p.finding.severity}</span>
            <span class="rule">${escapeHtml(p.finding.ruleId)}</span>
            <span>${escapeHtml(p.finding.message)}</span>
          </div>
        `,
        )
        .join("")}
    </div>
  `;
}

function renderProposalCard(proposal: FixProposal): string {
  const f = proposal.finding;
  const location = f.file
    ? `${f.file}${f.line ? `:${f.line}` : ""}`
    : "project";

  const isAuto = proposal.tier === "auto";
  const fixes = proposal.fixes ?? [];

  let body: string;
  if (isAuto && fixes.length === 0) {
    // e.g. TOC010 — system files already excluded, no explicit patch needed
    body = `
      <div class="interactive-notice" style="background:#f0fdf4;border-color:#bbf7d0;color:#166534;">
        ✓ No file changes needed — this is handled automatically when rebuilding the archive.
      </div>
      <div class="fix-actions">
        <button id="btn-continue" class="btn-continue">Continue →</button>
      </div>
    `;
  } else if (isAuto) {
    const anyAccepted = fixState
      ? [...fixState.decisions.entries()].some(([i, v]) => v && fixState!.fixable[i]?.finding.ruleId === f.ruleId)
      : false;
    body = `
      ${renderDiffs(fixes)}
      <div class="fix-actions">
        <button id="btn-accept" class="btn-accept">Accept</button>
        <button id="btn-reject" class="btn-reject">Reject</button>
        ${anyAccepted ? `<button id="btn-accept-all" class="btn-accept-all">Accept all ${escapeHtml(f.ruleId)}</button>` : ""}
        <button id="btn-skip-rule" class="btn-skip-rule">Skip all ${escapeHtml(f.ruleId)}</button>
      </div>
    `;
  } else {
    // interactive — no auto diff available yet
    body = `
      <div class="interactive-notice">
        This fix requires a manual edit in your source file.
        ${f.suggestion ? `<br><strong>Suggestion:</strong> ${escapeHtml(f.suggestion)}` : ""}
      </div>
      <div class="fix-actions">
        <button id="btn-continue" class="btn-continue">Continue →</button>
        <button id="btn-skip-rule" class="btn-skip-rule">Skip all ${escapeHtml(f.ruleId)}</button>
      </div>
    `;
  }

  return `
    <div class="fix-card">
      <div class="fix-card-header">
        <span class="severity ${f.severity}">${f.severity}</span>
        <span class="rule">${escapeHtml(f.ruleId)}</span>
        <span class="location">${escapeHtml(location)}</span>
      </div>
      <div class="fix-card-body">
        <p class="fix-card-message">${escapeHtml(f.message)}</p>
        ${body}
      </div>
    </div>
  `;
}

function renderDiffs(fixes: NonNullable<FixProposal["fixes"]>): string {
  return fixes
    .map((fix) => {
      if (fix.kind === "text") return renderTextDiff(fix as TextFix);
      if (fix.kind === "file-delete")
        return `<div class="diff-block"><div class="diff-file-action">🗑 Delete: ${escapeHtml((fix as FileDeleteFix).file)}</div></div>`;
      if (fix.kind === "file-replace")
        return `<div class="diff-block"><div class="diff-file-action">↩ Restore: ${escapeHtml((fix as FileReplaceFix).file)} (canonical version from toctex distribution)</div></div>`;
      return "";
    })
    .join("");
}

function renderTextDiff(fix: TextFix): string {
  const delLines = fix.oldText === "" ? [] : fix.oldText.split("\n");
  const addLines = fix.newText === "" ? [] : fix.newText.split("\n");
  const del = delLines.map((l) => `<div class="diff-del">- ${escapeHtml(l)}</div>`).join("");
  const add = addLines.map((l) => `<div class="diff-add">+ ${escapeHtml(l)}</div>`).join("");
  return `<div class="diff-block">${del}${add}</div>`;
}

// ── decision handlers ─────────────────────────────────────────────────────────

function decide(accepted: boolean | undefined): void {
  if (!fixState) return;
  if (accepted !== undefined) {
    fixState.decisions.set(fixState.index, accepted);
  }
  fixState.index++;
  renderFixLoop();
}

function skipAllCurrentRule(): void {
  if (!fixState) return;
  const ruleId = fixState.fixable[fixState.index]?.finding.ruleId;
  if (ruleId) fixState.skippedRules.add(ruleId);
  renderFixLoop();
}

function acceptAllRemaining(): void {
  if (!fixState) return;
  const ruleId = fixState.fixable[fixState.index]?.finding.ruleId;
  if (!ruleId) return;
  // Accept current + all remaining proposals with the same rule ID.
  for (let i = fixState.index; i < fixState.fixable.length; i++) {
    if (fixState.fixable[i].finding.ruleId === ruleId) {
      fixState.decisions.set(i, true);
    }
  }
  // Advance past the current proposal and continue the loop normally.
  fixState.index++;
  renderFixLoop();
}

// ── completion ────────────────────────────────────────────────────────────────

function showCompletion(): void {
  if (!fixState) return;

  const { fixable, hardStops, decisions } = fixState;

  let accepted = 0;
  let rejected = 0;
  for (const [, v] of decisions) {
    if (v) accepted++;
    else rejected++;
  }
  const skipped = fixable.length - decisions.size;

  fixSessionEl.innerHTML = `
    <div class="fix-complete">
      <h2>Fix session complete</h2>
      <div class="fix-complete-stats">
        <span class="badge ok">${accepted} accepted</span>
        <span class="badge">${rejected} rejected</span>
        ${skipped > 0 ? `<span class="badge info">${skipped} skipped</span>` : ""}
        ${hardStops.length > 0 ? `<span class="badge warning">${hardStops.length} need manual fixes</span>` : ""}
      </div>
      ${accepted > 0
        ? `<button id="btn-download" class="btn-download">⬇ Download fixed package</button>`
        : `<p>No changes were accepted — nothing to download.</p>`}
      <button id="btn-restart" class="btn-restart">← Back to findings</button>
      ${hardStops.length > 0 ? renderHardStopsPanel(hardStops) : ""}
    </div>
  `;

  document.getElementById("btn-download")?.addEventListener("click", downloadPatched);
  document.getElementById("btn-restart")?.addEventListener("click", () => {
    fixSessionEl.classList.add("hidden");
    resultsEl.classList.remove("hidden");
  });
}

// ── download ──────────────────────────────────────────────────────────────────

async function downloadPatched(): Promise<void> {
  if (!currentProject || !fixState || !currentFile) return;

  const btn = document.getElementById("btn-download") as HTMLButtonElement | null;
  if (btn) { btn.disabled = true; btn.textContent = "Building…"; }

  try {
    // Collect all accepted fixes
    const acceptedFixes = fixState.fixable
      .filter((_, i) => fixState!.decisions.get(i) === true)
      .flatMap((p) => p.fixes ?? []);

    const patches = applyFixes(currentProject, acceptedFixes);

    if (currentProject.singleFile) {
      const file = currentProject.files[0];
      const text = (patches.get(file.path) as string | undefined) ?? file.text ?? "";
      const blob = new Blob([text], { type: "text/plain" });
      triggerDownload(blob, file.name.replace(/\.tex$/i, "-fixed.tex"));
    } else {
      const zip = new JSZip();
      for (const f of currentProject.files) {
        const patch = patches.get(f.path);
        if (patch === null) continue; // deleted
        if (typeof patch === "string") {
          zip.file(f.path, patch);
        } else if (f.text !== undefined) {
          zip.file(f.path, f.text);
        } else if (f.bytes !== undefined) {
          zip.file(f.path, f.bytes);
        }
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const outName = currentFile.name.replace(/\.zip$/i, "-fixed.zip");
      triggerDownload(blob, outName);
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "⬇ Download fixed package"; }
  }
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ── shared ────────────────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

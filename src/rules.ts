import "./style.css";
import { ruleCatalog, allRuleDocs } from "./linter/catalog";
import type { RuleCategory, RuleDoc } from "./linter/catalog";

const container = document.querySelector<HTMLElement>("#catalog");
if (!container) {
  throw new Error("Missing #catalog element.");
}

const errorCount = allRuleDocs.filter((r) => r.severity === "error").length;
const warningCount = allRuleDocs.filter((r) => r.severity === "warning").length;

container.innerHTML = `
  <div class="counts">
    <span class="badge error">${errorCount} errors</span>
    <span class="badge warning">${warningCount} warnings</span>
    <span class="badge info">${allRuleDocs.length} total checks</span>
  </div>
  ${ruleCatalog.map(renderCategory).join("")}
`;

function renderCategory(category: RuleCategory): string {
  return `
    <section class="rule-category">
      <h2>${escapeHtml(category.title)}</h2>
      <p class="category-desc">${escapeHtml(category.description)}</p>
      ${category.rules.map(renderRule).join("")}
    </section>
  `;
}

function renderRule(rule: RuleDoc): string {
  return `
    <article class="finding">
      <div class="finding-header">
        <span class="severity ${rule.severity}">${rule.severity}</span>
        <span class="rule">${escapeHtml(rule.id)}</span>
      </div>
      <p class="message">${escapeHtml(rule.summary)}</p>
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

import type { Fix, TextFix, Project } from "./types";

/**
 * Apply a set of accepted fixes to a project.
 *
 * Returns a Map<filePath, string | null> for every file that changed:
 *   - string  → new text content
 *   - null    → file should be deleted from the output archive
 *
 * Files not present in the result are unchanged.
 */
export function applyFixes(project: Project, acceptedFixes: Fix[]): Map<string, string | null> {
  const result = new Map<string, string | null>();

  // Collect text fixes per file
  const textFixesByFile = new Map<string, TextFix[]>();
  for (const fix of acceptedFixes) {
    if (fix.kind === "text") {
      const list = textFixesByFile.get(fix.file) ?? [];
      list.push(fix);
      textFixesByFile.set(fix.file, list);
    }
  }

  // Apply text fixes
  for (const [filePath, fixes] of textFixesByFile) {
    const original = project.files.find((f) => f.path === filePath)?.text;
    if (original === undefined) continue;
    result.set(filePath, applyTextFixes(original, fixes));
  }

  // Apply file-replace fixes (overrides any text patches on the same file)
  for (const fix of acceptedFixes) {
    if (fix.kind === "file-replace") {
      result.set(fix.file, fix.newContent);
    }
  }

  // Apply file-delete fixes (overrides everything)
  for (const fix of acceptedFixes) {
    if (fix.kind === "file-delete") {
      result.set(fix.file, null);
    }
  }

  return result;
}

/**
 * Apply multiple non-overlapping text patches to `text`.
 *
 * Patches are applied back-to-front (sorted by offset descending) so that
 * applying an earlier patch doesn't shift the positions of later ones.
 * Overlapping patches are skipped with a console warning.
 */
export function applyTextFixes(text: string, fixes: TextFix[]): string {
  // Sort descending by offset so back-to-front application preserves positions
  const sorted = [...fixes].sort((a, b) => b.offset - a.offset);

  let result = text;
  let lastStart = Infinity;

  for (const fix of sorted) {
    const end = fix.offset + fix.length;

    // Skip if this fix overlaps with the one we just applied
    if (end > lastStart) {
      console.warn(
        `[apply] Skipping overlapping fix at offset ${fix.offset}–${end} ` +
          `(conflicts with patch starting at ${lastStart})`,
      );
      continue;
    }

    result = result.slice(0, fix.offset) + fix.newText + result.slice(fix.offset + fix.length);
    lastStart = fix.offset;
  }

  return result;
}

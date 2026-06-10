import JSZip from "jszip";

// Canonical ToC distribution files, keyed by lowercased basename ->
// normalized content. Built at runtime by unzipping toctex.zip.
export type JournalFiles = Map<string, string>;

// The journal supplies its typesetting files as .cls / .sty / .bst.
const JOURNAL_EXTENSIONS = new Set([".cls", ".sty", ".bst"]);

// Normalization used when comparing an uploaded journal file against the
// canonical distribution copy. We ignore differences that don't change the
// file's meaning: line endings, trailing whitespace on each line, and
// trailing blank lines. Anything beyond that counts as a change.
export function normalizeStyleSource(source: string): string {
  return source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n+$/g, "");
}

function extensionOf(name: string): string {
  const base = name.split("/").pop() ?? name;
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot).toLowerCase() : "";
}

// Unzip toctex.zip and return its journal-provided files. Works in the browser
// and in Node (tests/harness) since JSZip accepts ArrayBuffer or Uint8Array.
export async function parseToctexZip(data: ArrayBuffer | Uint8Array): Promise<JournalFiles> {
  const zip = await JSZip.loadAsync(data);
  const files: JournalFiles = new Map();
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    if (!JOURNAL_EXTENSIONS.has(extensionOf(entry.name))) continue;
    const name = (entry.name.split("/").pop() ?? entry.name).toLowerCase();
    files.set(name, normalizeStyleSource(await entry.async("string")));
  }
  return files;
}

// Fetch and unzip toctex.zip from the app's own origin. Cached so the zip is
// downloaded and parsed at most once per page load.
let cached: Promise<JournalFiles> | undefined;
export function loadToctex(url: string): Promise<JournalFiles> {
  if (!cached) {
    cached = fetch(url).then(async (res) => {
      if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`);
      return parseToctexZip(await res.arrayBuffer());
    });
  }
  return cached;
}

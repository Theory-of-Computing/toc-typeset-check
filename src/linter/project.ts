import JSZip from "jszip";
import type { Project, ProjectFile } from "./types";
import { stripCommentsKeepLines } from "./tex";

const TEXT_EXTENSIONS = new Set([".tex", ".sty", ".bib", ".cls", ".bst", ".txt", ".md"]);

// Folders and files added automatically by operating systems when zipping.
// They are not part of the source and should not be scanned or shipped.
const SYSTEM_FOLDERS = new Set([
  "__macosx", // macOS resource-fork sidecar folder
  ".spotlight-v100",
  ".trashes",
  ".fseventsd",
  ".temporaryitems",
  "$recycle.bin", // Windows
  "system volume information", // Windows
]);

const SYSTEM_FILENAMES = new Set([
  ".ds_store", // macOS Finder metadata
  "thumbs.db", // Windows thumbnail cache
  "desktop.ini", // Windows folder settings
  ".directory", // KDE (Linux) folder settings
]);

export function isSystemPath(path: string): boolean {
  const segments = path.split("/").filter(Boolean);
  if (segments.some((segment) => SYSTEM_FOLDERS.has(segment.toLowerCase()))) return true;
  const base = (segments[segments.length - 1] ?? "").toLowerCase();
  if (SYSTEM_FILENAMES.has(base)) return true;
  if (base.startsWith("._")) return true; // macOS AppleDouble resource forks
  return false;
}

// A short, deduplicatable label for a system artifact: the offending folder
// (e.g. "__MACOSX/") when the path is inside one, otherwise the file name.
export function systemArtifactLabel(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const folder = segments.find((segment) => SYSTEM_FOLDERS.has(segment.toLowerCase()));
  if (folder) return `${folder}/`;
  return segments[segments.length - 1] ?? path;
}

export async function readUpload(file: File): Promise<Project> {
  if (file.name.toLowerCase().endsWith(".zip")) {
    return readZipUpload(file);
  }

  const text = await file.text();
  return {
    rootName: file.name,
    singleFile: true,
    files: [
      {
        path: file.name,
        name: file.name,
        lowerPath: file.name.toLowerCase(),
        size: file.size,
        text,
      },
    ],
  };
}

export async function readZipUpload(file: File): Promise<Project> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const files: ProjectFile[] = [];
  const ignoredSystemPaths: string[] = [];

  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  for (const entry of entries) {
    if (isSystemPath(entry.name)) {
      ignoredSystemPaths.push(entry.name);
      continue;
    }
    const bytes = new Uint8Array(await entry.async("uint8array"));
    const lowerPath = entry.name.toLowerCase();
    const projectFile: ProjectFile = {
      path: entry.name,
      name: entry.name.split("/").pop() ?? entry.name,
      lowerPath,
      size: bytes.byteLength,
      bytes,
    };

    if (TEXT_EXTENSIONS.has(fileExtension(lowerPath))) {
      projectFile.text = decodeUtf8(bytes);
    }

    files.push(projectFile);
  }

  return { rootName: file.name, files, ignoredSystemPaths };
}

export function findMainTex(project: Project): ProjectFile | undefined {
  const texFiles = project.files.filter((f) => f.lowerPath.endsWith(".tex") && f.text !== undefined);
  const tocClassFiles = texFiles.filter((f) =>
    /\\documentclass(?:\[[^\]]*\])?\s*\{toc\}/.test(stripCommentsKeepLines(f.text ?? "")),
  );

  if (tocClassFiles.length > 0) return tocClassFiles[0];

  const documentFiles = texFiles.filter((f) => /\\begin\s*\{document\}/.test(stripCommentsKeepLines(f.text ?? "")));
  if (documentFiles.length > 0) return documentFiles[0];

  return texFiles.sort((a, b) => b.size - a.size)[0];
}

export function fileExists(project: Project, relativeTo: string, requestedPath: string): boolean {
  const candidates = candidatePaths(relativeTo, requestedPath);
  return project.files.some((file) => candidates.includes(file.lowerPath));
}

export function findFile(project: Project, relativeTo: string, requestedPath: string): ProjectFile | undefined {
  const candidates = candidatePaths(relativeTo, requestedPath);
  return project.files.find((file) => candidates.includes(file.lowerPath));
}

export function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

export function dirname(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

export function fileExtension(path: string): string {
  const name = basename(path.toLowerCase());
  if (name.endsWith(".synctex.gz")) return ".synctex.gz";
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot) : "";
}

function candidatePaths(relativeTo: string, requestedPath: string): string[] {
  const base = dirname(relativeTo);
  const raw = requestedPath.trim().replace(/\\/g, "/");
  const names = raw.toLowerCase().endsWith(".tex") || raw.includes(".") ? [raw] : [raw, `${raw}.tex`];
  const out = new Set<string>();
  for (const name of names) {
    out.add(normalizePath(name));
    out.add(normalizePath(base ? `${base}/${name}` : name));
  }
  return [...out];
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.toLowerCase().split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("latin1").decode(bytes);
  }
}

// Refresh the bundled copy of the ToC TeX distribution.
//
// Downloads toctex.zip and writes it to public/toctex.zip, where it is served
// from the app's own origin and unzipped in the browser at runtime. Updating
// to a new ToC release is just running this (or replacing the file by hand).
//
// Usage:
//   node scripts/update-toctex.mjs                       # download from the ToC site
//   node scripts/update-toctex.mjs /path/to/toctex.zip   # copy from a local file
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TOCTEX_URL = "https://theoryofcomputing.org/submit/toctex.zip";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const destDir = join(repoRoot, "public");
const dest = join(destDir, "toctex.zip");

const arg = process.argv[2];
let bytes;
if (arg && existsSync(arg)) {
  console.log(`Reading local zip: ${arg}`);
  bytes = readFileSync(arg);
} else {
  const url = arg ?? TOCTEX_URL;
  console.log(`Downloading: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  bytes = Buffer.from(await res.arrayBuffer());
}

mkdirSync(destDir, { recursive: true });
writeFileSync(dest, bytes);
console.log(`Wrote ${bytes.length} bytes to ${dest}`);

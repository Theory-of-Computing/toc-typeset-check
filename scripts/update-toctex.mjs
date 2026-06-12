// Refresh the bundled copies of the ToC author materials.
//
// Both assets come from the ToC submission site and are written to public/,
// where they are served from the app's own origin: toctex.zip is unzipped in
// the browser at runtime, and toc-template.tex is offered to authors as the
// starting point for a submission. Updating to a new ToC release is just
// running this (or replacing the files by hand).
//
// Usage:
//   node scripts/update-toctex.mjs                       # download both from the ToC site
//   node scripts/update-toctex.mjs /path/to/toctex.zip   # use a local toctex.zip; still fetch the template
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = "https://theoryofcomputing.org/submit";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const destDir = join(repoRoot, "public");

// An optional local path overrides only the toctex.zip download (its content
// can't be fetched offline); the template is always pulled from the site.
const localZip = process.argv[2];

const assets = [
  { name: "toctex.zip", url: `${BASE_URL}/toctex.zip`, local: localZip },
  { name: "toc-template.tex", url: `${BASE_URL}/toc-template.tex` },
];

mkdirSync(destDir, { recursive: true });

for (const asset of assets) {
  let bytes;
  if (asset.local && existsSync(asset.local)) {
    console.log(`Reading local file: ${asset.local}`);
    bytes = readFileSync(asset.local);
  } else {
    console.log(`Downloading: ${asset.url}`);
    const res = await fetch(asset.url);
    if (!res.ok) throw new Error(`Download failed for ${asset.url}: ${res.status} ${res.statusText}`);
    bytes = Buffer.from(await res.arrayBuffer());
  }
  const dest = join(destDir, asset.name);
  writeFileSync(dest, bytes);
  console.log(`Wrote ${bytes.length} bytes to ${dest}`);
}

import { resolve } from "node:path";
import { defineConfig } from "vite";

// Multi-page build: include both the checker (index.html) and the
// rules-reference page (rules.html) in the static output.
//
// The production site is served from a GitHub Pages project sub-path
// (https://theory-of-computing.github.io/toc-typeset-check/), so assets and the
// toctex.zip fetch (which uses import.meta.env.BASE_URL) must resolve under that
// base. Dev/preview stay at the root.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/toc-typeset-check/" : "/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        rules: resolve(__dirname, "rules.html"),
      },
    },
  },
}));

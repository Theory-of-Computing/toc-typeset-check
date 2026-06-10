import { resolve } from "node:path";
import { defineConfig } from "vite";

// Multi-page build: include both the checker (index.html) and the
// rules-reference page (rules.html) in the static output.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        rules: resolve(__dirname, "rules.html"),
      },
    },
  },
});

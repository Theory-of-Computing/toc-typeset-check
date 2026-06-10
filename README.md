# ToC Typeset Check

A client-side web app that checks Theory of Computing LaTeX submissions against the journal's copy-editing requirements and reports errors and warnings, all in the browser with no upload.

It reads either a single `.tex` file or a `.zip` source package in the browser, then runs deterministic checks and displays a log of errors and warnings. No file is uploaded to a server.

## Run locally

```bash
npm install
npm run dev
```

Then open the local Vite URL and upload a `.tex` file or a ZIP package.

## Build a static site

```bash
npm run build
```

The `dist/` directory is a static site. It can be deployed to GitHub Pages, Netlify static hosting, or any ordinary static-file host. The checker itself still runs entirely in the user's browser.

## Current checks

The first rule set intentionally focuses on mechanical checks that can be trusted without an LLM:

- find the main `.tex` file and check for `\documentclass{toc}`;
- warn about multiple `.tex` files and generated build products in ZIP uploads;
- require `.bib`, `packages.sty`, and `aumacros.sty` in ZIP-mode source packages;
- flag `.bbl` files;
- check `\tocdetails{...}` existence, duplicate blocks, required keys, and placeholders;
- check frontmatter and abstract placement;
- forbid `\def` and warn on `\renewcommand`;
- warn on obvious dead text markers such as `\iffalse`, `comment`, `\ignore`, `TODO`, and `FIXME`;
- check `\bibliographystyle{tocplain}` and referenced `.bib` files;
- check `\input` / `\include` files exist;
- warn on direct `\ref{...}`;
- check `\includegraphics` targets exist and warn on non-PDF graphics;
- compare author names in frontmatter to `\tocdetails`;
- compare `tocinfo` and `tocabout` labels.

## Suggested next phases

1. Add a rule configuration file so some checks can be changed from `warning` to `off` without editing code.
2. Add browser-side LaTeX compilation in a Web Worker.
3. Add a local browser LLM only for fuzzy warnings and explanations, not for hard mechanical rules.
4. Build a regression suite from accepted ToC source packages plus intentionally mutated bad packages.

## Notes

This is a preflight checker, not a proof of compliance. Some copy-editing requirements are editorial or semantic and cannot be decided from a `.tex` file alone.

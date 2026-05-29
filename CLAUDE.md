# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`lab-pdf-gen` is a synthetic Indian-style lab-report PDF generator. It exists to stress-test a
downstream pipeline (`labsense-agent`'s watch / SHA-256 / dedup / multipart-upload path and the
`LabSense-Health` backend's OCR + parsing + ingest paths). It emits thousands of realistic CBC /
Lipid / LFT / Thyroid / KFT / HbA1c / Iron / Urine PDFs across 8 visual layouts and 4 fictitious
lab brandings, with a realistic patient mix (70% one-shot walk-ins, 30% recurring follow-ups).
Output lands in `./test-sample/` (gitignored). It is a pure data generator — it never runs in
production.

## Package manager: pnpm only

This is a Node ESM project (`"type": "module"`). Use **`pnpm` exclusively** — never `npm`, `yarn`,
or `bun`. The lockfile is `pnpm-lock.yaml`; CI runs `pnpm install --frozen-lockfile` and fails on
lockfile drift, so regenerate and commit the lockfile whenever you touch dependencies.

## Commands

```bash
pnpm install
pnpm run generate:smoke        # 20 PDFs, seed 42 — quick end-to-end sanity check
pnpm run generate:full         # ~2000 PDFs, seed 42
pnpm run generate -- --count 500 --seed 99 --out-dir ./test-sample --panels cbc,lipid
pnpm run generate -- --help    # canonical CLI flag reference (mirrors README)
pnpm run setup:fonts           # re-fetch the vendored Noto Sans Devanagari TTFs if missing
```

CLI flags (all parsed by hand in `src/index.js`): `--count`, `--seed`, `--out-dir`, `--mix`,
`--recurring-reports`, `--panels`.

## Tests and linting

There is **no test suite and no linter** — this is deliberate (see `.github/workflows/ci.yml` for
the rationale). The compile gate is `node --check` over every `src/**/*.js` file. Run it locally
the way CI does before committing:

```bash
find src -type f -name '*.js' -print0 | xargs -0 -n1 node --check
```

The de facto correctness test is the **determinism check** — re-running the same seed must produce
byte-identical PDFs (see "Determinism" below and `docs/contributing.md` §10 for the exact recipe).

## Architecture: panel vs. layout are orthogonal

The single most important design fact: **content (panel) and presentation (layout) are fully
decoupled.** This is what gives `8 panels × 8 layouts × 4 labs = 256 visual shapes` with no
combinatorial code duplication.

- A **panel** = `src/templates/<panel>.js` + its entry in `data/analyte-defs.json`. It owns *what
  the report says*: which analytes, units, reference ranges, computed analytes, and the clinical
  note paragraph. Templates are thin.
- A **layout** = `src/layouts/<layout>.js`. It owns *how it looks*: margins, header band, patient
  block, results-table styling, endorsement, footer. Layouts know nothing about which panel they
  render — they operate on the generic `Report` shape.
- The contract between them is the **10-function layout interface** (`formatDate`, `formatDateTime`,
  `commonStyles`, `defaultPageDefinition`, `headerBlock`, `patientBlock`, `panelTitleBar`,
  `resultsTable`, `endorsementBlock`, `pageFooter`). The canonical definition is the file-header
  JSDoc of `src/layouts/corporate-clean.js` — copy it verbatim when adding a layout.

### Pipeline

```
CLI (src/index.js)
  → createRng(seed)                    src/seedrand.js (mulberry32; the ONLY randomness source)
  → loadDefs()                         data/analyte-defs.json (catalogue, loaded once)
  → createPrinter()                    src/render.js (one shared PdfPrinter + font registration)
  → planReports(...)                   src/generators/patients.js — builds N "report shells"
                                       (patient, panel, layoutKey, dates, ids) WITHOUT values
  → shells.map(fillReport)             src/generators/analytes.js — samples values + computes
                                       derived analytes; produces full Report objects
  → renderAll(...)                     src/render.js — 8-wide batched render; dispatches
                                       templateFor(panel) → buildDocDefinition, which pulls
                                       layoutFor(layoutKey), streams PDF to disk
```

`src/layouts/index.js` is the registry — `LAYOUTS`, `pickLayout(rng)`, `layoutFor(key)`. Adding or
removing a layout touches only this file plus the new layout module.

Full reference: `docs/architecture.md` (pipeline, module map, all data-flow types), `docs/layouts.md`
(layout interface + adding one), `docs/panels.md` (panel authoring + `analyte-defs.json` schema).

## Determinism is load-bearing

Same `--seed` **and** same `--now` → identical patient set, panel/layout picks, dates, values,
filenames, and **bytes on disk**. The downstream agent's SHA-256 dedup test depends on this.

`--now` (epoch ms or ISO-8601) is the single time anchor: every sample/report date, the MRN year
stamp, and the PDF's embedded `CreationDate`/`/ID` derive from it. Omitting it defaults to
wall-clock (non-reproducible); the CLI echoes the resolved `now=<ISO>` so a run can be replayed.
Threading: `index.js` resolves `now` → `planReports({..., now})` → `buildPatient({..., now})`, and
`report.reportDate` → `renderOne` (which sets `docDefinition.info.creationDate`).

When editing any code in the render or generation path, never introduce:

- `Math.random()` anywhere downstream of `createRng` — all randomness flows through the single
  seeded RNG threaded from `src/index.js`.
- bare `new Date()` / `Date.now()` for any value that reaches the page — thread the `now` anchor
  through instead (see `planReports` / `renderOne`).
- `Date.prototype.toLocaleDateString` / locale-aware formatters — they read host ICU data and break
  byte-stability across dev/CI. Use each layout's hand-rolled `formatDate` / `formatDateTime`.
- Iteration whose order depends on input ordering of an unordered `Set`/`Map`/`Object.entries`.
- A PDF `info`/`CreationDate` that isn't derived from `now` — pdfkit otherwise defaults it to
  `new Date()` and bakes it into the `/ID` trailer.

## Conventions (enforced by CI, not local hooks)

There are **no local git hooks**; validation lives in `.github/workflows/`. Match these so PRs go
green:

- **Branch names** must start with one of: `feat/ fix/ docs/ chore/ style/ refactor/ perf/ test/
  build/ ci/ revert/`.
- **Commit messages / PR titles**: conventional commits — `type(scope): description`, imperative
  mood, first line ≤100 chars. (Note the global instruction to append the `Co-Authored-By` trailer
  to commit messages.)
- **PR body** needs three sections: Description/Summary, How-to-test/Test-plan, and `## Checklist`.
- **Single runtime dependency** (`pdfmake`) — do not add a new runtime dep without prior agreement;
  hand-roll small helpers instead (see `pad2` / `MONTH_ABBREV` in `corporate-clean.js`).
- Local imports must include the explicit `.js` extension (ESM resolution).
- File-level JSDoc on every file; function-level JSDoc on every export. No emojis in source.

When adding a **panel**, six places must change (defs, analytes formulas if computed, template,
`render.js` dispatch, planner weights, CLI help/`--panels` list) — see `docs/contributing.md` §8.

## Fonts

Roboto (Latin) is decoded from pdfmake's bundled VFS at startup — no download needed for the seven
Latin-only layouts. Only `bilingual-en-hi` needs the Noto Sans Devanagari TTFs vendored in
`assets/fonts/`; if absent, the renderer warns once and falls back to Roboto (Devanagari renders as
`.notdef` boxes, other layouts unaffected). `pnpm run setup:fonts` re-fetches them.

# Contributing

Thanks for wanting to improve `lab-gen-pdf`. This document is the
single source of truth for how a clean pull request looks: which
branches CI accepts, which commits CI accepts, which sections the PR
body needs, and which patterns the code itself must follow.

The project is MIT-licensed and lives at
[`RKInnovate/lab-gen-pdf`](https://github.com/RKInnovate/lab-gen-pdf).

---

## 1. Quick start

```bash
git clone https://github.com/RKInnovate/lab-gen-pdf.git
cd lab-gen-pdf
pnpm install
pnpm run generate:smoke
```

`generate:smoke` emits 20 PDFs into `./test-sample/` using seed `42`
— enough to confirm your clone is working end-to-end.

If `assets/fonts/` is empty (the Devanagari TTFs are vendored, but
you may have stripped them locally), re-fetch them with:

```bash
pnpm run setup:fonts
```

The seven Latin-only layouts will render fine without the fonts; the
`bilingual-en-hi` layout falls back to Roboto with a one-line warning
and Devanagari glyphs render as `.notdef` boxes.

---

## 2. Coding standards

These rules are enforced by review, not by tooling (the project
ships no linter on purpose — see `.github/workflows/ci.yml` for the
rationale). Treat them as binding regardless.

### Module system

- The project is ESM end-to-end (`"type": "module"` in
  `package.json`).
- Every local import **must** include the explicit `.js`
  extension, even for files you wrote yourself:

  ```js
  // Correct
  import { renderReport } from './render.js';

  // Wrong — will fail at runtime under ESM resolution
  import { renderReport } from './render';
  ```

### Dependencies

The project deliberately ships a single runtime dependency
(`pdfmake`). Do not add a new runtime dependency without prior
agreement on an issue. Single-dep is a supply-chain choice, not an
oversight; hand-rolling a small helper (see `pad2` / `MONTH_ABBREV`
in `src/layouts/corporate-clean.js`) is preferred over pulling in a
date library, a colour library, or similar.

### Documentation

- **File-level JSDoc** on every file. It must describe the file's
  purpose, the problem it solves, its role in the pipeline, and any
  load-bearing design decisions. Existing layouts in `src/layouts/`
  are the reference shape.
- **Function-level JSDoc** on every exported function: what it does,
  why it exists, parameters with types, return value, edge cases.
- **Inline comments** where `pdfmake` behaviour is non-obvious
  (column-width arithmetic, fill colours, table row alignment). For
  obvious code, let well-named identifiers carry the meaning.

### Style rules

- **No emojis** in source, comments, or docstrings.
- **Date formatting** goes through the project's hand-rolled
  formatter on each layout (`formatDate` / `formatDateTime`). Never
  call `Date.prototype.toLocaleDateString` — locale-aware methods
  read from the host's ICU data and break byte-stability across
  CI vs. dev machines.
- **Random anything** must go through the `createRng(seed)` helper
  in `src/seedrand.js`. Never call `Math.random()` in a render path
  (or anywhere downstream of the planner). The whole project is a
  deterministic function of `--seed`; `Math.random` quietly breaks
  that.

---

## 3. Branch naming

`.github/workflows/branch-name-validation.yml` enforces the prefix
list below. Branches that don't match are flagged on push and on PR.

Valid prefixes (slash-terminated, anything sensible after):

| Prefix       | Purpose         | Example                       |
| ------------ | --------------- | ----------------------------- |
| `feat/`      | New feature     | `feat/add-coag-panel`         |
| `fix/`       | Bug fix         | `fix/method-column-width`     |
| `docs/`      | Documentation   | `docs/contributing-guide`     |
| `chore/`     | Maintenance     | `chore/bump-pdfmake`          |
| `style/`     | Formatting      | `style/normalise-quotes`      |
| `refactor/`  | Refactor        | `refactor/extract-rng`        |
| `perf/`      | Performance     | `perf/batch-renderer`         |
| `test/`      | Tests           | `test/add-smoke-fixture`      |
| `build/`     | Build system    | `build/pin-node-22`           |
| `ci/`        | CI/CD           | `ci/add-syntax-check`         |
| `revert/`    | Revert          | `revert/bad-commit-abcdef0`   |

`main`, `master`, `develop`, `dependabot/*`, and `renovate/*` are
exempt from validation.

---

## 4. Commit messages

`.github/workflows/commit-msg-validation.yml` enforces the
conventional-commits pattern below on every commit in a PR:

```text
^(Merge|feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?: .+
```

In plain words:

```text
type(scope): description
```

- **Valid types:** `feat`, `fix`, `docs`, `style`, `refactor`,
  `perf`, `test`, `build`, `ci`, `chore`, `revert`. `Merge` is
  accepted for merge commits.
- **Scope** is optional; use it when the change is module-local
  (`feat(layouts): ...`, `fix(render): ...`).
- **First line `<= 100` chars.** Longer lines trigger a warning.
- **Imperative mood.** Use "add X", "fix Y", "extract Z" — never
  "added X" or "adds X".
- **Body explains WHY** when the diff doesn't make it obvious;
  reserve the diff itself for the WHAT.
- For multi-line messages, use a HEREDOC so the body formatting
  survives the shell:

  ```bash
  git commit -m "$(cat <<'EOF'
  feat(layouts): add coag panel layout

  Coag (PT/INR/aPTT/Fibrinogen) is the most-requested missing panel
  per the agent's ingest-error logs; this layout reuses the
  corporate-clean shell with a narrower results table because coag
  only has four analytes.
  EOF
  )"
  ```

If you used "Squash and merge" on GitHub, the **PR title** becomes
the final commit message — make sure the PR title itself follows the
pattern. The commit check is a warning rather than a hard fail
specifically to support that workflow.

---

## 5. PR template

`.github/workflows/pr_checks.yml` enforces both the PR title and the
PR body shape.

### PR title

Same conventional-commits regex as commit messages:

```text
^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?: .+
```

Title length is warned (not failed) above 100 characters.

### PR body

The body must contain three headings (each accepts synonyms — pick
whichever reads best):

| Required section      | Accepted heading variants                                          |
| --------------------- | ------------------------------------------------------------------ |
| Description / Summary | `## Description`, `## Summary`, `## Overview`                      |
| How to test / QA      | `## How to test`, `## Test plan`, `## Tests`, `## QA`, `## Verification` |
| Checklist             | `## Checklist`                                                     |

Headings are matched case-insensitively at `##` or `###` depth.

Link related issues anywhere in the body with `Closes #N`, `Fixes
#N`, or `Resolves #N`. A PR with no issue reference triggers a
warning (not a failure), but link issues when you can — it makes the
log searchable later.

A minimal valid PR body:

```markdown
## Summary
Adds a coag-panel layout reusing the corporate-clean shell, plus
analyte defs for PT, INR, aPTT, and Fibrinogen.

Closes #42.

## How to test
- `pnpm run generate -- --panels coag --count 10 --seed 42`
- Confirm 10 PDFs land in `./test-sample/` with a four-row results
  table and the standard endorsement block.

## Checklist
- [x] JSDoc on every new file + export
- [x] Determinism preserved (same seed → same bytes)
- [x] No new runtime deps
```

---

## 6. CI gates

Every PR runs four workflows. A red mark on any of them blocks
merge; fix and push.

| Workflow                       | What it checks                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `branch-name-validation.yml`   | Branch name starts with one of the 11 valid prefixes (see section 3).           |
| `commit-msg-validation.yml`    | Every commit in the PR matches the conventional-commits regex (see section 4). |
| `pr_checks.yml`                | PR title matches conventional-commits **and** body has the three sections.     |
| `ci.yml`                       | `pnpm install --frozen-lockfile` + `node --check` on every `src/**/*.js`.      |

There is no test suite and no linter yet; `node --check` is the
compile gate. If you bump `pdfmake` or any other dependency,
regenerate `pnpm-lock.yaml` and commit it — `--frozen-lockfile`
fails CI on lockfile drift.

---

## 7. Adding a new layout

Layouts are pluggable: `pickLayout` in `src/layouts/index.js`
assigns one per report at planning time, and panel templates
dispatch to it via `layoutFor(report.layoutKey)`.

1. Read `docs/layouts.md` for the visual goal of the layout you
   want to add (look-and-feel, accent colour use, table density).
2. Read `src/layouts/corporate-clean.js` end-to-end. The file
   header documents the **10-export layout interface** — every
   layout must implement the same 10 functions.
3. Create `src/layouts/<your-key>.js`. Start by copying
   `corporate-clean.js` and renaming the file-level JSDoc.
4. Implement the 10 exports: `formatDate`, `formatDateTime`,
   `commonStyles`, `defaultPageDefinition`, `headerBlock`,
   `patientBlock`, `panelTitleBar`, `resultsTable`,
   `endorsementBlock`, `pageFooter`.
5. Honour `report.patient.lab.accentColor` wherever the layout
   uses colour — the layout is generic; the lab is the variable.
6. Honour the **method-column rule**: the column is rendered iff
   at least one row has a non-null `method`. Header widths and
   body widths must agree (`corporate-clean.js` is the reference).
7. Register the new key in `src/layouts/index.js` (`LAYOUTS`
   registry + the `pickLayout` weighting if the layout should be
   sampled at planning time).
8. Run `pnpm run generate:smoke` and visually inspect a handful of
   PDFs in `./test-sample/` that landed on the new key.
9. Re-run with the same `--seed` and confirm the output is
   byte-identical to the first run (`sha256sum` is your friend).
10. Add the new layout to the tree in `README.md` and to
    `docs/layouts.md`.

---

## 8. Adding a new panel

Panels are end-to-end vertical: defs, generation, template,
dispatch, planner weights, and CLI help. A panel touches **six**
places — miss one and the panel either won't appear or will appear
broken.

1. Read `docs/panels.md` for the clinical shape of the panel.
2. Add the panel entry to `data/analyte-defs.json`. Read `_meta`
   first — it documents every supported field and the
   range/precision/kind contract.
3. Confirm sex-specific ranges live under `ranges.male` /
   `ranges.female`; common ranges live under `ranges.common`.
   Set `physMin` / `physMax` to plausible survival floors/ceilings.
4. If any analyte is computed from siblings (e.g. LDL via
   Friedewald), set `computed` and add the formula to
   `src/generators/analytes.js`.
5. Create `src/templates/<panel>.js`. Keep it thin — it's a
   clinical-note paragraph plus a dispatch to
   `layoutFor(report.layoutKey)`.
6. Wire the new template into the dispatch in `src/render.js`.
7. Add the panel to the patient-mix weighting in
   `src/generators/patients.js` so the planner actually emits it.
8. Add the panel key to the CLI help text + `--panels` filter list
   in `src/index.js`.
9. Run `pnpm run generate -- --panels <new-panel> --count 10
   --seed 42` and visually inspect the output across multiple
   layouts.
10. Add the panel to the tree in `README.md` and to
    `docs/panels.md`.

---

## 9. Adding a new lab branding

Lab branding lives in **one file**: `src/labs.js`. Append your
entry to the labs array; `patients.js` will pick it up
automatically via uniform sampling.

A hard constraint: **the brand name must be obviously synthetic.**
Use a suffix like `Demo`, `QA`, `Synthetic`, `Simulator`, or
`Fictitious` so a generated PDF can never be confused with output
from a real Indian lab. Choose an accent colour that contrasts with
the existing entries to make the dedup B-tree exercise more bucket
prefixes (see `README.md` § "Why this exists").

---

## 10. Determinism is load-bearing

Re-running the generator with the same `--seed` **and** the same
`--now` **must** produce byte-identical PDFs. The downstream consumer
(`labsense-agent`) uses SHA-256 dedup as its primary contract; the
agent's dedup test depends on this property holding.

`--now` is the time anchor: every sample/report date, the MRN year
stamp, and the PDF's embedded `CreationDate` (and hence its `/ID`
trailer) are derived from it. When `--now` is omitted it defaults to
the current wall-clock, so the timestamps — and the output bytes —
drift between invocations. The CLI echoes the resolved value
(`now=<ISO>`) on startup, so a wall-clock run can be replayed
byte-for-byte by feeding that value back via `--now`.

Anything that quietly breaks determinism is a regression:

- `Date.prototype.toLocaleDateString` (reads host ICU)
- `new Date()` / `Date.now()` anywhere downstream of the `now` anchor
  — thread `now` through instead (see `planReports` / `renderOne`)
- `Math.random()` anywhere downstream of `createRng`
- iteration over an unordered `Object.entries` / `Set` / `Map`
  whose insertion order depends on input order (rare, but watch
  for it when you refactor)
- timezone-sensitive `Date` arithmetic — keep dates pinned in UTC
  or in the formatter's hand-rolled output

If you suspect a regression, run (note the pinned `--now`):

```bash
node src/index.js --count 20 --seed 42 --now 2026-05-29T12:00:00Z --out-dir /tmp/run1
sha256sum /tmp/run1/*.pdf | awk '{print $1}' > /tmp/run1.txt
node src/index.js --count 20 --seed 42 --now 2026-05-29T12:00:00Z --out-dir /tmp/run2
sha256sum /tmp/run2/*.pdf | awk '{print $1}' > /tmp/run2.txt
diff /tmp/run1.txt /tmp/run2.txt
```

The diff must be empty. (Omitting `--now` from both runs will *not*
produce an empty diff — that is expected, since each run then anchors
to a different wall-clock instant.)

---

## 11. Reporting bugs / asking questions

- Open a GitHub issue at
  [`RKInnovate/lab-gen-pdf`](https://github.com/RKInnovate/lab-gen-pdf/issues).
- Include:
  - `pnpm --version` and `node --version`
  - The `--seed` you used
  - The panel + layout combination that triggered the bug
  - A screenshot if the bug is visual (cropped to the affected
    region is fine)
  - The first ~20 lines of stderr if the generator crashed
- For **security issues** (e.g. a supply-chain advisory against
  `pdfmake`, a dependency vulnerability), follow the disclosure
  process in `SECURITY.md` if present; otherwise email the
  maintainer listed in `package.json` directly rather than filing
  a public issue.

Thanks for contributing.

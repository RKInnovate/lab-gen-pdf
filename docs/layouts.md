# Layouts

A catalogue of the 8 visual layouts shipped by `lab-pdf-gen`, with the design
rationale for each and the recipe for adding a ninth.

## Why 8 layouts

Real Indian and South-Asian lab PDFs vary wildly in visual style. A single
patient sample, printed by different labs, can come out as a clean
corporate-clinic template, a bordered ALL-CAPS NABL form from 2008, a
dot-leader OPD quick-print, a private-physician letterhead, a dense
diagnostic-chain grid, an app-y stack of cards, a third-generation
photocopy, or a bilingual government report. OCR and parsing tools that work
flawlessly on one corporate template tend to fail in interesting ways on a
photocopied bordered form. The 8 layouts span those archetypes so the
downstream agent + extraction pipeline gets stress-tested against the
visual variety that production traffic actually presents.

## The layout contract

Every layout module under `src/layouts/` MUST export the same 10 named
functions with the same signatures. Panel templates compose them
interchangeably:

| Export | Returns | Role |
| --- | --- | --- |
| `formatDate(d)` | `string` | Hand-rolled `DD-Mon-YYYY` formatter |
| `formatDateTime(d)` | `string` | `DD-Mon-YYYY HH:MM IST` |
| `commonStyles()` | pdfmake `styles` object | Style names referenced by content nodes |
| `defaultPageDefinition()` | partial docDefinition | `pageSize`, `pageMargins`, `defaultStyle` |
| `headerBlock(report)` | content node | Top-of-page lab letterhead |
| `patientBlock(report)` | content node | Patient + sample metadata |
| `panelTitleBar(report)` | content node | Panel title + dept + specimen |
| `resultsTable(report)` | content node | Grouped results |
| `endorsementBlock(report)` | content node | Signature + disclaimer |
| `pageFooter(report)` | `(page, total) => node` | Page-footer factory |

The canonical implementation is `src/layouts/corporate-clean.js` — copy its
file-header docstring verbatim into any new layout.

**How `layoutKey` is assigned.** `pickLayout(rng)` (`src/layouts/index.js:81-83`)
is called from `src/generators/patients.js:314` (and `:396`) at *planning
time*. The resulting key is stashed on the `Report` shell and never re-rolled.
Same seed → same `layoutKey` per report → same rendered bytes, which is
load-bearing for the agent's dedup test. Layouts are uniformly weighted
(`rng.pick(LAYOUT_KEYS)` over an 8-entry array), so at large N each layout
receives ~1/8 of the reports.

`layoutFor(key)` (`src/layouts/index.js:95-104`) is the single dispatch
point. Panel templates and the renderer never import layout modules
directly.

## Catalogue

### `corporate-clean`

- **Visual goal.** Modern corporate-clinic look. Accent-coloured monogram
  square, two-column patient block, full-width results table with coloured
  header row and zebra striping, compact endorsement.
- **Design signature.** Accent fill on the panel title bar + table header
  row, with subtle zebra stripes on data rows. Critical rows get a soft
  red row wash that overrides the stripe.
- **Best for stress-testing.** The baseline. Use this as the
  visually-easy reference any new OCR or layout-detection model must clear
  before being asked to handle the harder layouts.
- **Notable decisions.** Default font stays `Roboto` (pdfmake's bundled
  VFS). Verifying pathologist is picked deterministically by
  char-code-sum-mod-pool over `registrationId` (`src/layouts/corporate-clean.js:593-600`).
  Method column is rendered iff any row has a non-null `method`
  (`src/layouts/corporate-clean.js:407-414`).

### `old-school-bordered`

- **Visual goal.** Pre-2010 NABL-accredited Indian path-lab aesthetic —
  the "government form" look with double-rule banners, fully bordered
  patient grids, and a fully gridded results table.
- **Design signature.** Grayscale only: the lab's `accentColor` is
  *deliberately* overridden with `#000000` for borders and `#333333` for
  text (`src/layouts/old-school-bordered.js:81-90`). Visual rhythm comes
  from borders, ALL CAPS labels, italics and weight contrast — not colour.
- **Best for stress-testing.** OCR pipelines that lean on coloured-header
  detection to find the results table will not find one. Bordered grids
  also stress cell-segmentation algorithms.
- **Notable decisions.** Font stays `Roboto` even though the brief calls
  for a Times feel — we don't ship a Times VFS and CLAUDE.md bans new
  dependencies (`src/layouts/old-school-bordered.js:44-48`). Double rules
  are drawn with the canvas API because pdfmake has no native
  double-border style. Reference column is labelled `REFERENCE INTERVAL`
  to match older NABL terminology.

### `two-col-compact`

- **Visual goal.** Screening-clinic / OPD-quick-print. The whole CBC fits
  on a single A4 sheet.
- **Design signature.** Results are rendered as **dot-leader rows in a
  two-column pdfmake flow** instead of a tabular grid. Even-indexed groups
  go to column A, odd-indexed to column B (`src/layouts/two-col-compact.js:51-60`).
- **Best for stress-testing.** OCR pipelines that assume a single
  top-to-bottom results table. Dot leaders also confuse naive
  column-position parsers — the dots are a separate table column, not
  filler characters inside the test-name cell.
- **Notable decisions.** Page margins `[32, 60, 32, 50]` and default
  fontSize 8 with `lineHeight: 1.1` (the tightest pdfmake renders without
  glyph clipping on Roboto). Dot leaders are implemented as a 4-column
  borderless table (`name | dots | result | flag`) because
  `preserveLeadingSpaces` + hand-built dot strings break on text-wrap
  (`src/layouts/two-col-compact.js:53-60`).

### `letterhead-minimal`

- **Visual goal.** Old-money private-practice aesthetic — a single
  physician's personal letterhead. The design element is whitespace.
- **Design signature.** No fills anywhere — not on the panel title bar,
  not on the table header, not on any row. Hierarchy comes from
  typography (italics, small-caps via `characterSpacing`, accent colour)
  rather than coloured chrome.
- **Best for stress-testing.** Layout-detection models that key on
  background fills to locate the results table will struggle. Also
  exercises whitespace-tolerant table extraction.
- **Notable decisions.** A custom `labLetterheadTable` layout function is
  used because none of the bundled pdfmake table layouts gives "no outer
  borders + no column separators + heavier rule under header"
  simultaneously (`src/layouts/letterhead-minimal.js:50-55`). Critical
  rows do NOT get a row-wash — the `• C` glyph alone carries the
  signal (the airy aesthetic would be ruined by a row fill).

### `multi-col-grid`

- **Visual goal.** Diagnostic-chain dense print — Dr. Lal PathLabs /
  Thyrocare / Metropolis. Signature property is information density:
  everything packed onto a single A4 at the smallest readable point size.
- **Design signature.** A **2-column flow of analyte cells** (each cell
  is a stack of name+unit, value, range, flag-badge) backed by a 3×5
  patient grid. Halves the vertical footprint of the body vs. a flat
  table.
- **Best for stress-testing.** Two-column analyte flow + a tiny font
  pushes both OCR character recognition (7.5pt body, 5.5pt section
  labels) and reading-order detection (column-major vs row-major). Flag
  badges as filled pills also stress small-region OCR.
- **Notable decisions.** Default font size is `7.5pt` (smallest in the
  suite), section labels `5.5pt UPPERCASE`
  (`src/layouts/multi-col-grid.js:33-36`). Tight margins `[28, 55, 28, 45]`;
  hoisted `CONTENT_WIDTH = 539` (`src/layouts/multi-col-grid.js:91-96`)
  for every canvas rule. Odd-count groups get an empty `{}` placeholder
  right cell to keep the table grid rectangular.

### `branded-modern-card`

- **Visual goal.** App-y / health-tech — 1mg Labs, HealthifyMe,
  Pharmeasy. Full-bleed accent banner, light-grey sidebar with patient
  meta, and a vertical stack of cards (one per analyte) instead of a
  flat table.
- **Design signature.** Full-bleed accent banner + per-analyte "cards".
  `pageMargins` are `[0, 0, 0, 50]` (zero on three sides) so the banner
  and footer strip lie flush against the page edge; every non-banner
  block re-introduces a 40pt inset via its own `margin`
  (`src/layouts/branded-modern-card.js:32-37`).
- **Best for stress-testing.** Card-based results break the "find the
  results table" heuristic entirely — there isn't one. Each analyte is a
  self-contained mini-block, so OCR has to learn the card pattern.
- **Notable decisions.** Rounded corners are faked with a single-cell
  bordered table and `#FAFAFA` fill — pdfmake does not support
  border-radius (`src/layouts/branded-modern-card.js:42-48`). The
  endorsement tint is the hard-coded `#F0F4F8` because pdfmake fills do
  not honour alpha channels, so a "10% accent tint" can't be expressed
  natively.

### `faxed-look`

- **Visual goal.** Photocopied or low-fidelity fax of an otherwise normal
  corporate lab report. The *content* is real; only the *rendering* is
  degraded. No external post-processing — every degradation effect is
  pure pdfmake.
- **Design signature.** Page tint (`#ECECEC`) + faint horizontal
  scan-line bands + a deterministic toner-smudge polyline +
  desaturated grey-blue accent + `characterSpacing: 0.4` for the
  ink-spread feel + dashed grey rules.
- **Best for stress-testing.** Low-contrast OCR, dashed-border tolerance,
  greyscale flag interpretation (H/L/C/N render in bold grey — colour is
  deliberately gone), and resilience to non-data marks (the smudge).
- **Notable decisions.** Page tint is painted via pdfmake's doc-level
  `background:` callback rather than as a first content node — this
  keeps the rect from being double-positioned when invoked from
  `background` (`src/layouts/faxed-look.js:331-350`). The
  `characterSpacing` lives on `defaultStyle` so it propagates to every
  text node. `FAX_ACCENT` was darkened from `#6B7280` to `#4B5563`
  because the original luminance was too close to the page tint and the
  monogram letter on top was invisible (`src/layouts/faxed-look.js:98-102`).
  Rotation, skew, and per-glyph jitter are explicitly out of scope —
  pdfmake exposes no affine transforms.

### `bilingual-en-hi`

- **Visual goal.** Government / public-sector North-Indian bilingual
  report. Every label appears in English first, then Devanagari Hindi in
  parentheses. Values (numerics, units, IDs, dates, names) stay in
  English — only labels are translated, which mirrors real Indian
  bilingual lab printing.
- **Design signature.** Two scripts on a single page sharing
  `corporate-clean`-style chrome. Devanagari text carries
  `font: 'NotoSansDevanagari'` on the inline pdfmake text node.
- **Best for stress-testing.** Multi-script OCR, label-vs-value
  segmentation (when labels are bilingual but values are not), and
  Devanagari character recognition.
- **Notable decisions.** Requires the `NotoSansDevanagari` family
  (Regular + Bold) to be registered with pdfmake's VFS by the renderer;
  the TTFs live under `assets/fonts/`. If the family is missing, the
  renderer logs a one-line warning and falls back to Roboto, which
  renders the Devanagari code points as `.notdef` boxes — this is the
  documented graceful-degradation behaviour
  (`src/layouts/bilingual-en-hi.js:18-28`). Group sub-headers and
  analyte names are NOT translated — they are scientific nomenclature
  and translating per row would double table height and break the
  OCR-comparison goal (`src/layouts/bilingual-en-hi.js:58-62`).

## Cross-layout invariants

Every layout must preserve:

- **Deterministic verifier pick** from `registrationId` (char-code sum mod
  pool size). All 8 layouts use the same `VERIFIERS` pool and the same
  hash recipe so a given report endorses the same pathologist regardless
  of layout — important for cross-layout regression diffing.
- **Hand-rolled date formatters.** No `toLocaleDateString`. Output must be
  byte-identical across CI Linux and developer macOS to preserve the
  same-seed-same-bytes property the agent dedup test relies on.
- **Method column gating.** The Method column is rendered iff at least one
  row in the report has a non-null `method`. Templates and the
  `resultsTable` builder of each layout agree on this rule so header and
  body widths always match.
- **Flag column with N/H/L/C semantics.** Every layout exposes the same
  four flag tokens. Presentation varies — bold red/blue for H/L on the
  coloured layouts, plain grey letters on `faxed-look` and
  `old-school-bordered`, leading `• C` glyph for critical — but the
  underlying tokens are identical.

## Adding a new layout

1. Add `src/layouts/<new-key>.js` exporting all 10 functions from the
   layout contract above. Start by copying `src/layouts/corporate-clean.js`
   and modifying.
2. Import it in `src/layouts/index.js` and add an entry to the `LAYOUTS`
   registry (the key you choose is the value `layoutKey` will carry on
   Reports).
3. Run `node src/index.js --count 16 --seed 42` and verify a few PDFs
   render without throwing.
4. Open a PDF whose filename indicates it landed on your new
   `layoutKey` and visually verify it looks the way you intended.
5. Add a section to this file (`docs/layouts.md`) following the
   structure of the existing entries.
6. Commit with `feat(layouts): add <new-key> layout`.

# Architecture

## Mission

`lab-pdf-gen` exists to stress-test the downstream LabSense pipeline
(`labsense-agent` watch / SHA-256 / dedup / multipart upload, and the
`LabSense-Health` backend's OCR + parsing + ingest paths) with PDFs
that look and behave like real Indian-lab output. The three
properties that matter — **volume** (a few thousand files to surface
debounce edges and SQLite WAL growth), **variety** (8 clinical
panels × 8 visual layouts × 4 lab brandings → 256 visual shapes, so
SHA-256 buckets and the OCR template detector are exercised on more
than one prefix), and **a realistic patient mix** (70% one-shot
walk-ins, 30% recurring follow-ups with the same patient returning
on a new sample ID weeks apart) — are baked into the pipeline below.
Everything else is a consequence of those three.

## Pipeline

```text
   CLI args ──▶ src/index.js
                   │
                   ├─▶ src/seedrand.js (seeded RNG, single instance)
                   ├─▶ data/analyte-defs.json (catalogue load)
                   ├─▶ src/render.js (PdfPrinter + Roboto + Devanagari)
                   │
                   ▼
   src/generators/patients.js (planReports)
                   │
                   │   For each report: pickPanel(rng, weights),
                   │   pickLayout(rng), build patient + sample dates,
                   │   assemble shell {patient, panel, layoutKey,
                   │   sampleDate, reportDate, registrationId, sampleId}.
                   ▼
   src/generators/analytes.js (fillReport)
                   │
                   │   For each shell: walk groups → for each analyte
                   │   draw value (numeric bucket OR qualitative pick),
                   │   compute derived analytes, build AnalyteResult rows,
                   │   attach as report.groupedResults.
                   ▼
   src/render.js (renderAll → renderOne)
                   │
                   ├─▶ templateFor(report.panel) returns buildDocDefinition
                   │   from src/templates/<panel>.js
                   │
                   ├─▶ buildDocDefinition reads layoutFor(report.layoutKey)
                   │   and composes layout chrome + panel-specific clinical
                   │   notes into a pdfmake docDefinition
                   │
                   └─▶ pdfmake serialises to PDF bytes, piped to disk
                       under {lab_slug}_{panel}_{patient_id}_{ts}.pdf
```

Box-by-box:

- **CLI args** — six flags (`--count`, `--seed`, `--out-dir`,
  `--mix`, `--recurring-reports`, `--panels`), hand-parsed in
  `src/index.js`. Anything malformed exits with a non-zero code and
  the help block.
- **seedrand** — one mulberry32 PRNG, seeded from `--seed`, threaded
  into every downstream consumer. No other source of randomness is
  allowed in the codebase.
- **analyte-defs.json** — the per-panel catalogue (8 panels, ~120
  analytes total). Loaded once, kept in memory for the whole run.
- **render.js (init phase)** — constructs the single `PdfPrinter`
  instance and registers fonts (Roboto from pdfmake's VFS, Noto
  Sans Devanagari from `assets/fonts/` if present).
- **planReports** — produces N "report shells" containing
  everything except analyte values: patient identity, lab branding,
  panel slug, layout key, sample + report dates, registration + sample
  IDs.
- **fillReport** — turns one shell into a fully populated Report by
  sampling primary analytes from the five-bucket distribution then
  resolving computed analytes (Friedewald LDL, CKD-EPI eGFR, A/G
  ratio, etc.) against their siblings.
- **renderAll / renderOne** — fixed-concurrency batched renderer (8
  wide). For each report, dispatches to the panel template, which
  composes the named layout's chrome into a pdfmake docDefinition,
  then streams the resulting PDF bytes to disk.

## Two orthogonal axes: panel vs. layout

The single most important architectural decision in this repo is the
separation of **content** (what the report says) from **presentation**
(how it looks). Concretely:

- A **panel** lives in `src/templates/<panel>.js` and `data/analyte-defs.json`.
  It owns: which analytes appear, in what groups, with which units
  and reference ranges; which computed analytes get derived; the
  panel-specific clinical-interpretation paragraph between the
  results table and the endorsement.
- A **layout** lives in `src/layouts/<layout>.js`. It owns the
  visual chrome: page margins, header band, patient block, panel
  title bar, results-table styling, endorsement block, page footer,
  date formatters, common pdfmake styles. Layouts know nothing
  about which panel they are rendering — they operate on the
  generic `Report` shape (`groupedResults: [{name, rows: [...]}]`).

The contract between them is the **layout interface**: every layout
module exports the same 10 named functions (`formatDate`,
`formatDateTime`, `commonStyles`, `defaultPageDefinition`,
`headerBlock`, `patientBlock`, `panelTitleBar`, `resultsTable`,
`endorsementBlock`, `pageFooter`). The canonical definition is the
file-header JSDoc of [`src/layouts/corporate-clean.js`](../src/layouts/corporate-clean.js)
— copy that contract verbatim when adding a new layout.

The pay-off:

- 8 panels × 8 layouts = **64 unique visual shapes** with no
  combinatorial code duplication. Adding one new panel adds 8 new
  shapes; adding one new layout adds 8 new shapes.
- The same Report can be rendered into any layout without changing
  any of its data. Re-running with `--seed 42` but a different
  layout pool will produce the same patient set with different
  visual chrome — exactly the property the OCR template detector
  needs to be challenged with.
- Recurring patients realistically see their template change across
  visits. `planReports` picks `layoutKey` independently per visit,
  so a thyroid-follow-up patient on visit 3 might land on
  `faxed-look` even though visit 1 was `corporate-clean`. Real
  labs revise print stationery; we mimic that.

See [layouts.md](./layouts.md) for the full layout interface
reference and [panels.md](./panels.md) for the panel/template
authoring guide.

## Determinism guarantee

Same `--seed` → same patient set, same panel picks, same layout
picks, same sample dates, same analyte values, same filenames,
same bytes on disk. The discipline behind this is narrow:

1. **Single seeded RNG threaded everywhere.** `createRng(seed)` is
   called once in `src/index.js` and passed by reference to
   `planReports`, `fillReport`, `pickLayout`, `pickLab`, every
   `rng.weighted` / `rng.pick` / `rng.float` call site. Nothing in
   the codebase calls `Math.random`, `crypto.randomUUID`,
   `Date.now()` for a value that ends up on the page, or any other
   non-seedable source.
2. **Hand-rolled date formatters.** Layouts format dates with a
   hand-rolled `pad2` + `MONTH_ABBREV` array, not
   `toLocaleDateString`. Locale-aware formatters vary across Node
   versions and OS locale settings, which would break reproducibility
   between developer macOS and Linux CI. The `IST` suffix is hard-coded
   in `formatDateTime`.
3. **Verifying-pathologist pick is a char-sum-mod-pool over
   `registrationId`.** See `endorsementBlock` in
   [`src/layouts/corporate-clean.js`](../src/layouts/corporate-clean.js):
   the verifier index is derived from the sum of char codes of the
   registration ID modulo the pool size — deterministic, stable
   across runs, but visibly varied across patients.
4. **Qualitative analyte picks use the same RNG.** Urine routine
   semi-quantitatives (Negative / Trace / 1+ / 2+ ...) draw via
   `rng.pick` from the analyte's `options` list, not a fresh source.

Side note: re-running with the same seed produces byte-identical PDFs
only when pdfmake itself is byte-stable across runs. pdfmake@0.2.x
is — it does not embed `Date.now()` into the PDF's `/CreationDate`
field (it embeds a fixed epoch when no `info` is supplied), and its
font subsetter is deterministic. If pdfmake's byte-stability changes
in a future release, this property breaks and the determinism note
on the README needs to be revisited.

## Module reference

| Path | Responsibility |
|---|---|
| `src/index.js` | CLI parsing (hand-rolled, six flags + help), option validation, pipeline orchestration, progress-throttled logging, summary tables |
| `src/seedrand.js` | mulberry32 RNG + distribution helpers (`float`, `int`, `pick`, `weighted`, `bool`). Only randomness source in the codebase |
| `src/labs.js` | Four fictitious lab brandings (MedLab Demo, CityPath QA, PrimeHealth Synthetic, Apex Sim); `pickLab(rng)` helper. Brandings deliberately implausible so a generated PDF can never be mistaken for production traffic |
| `src/layouts/index.js` | Layout registry (`LAYOUTS`, `LAYOUT_KEYS`), `pickLayout(rng)`, `layoutFor(key)` dispatch. Single source of truth for what's a valid layout key |
| `src/layouts/<layout>.js` | One file per layout. Implements the 10-function layout interface; emits pdfmake content nodes. Knows nothing about which panel is being rendered |
| `src/templates/<panel>.js` | One file per panel. Reads the layout via `layoutFor(report.layoutKey)`, composes the layout's chrome with a panel-specific clinical-interpretation paragraph, returns a complete pdfmake docDefinition |
| `src/generators/patients.js` | Patient + report-shell planner. Owns the 70/30 unique-vs-recurring mix, recurring-patient visit cadence (18-month window, min 14-day gap), patient-identity pools (names, MRN format, referring-doctor list), registration + sample ID builders |
| `src/generators/analytes.js` | Value sampler (five-bucket distribution: 78% normal, 12% high, 5% low, 3% critical-high, 2% critical-low) + computed-formula evaluator (Friedewald LDL, CKD-EPI eGFR, A/G ratio, ANC/ALC, eAG from HbA1c, transferrin saturation, ...) + qualitative analyte picker |
| `src/render.js` | One-shot `PdfPrinter` factory, Roboto registration via pdfmake VFS (with fallback to raw TTFs), Noto Sans Devanagari registration (optional, with warn-and-fall-back-to-Roboto path), 8-wide batched renderer, panel→template dispatch, OS-safe filename builder |
| `data/analyte-defs.json` | Per-panel analyte catalogue. Schema is documented under the top-level `_meta` key; see also [panels.md](./panels.md) |
| `assets/fonts/` | Vendored Noto Sans Devanagari TTFs (regular + bold) used by the `bilingual-en-hi` layout. SIL Open Font License v1.1; license text at `assets/fonts/OFL.txt` |

## Data-flow types

The shapes flowing through the pipeline. These are JSDoc-derived; the
canonical definitions live in the files cited.

```ts
// src/labs.js
type LabBranding = {
  slug: string;          // filesystem-safe; used in output filenames
  name: string;          // top-of-page banner
  tagline: string;       // small italic line under the name
  address: string[];     // multi-line block, rendered on the right of header
  phone: string;
  email: string;
  regNumber: string;     // fake NABL / ICMR registration string for the footer
  accentColor: string;   // hex; drives monogram fill, table header, rules
  logoMonogram: string;  // two-letter abbreviation rendered as a square
};
```

```ts
// src/generators/patients.js (buildPatient return shape)
type Patient = {
  id: string;              // 'P-000123' — sequential, zero-padded
  mrn: string;             // '<lab.slug>/MRN/<year>/<7-digit>'
  name: string;            // 'First [Middle] Last'
  age: number;             // integer, 6..92 inclusive, weighted toward 25..65
  sex: 'M' | 'F';
  referringDoctor: string; // 'Dr. <Name>, <quals>'
  lab: LabBranding;
};
```

```ts
// src/generators/analytes.js (buildResult / buildQualitativeResult /
// buildComputedResult — all three produce this shape)
type AnalyteResult = {
  code: string;                // stable identifier, kebab-case
  name: string;                // display name
  value: number | string;      // string for qualitative analytes, number otherwise
  display: string;             // value formatted for printing (toFixed-style)
  unit: string;                // printed verbatim
  method: string | null;       // method column; null if not declared
  rangeLow: number | null;     // null for qualitative or unbounded
  rangeHigh: number | null;    // null for qualitative or unbounded
  rangeDisplay: string;        // '13.5 - 17.5', '< 200', '> 40', or normalOptions joined ' / '
  flag: 'N' | 'H' | 'L' | 'C'; // normal / high / low / critical
};
```

```ts
// src/generators/analytes.js (fillReport return shape — the same
// object the panel template's buildDocDefinition consumes)
type Report = {
  patient: Patient;
  panel: string;             // one of cbc | hba1c | iron | kft | lft | lipid | thyroid | urine
  panelTitle: string;        // e.g. 'Complete Blood Count (CBC)'
  panelDept: string;         // e.g. 'Haematology'
  panelSpecimen: string;     // e.g. 'Whole Blood — EDTA'
  sampleDate: Date;
  reportDate: Date;          // sampleDate + 4..36h
  registrationId: string;    // 'REG/<year>/<6-digit>'
  sampleId: string;          // 'SMP-<6 hex>-<4 digit>'
  layoutKey: string;         // one of the keys in src/layouts/index.js LAYOUTS
  groupedResults: Array<{
    name: string;            // group label, e.g. 'Erythrocyte Profile'
    rows: AnalyteResult[];   // declaration order from analyte-defs.json
  }>;
};
```

## Where to go next

- [layouts.md](./layouts.md) — the layout interface reference,
  per-layout design notes, and the recipe for adding a 9th layout.
- [panels.md](./panels.md) — the panel-template authoring guide,
  including the `analyte-defs.json` schema and how computed analytes
  are wired in.
- [contributing.md](./contributing.md) — repo conventions, the
  determinism test, lint + test gating, and the release process.
- `pnpm run generate -- --help` — the canonical CLI flag reference.
  Defaults and validation rules live in `src/index.js`; the help
  text mirrors the README flag list exactly.

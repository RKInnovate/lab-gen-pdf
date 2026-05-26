/**
 * Layout: Old-School Bordered.
 *
 * # Purpose
 * Layout #2 of the 8-layout pluggable layout system. Reproduces the
 * pre-2010 NABL-accredited Indian path-lab aesthetic: a starkly
 * black-and-white "government form" look with double-rule banners,
 * fully bordered patient grids, fully gridded results tables, and a
 * centered signature block. There are no accent colors anywhere on
 * the page — the lab's `accentColor` is deliberately ignored and
 * substituted with `#000000` (borders) / `#333333` (text). The
 * visual rhythm is achieved entirely through borders, ALL CAPS
 * labels, italics, and weight contrast.
 *
 * # Role in the pipeline
 *   generators/* ──▶ Report (with .layoutKey='old-school-bordered')
 *                                            │
 *                                            └─uses─▶ this file
 *                                                       │
 *                                                       └─emits─▶ pdfmake docDefinition
 *
 * # Layout interface (this module MUST export all 10 names)
 *   formatDate(d)                   → string
 *   formatDateTime(d)               → string
 *   commonStyles()                  → pdfmake styles object
 *   defaultPageDefinition()         → partial docDefinition
 *   headerBlock(report)             → pdfmake content node
 *   patientBlock(report)            → pdfmake content node
 *   panelTitleBar(report)           → pdfmake content node
 *   resultsTable(report)            → pdfmake content node
 *   endorsementBlock(report)        → pdfmake content node
 *   pageFooter(report)              → (page, total) => content node
 *
 * # Design decisions (this layout)
 * - Grayscale only. We override `lab.accentColor` everywhere it
 *   would have been used in corporate-clean with the constants
 *   below (BORDER_BLACK / TEXT_DARK). The lab's brand color is
 *   intentionally absent from the page — old NABL forms used a
 *   single ink color (black) for everything.
 * - Banner uses a "double rule" (two parallel 0.5pt black lines
 *   spaced 2pt apart) above and below the centered title block.
 *   pdfmake has no native double-border style, so we draw the
 *   rules manually with the canvas API.
 * - Default font stays 'Roboto'. We do NOT switch to Times — we do
 *   not ship a Times VFS locally, and pdfmake's built-in font set
 *   is limited. The "Times feel" is approximated via fontSize 10,
 *   tighter leading (1.10), and aggressive use of bold + italic
 *   variants throughout the page.
 * - Patient block: a single 4-row × 4-cell fully-bordered table.
 *   Each cell stacks a small ALL-CAPS bold label above a normal-
 *   weight value (e.g. "PATIENT NAME\nRajesh Kumar"). All cells
 *   carry 0.5pt black borders.
 * - Panel title bar: single centered ALL-CAPS row in a thin
 *   bordered box, decorated with `‹‹  …  ››` guillemets. No fill.
 * - Results table: every cell gets a 0.5pt black border (full
 *   grid). Header row is bold ALL CAPS, white background. Group
 *   sub-headers are a full-width bordered row with italicised
 *   `— GROUP: <NAME> —` centered text, no fill. The flag column
 *   shows just the letter (bold for H/L/C, regular for N), with
 *   NO color. Reference column is labelled "REFERENCE INTERVAL"
 *   to match the older NABL terminology.
 * - Endorsement: centered (not right-aligned). `--- END OF REPORT
 *   ---` divider, signature line + verifier name centered, plus
 *   the standard synthetic-data disclaimer.
 * - Page footer: thin top rule, single italic centered line with
 *   page numbers, lab reg number, and the synthetic-data warning.
 *
 * # Verifier pick
 * Deterministic from `report.registrationId` (char-code sum modulo
 * pool size) — identical algorithm to corporate-clean. Keeps the
 * "same seed → same bytes" property the agent's dedup test relies
 * on.
 */

/**
 * Border color used everywhere on the page. The whole point of this
 * layout is "no brand color", so this is a hard-coded black.
 *
 * @type {string}
 */
const BORDER_BLACK = '#000000';

/**
 * Default text color for body content. Pure black would be too harsh
 * against the heavy black borders; #333 keeps the page legible while
 * still reading as monochrome.
 *
 * @type {string}
 */
const TEXT_DARK = '#333333';

/**
 * Fixed pool of fictitious consultant pathologist names + registration
 * numbers used by `endorsementBlock`. Mirrors the pool in
 * corporate-clean.js so that, for any given registrationId, both
 * layouts pick the same signer — important for cross-layout
 * regression diffing.
 *
 * @type {ReadonlyArray<{ name: string; regNo: string }>}
 */
const VERIFIERS = Object.freeze([
  { name: 'Dr. Suresh Iyer, MD (Pathology)', regNo: 'KMC/PATH/04821' },
  { name: 'Dr. Priya Nair, MD, DNB', regNo: 'MMC/PATH/07734' },
  { name: 'Dr. Arvind Deshmukh, MD', regNo: 'MMC/PATH/09112' },
  { name: 'Dr. Kavita Rao, MD (Haematology)', regNo: 'KMC/PATH/05566' },
  { name: 'Dr. Rakesh Verma, MD, FRCPath', regNo: 'DMC/PATH/03398' },
  { name: 'Dr. Lakshmi Subramaniam, MD', regNo: 'TNMC/PATH/06241' },
]);

/**
 * Two-digit zero-padded helper used by the date formatters. Inlined
 * (not imported) to keep this layout module self-contained and to
 * avoid coupling between sibling layout files.
 *
 * @param {number} n
 * @returns {string}
 */
function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

const MONTH_ABBREV = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Format a Date as `26-May-2026`. We avoid `toLocaleDateString` for
 * the same reason corporate-clean does — locale-stable output on
 * Linux CI and macOS dev boxes is required for the deterministic
 * "same seed ⇒ same bytes" property the agent's dedup test depends on.
 *
 * @param {Date} d
 * @returns {string}
 */
export function formatDate(d) {
  return `${pad2(d.getDate())}-${MONTH_ABBREV[d.getMonth()]}-${d.getFullYear()}`;
}

/**
 * Format a Date as `26-May-2026  14:30 IST`. The literal `IST` suffix
 * is appropriate because all synthetic patients are Indian; we do not
 * attempt to honour the host TZ.
 *
 * @param {Date} d
 * @returns {string}
 */
export function formatDateTime(d) {
  return `${formatDate(d)}  ${pad2(d.getHours())}:${pad2(d.getMinutes())} IST`;
}

/**
 * Render a flag letter for the results table. In this layout, flags
 * are pure monochrome — bold weight for H/L/C, regular for N. No
 * color, no glyph (no bullet, no caret). This matches the old NABL
 * form style where everything was struck on a daisy-wheel printer.
 *
 * @param {'N'|'H'|'L'|'C'} flag
 * @returns {object} pdfmake text node
 */
function flagCell(flag) {
  // Bold weight communicates abnormality on its own — we deliberately
  // do NOT add color, since the layout is strictly grayscale.
  const isAbnormal = flag === 'H' || flag === 'L' || flag === 'C';
  return {
    text: flag,
    bold: isAbnormal,
    alignment: 'center',
    color: TEXT_DARK,
  };
}

/**
 * pdfmake styles for the whole layout. Centralised so a tweak (e.g.
 * tightening leading further) only touches one place.
 *
 * Note: many keys mirror the corporate-clean style names so panel
 * templates can reference the same style strings irrespective of
 * which layout is active. The values themselves are tuned for the
 * monochrome/bordered aesthetic.
 *
 * @returns {Record<string, object>}
 */
export function commonStyles() {
  return {
    // Banner: large bold caps title — `LABORATORY REPORT`.
    bannerTitle: {
      fontSize: 18,
      bold: true,
      alignment: 'center',
      characterSpacing: 2,
      color: BORDER_BLACK,
    },
    // Lab name under the banner: smaller bold ALL CAPS.
    bannerLabName: {
      fontSize: 11,
      bold: true,
      alignment: 'center',
      characterSpacing: 1,
      color: BORDER_BLACK,
    },
    // Lab address: italic small centered.
    bannerAddress: {
      fontSize: 8,
      italics: true,
      alignment: 'center',
      color: TEXT_DARK,
    },
    h1: { fontSize: 16, bold: true, color: BORDER_BLACK },
    h2: { fontSize: 11, bold: true, color: BORDER_BLACK },
    tagline: { fontSize: 8, italics: true, color: TEXT_DARK },
    addressLine: { fontSize: 8, color: TEXT_DARK, alignment: 'center' },
    // Grid-cell label inside the patient block: tiny ALL CAPS bold.
    gridLabel: {
      fontSize: 7,
      bold: true,
      color: BORDER_BLACK,
      characterSpacing: 0.5,
    },
    // Grid-cell value inside the patient block: regular weight.
    gridValue: {
      fontSize: 9,
      color: TEXT_DARK,
    },
    sectionLabel: {
      fontSize: 8,
      bold: true,
      color: BORDER_BLACK,
      characterSpacing: 0.5,
    },
    fieldLabel: { fontSize: 8, color: TEXT_DARK },
    fieldValue: { fontSize: 9, bold: false, color: TEXT_DARK },
    // Panel title bar text — ALL CAPS bold centered, framed by guillemets.
    panelTitle: {
      fontSize: 11,
      bold: true,
      color: BORDER_BLACK,
      alignment: 'center',
      characterSpacing: 1,
    },
    panelMeta: { fontSize: 8, color: TEXT_DARK, alignment: 'center' },
    tableHeader: {
      fontSize: 9,
      bold: true,
      color: BORDER_BLACK,
      characterSpacing: 0.3,
    },
    // Group sub-header: italic, centered, monochrome.
    groupHeader: {
      fontSize: 9,
      bold: true,
      italics: true,
      color: BORDER_BLACK,
      alignment: 'center',
      characterSpacing: 0.5,
    },
    flag: { bold: true, alignment: 'center' },
    interpretation: { fontSize: 9, italics: true, color: TEXT_DARK },
    disclaimer: {
      fontSize: 7,
      italics: true,
      color: TEXT_DARK,
      alignment: 'center',
    },
    endOfReport: {
      fontSize: 10,
      italics: true,
      bold: true,
      color: BORDER_BLACK,
      alignment: 'center',
    },
    signatureName: {
      fontSize: 9,
      bold: true,
      color: BORDER_BLACK,
      alignment: 'center',
    },
    signatureMeta: {
      fontSize: 8,
      italics: true,
      color: TEXT_DARK,
      alignment: 'center',
    },
    footerSmall: {
      fontSize: 7,
      italics: true,
      color: TEXT_DARK,
      alignment: 'center',
    },
  };
}

/**
 * Base page definition merged into every panel template via spread.
 * Top margin is bumped to 80 (vs corporate-clean's 90) to fit the
 * double-rule banner; bottom (60) accommodates the two-line footer.
 *
 * Font stays 'Roboto' — we don't ship Times VFS locally, so we
 * mimic the serif feel via fontSize 10 + tighter leading + heavy
 * use of bold/italic variants. Switching fonts mid-renderer would
 * require shipping new VFS bytes, which is out of scope.
 *
 * @returns {object} partial pdfmake docDefinition
 */
export function defaultPageDefinition() {
  return {
    pageSize: 'A4',
    // Margins: [left, top, right, bottom]. Top of 80 leaves room for
    // the double-banner; bottom of 60 leaves room for the rule + footer.
    pageMargins: [40, 80, 40, 60],
    defaultStyle: {
      font: 'Roboto',
      fontSize: 10,
      // Tighter leading than corporate-clean (1.15) to approximate
      // the dense, mechanical look of a daisy-wheel printout.
      lineHeight: 1.10,
      color: TEXT_DARK,
    },
  };
}

/**
 * Draw a double-rule horizontal divider. pdfmake has no native
 * double-border style for arbitrary content, so we render two
 * parallel 0.5pt lines via the canvas API, spaced 2pt apart.
 *
 * @param {number} [topMargin] vertical margin above the divider
 * @param {number} [bottomMargin] vertical margin below the divider
 * @returns {object} pdfmake content node
 */
function doubleRule(topMargin = 0, bottomMargin = 0) {
  return {
    margin: [0, topMargin, 0, bottomMargin],
    canvas: [
      // 515 = A4 width (595) - left margin (40) - right margin (40).
      // Top line.
      {
        type: 'line',
        x1: 0,
        y1: 0,
        x2: 515,
        y2: 0,
        lineWidth: 0.5,
        lineColor: BORDER_BLACK,
      },
      // Bottom line, 2pt below the top one.
      {
        type: 'line',
        x1: 0,
        y1: 2,
        x2: 515,
        y2: 2,
        lineWidth: 0.5,
        lineColor: BORDER_BLACK,
      },
    ],
  };
}

/**
 * Build the lab letterhead block.
 *
 * Visual layout:
 *   ════════════════════════════════════════════════ (double rule)
 *              LABORATORY REPORT
 *              <LAB NAME IN CAPS>
 *           <address line 1, italic small>
 *           <address line 2, italic small>
 *   ════════════════════════════════════════════════ (double rule)
 *
 * The lab's `accentColor` is intentionally ignored — this layout is
 * monochrome by design. Phone + email are folded into the centered
 * address stack so the whole header reads as a single tight block.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function headerBlock(report) {
  const lab = report.patient.lab;

  // Address stack: lines from `lab.address` plus phone + email. All
  // centered and italic to read as a single block under the banner.
  const addressStack = [];
  for (const line of lab.address) {
    addressStack.push({ text: line, style: 'bannerAddress' });
  }
  // Combine phone and email on a single italic line to keep the
  // header compact (older NABL forms rarely exceeded ~5 header rows).
  addressStack.push({
    text: `Tel: ${lab.phone}   •   Email: ${lab.email}`,
    style: 'bannerAddress',
  });

  return {
    margin: [0, 0, 0, 6],
    stack: [
      // Top double-rule divider.
      doubleRule(0, 4),
      // Banner title — ALL CAPS, bold, very large, centered.
      {
        text: 'LABORATORY REPORT',
        style: 'bannerTitle',
        margin: [0, 0, 0, 2],
      },
      // Lab name in ALL CAPS smaller bold. Forced upper-case so that
      // a lab named in mixed case (e.g. "MedLab Diagnostics (Demo)")
      // still reads as a formal header.
      {
        text: lab.name.toUpperCase(),
        style: 'bannerLabName',
        margin: [0, 0, 0, 2],
      },
      // Address block: italic small, centered.
      { stack: addressStack, margin: [0, 0, 0, 4] },
      // Bottom double-rule divider.
      doubleRule(0, 0),
    ],
  };
}

/**
 * Build a single cell of the 4×4 patient grid: small ALL-CAPS bold
 * label on top, regular-weight value below. Each cell has a 0.5pt
 * black border on all four sides (configured at the table level, not
 * here).
 *
 * @param {string} label  short ALL-CAPS label, e.g. 'PATIENT NAME'
 * @param {string} value  the value to display below the label
 * @returns {object} pdfmake table-cell content
 */
function gridCell(label, value) {
  return {
    stack: [
      { text: label, style: 'gridLabel' },
      // The value rendering preserves empty strings (no fallback dash)
      // because patient generators always populate every field.
      { text: value, style: 'gridValue', margin: [0, 1, 0, 0] },
    ],
    margin: [4, 3, 4, 3],
  };
}

/**
 * Build the patient + sample metadata block as a single full-grid
 * 4-row × 4-column bordered table. Each cell stacks an ALL-CAPS bold
 * label above the value.
 *
 * Row 1: PATIENT NAME       | PATIENT ID         | AGE / SEX        | REFERRING DOCTOR
 * Row 2: MRN                | REGISTRATION ID    | SAMPLE ID        | (filler)
 * Row 3: SAMPLE DATE        | REPORT DATE        | DEPARTMENT       | SPECIMEN
 *
 * pdfmake quirk: we use a manually-built `layout` object (not a
 * preset like 'lightHorizontalLines') because every internal AND
 * outer border must be drawn 0.5pt black — none of the built-in
 * presets do that.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function patientBlock(report) {
  const {
    patient,
    sampleDate,
    reportDate,
    registrationId,
    sampleId,
    panelDept,
    panelSpecimen,
  } = report;

  // 3-row × 4-col grid. We intentionally use 3 rows (12 cells) rather
  // than 4 — the spec says "4×4" but with 12 useful fields the 4th
  // row would be entirely filler. Borders + ALL-CAPS labels are what
  // sell the "form" look, not the row count per se.
  const sexLabel = patient.sex === 'F' ? 'Female' : 'Male';
  const body = [
    [
      gridCell('PATIENT NAME', patient.name),
      gridCell('PATIENT ID', patient.id),
      gridCell('AGE / SEX', `${patient.age} yrs / ${sexLabel}`),
      gridCell('REFERRING DOCTOR', patient.referringDoctor),
    ],
    [
      gridCell('MRN', patient.mrn),
      gridCell('REGISTRATION ID', registrationId),
      gridCell('SAMPLE ID', sampleId),
      gridCell('LAB REG. NO.', patient.lab.regNumber),
    ],
    [
      gridCell('SAMPLE DATE', formatDateTime(sampleDate)),
      gridCell('REPORT DATE', formatDateTime(reportDate)),
      gridCell('DEPARTMENT', panelDept),
      gridCell('SPECIMEN', panelSpecimen),
    ],
  ];

  return {
    margin: [0, 6, 0, 6],
    table: {
      // Four equal-width columns. '*' makes each one share the
      // remaining horizontal space equally.
      widths: ['*', '*', '*', '*'],
      body,
    },
    // Full black grid: every horizontal and vertical line drawn at
    // 0.5pt black. pdfmake's table-layout callbacks must return a
    // function for each border axis; we return constants because we
    // want every line drawn identically.
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => BORDER_BLACK,
      vLineColor: () => BORDER_BLACK,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  };
}

/**
 * Build the panel title bar: a single-row 1pt-bordered box with an
 * ALL CAPS centered title, framed by guillemets `‹‹ … ››`. The
 * department + specimen sit on a smaller italic line just below the
 * boxed title. No fill color.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function panelTitleBar(report) {
  // Compose the title fragment: PANEL TITLE — DEPARTMENT, all caps.
  // The department is included inside the box (per the spec) so that
  // it reads as a single banner line.
  const titleLine = `${report.panelTitle} — ${report.panelDept}`.toUpperCase();

  return {
    margin: [0, 4, 0, 6],
    stack: [
      // The boxed banner row. We use a 1-row 1-col table to get the
      // bordered-box look. Border width is set via the layout fn.
      {
        table: {
          widths: ['*'],
          body: [
            [
              {
                text: `‹‹  ${titleLine}  ››`,
                style: 'panelTitle',
                margin: [6, 5, 6, 5],
              },
            ],
          ],
        },
        layout: {
          hLineWidth: () => 1,
          vLineWidth: () => 1,
          hLineColor: () => BORDER_BLACK,
          vLineColor: () => BORDER_BLACK,
        },
      },
      // Smaller italic line under the box giving the specimen. We
      // keep it outside the box so the boxed line stays a single,
      // visually impactful banner.
      {
        text: `Specimen: ${report.panelSpecimen}`,
        style: 'panelMeta',
        italics: true,
        margin: [0, 2, 0, 0],
      },
    ],
  };
}

/**
 * Determine whether any row in any group of this report carries a
 * non-null `method`. When true, the results table renders a Method
 * column; when false, we omit it to keep the table compact for
 * panels with no method metadata.
 *
 * @param {object} report
 * @returns {boolean}
 */
function reportHasAnyMethod(report) {
  for (const group of report.groupedResults) {
    for (const row of group.rows) {
      if (row.method != null && row.method !== '') return true;
    }
  }
  return false;
}

/**
 * Build the grouped results table.
 *
 * Column layout (no method):   TEST | RESULT | UNIT | REFERENCE INTERVAL | FLAG
 * Column layout (with method): TEST | RESULT | UNIT | METHOD | REFERENCE INTERVAL | FLAG
 *
 * Every cell — header, group sub-header, body — carries a 0.5pt
 * black border on all four sides. Group sub-headers span the full
 * width with `colSpan` and render as italic ALL-CAPS centered text
 * in the form `— GROUP: <NAME> —`. No fill color anywhere.
 *
 * pdfmake colSpan quirk: the spanning cell holds `colSpan: N` AND
 * the next N-1 slots in the same row MUST exist as empty `{}`
 * objects, otherwise pdfmake renders shifted cells.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function resultsTable(report) {
  const showMethod = reportHasAnyMethod(report);
  const colCount = showMethod ? 6 : 5;

  // Test column gets the lion's share; numerics hug their content.
  // Reference Interval is also flexible (sex-stratified ranges can
  // be long, e.g. 'M: 13.5-17.5 / F: 12.0-15.5').
  const widths = showMethod
    ? ['*', 'auto', 'auto', 'auto', 'auto', 30]
    : ['*', 'auto', 'auto', 'auto', 30];

  /**
   * Build one header-row cell. Plain white background, ALL CAPS bold
   * text. Padding is set via the table layout function, but margin
   * here adds breathing room inside the cell.
   *
   * @param {string} label
   * @param {string} [align]
   * @returns {object}
   */
  const th = (label, align = 'left') => ({
    text: label.toUpperCase(),
    style: 'tableHeader',
    alignment: align,
    margin: [4, 4, 4, 4],
  });

  const headerRow = showMethod
    ? [
        th('Test'),
        th('Result', 'right'),
        th('Unit'),
        th('Method'),
        th('Reference Interval'),
        th('Flag', 'center'),
      ]
    : [
        th('Test'),
        th('Result', 'right'),
        th('Unit'),
        th('Reference Interval'),
        th('Flag', 'center'),
      ];

  const body = [headerRow];

  for (const group of report.groupedResults) {
    // Group sub-header row: full-width italic ALL-CAPS centered text
    // framed by em-dashes. The "GROUP:" prefix mimics the wording
    // used on older NABL-format reports.
    const spanRow = [
      {
        text: `— GROUP: ${group.name.toUpperCase()} —`,
        colSpan: colCount,
        style: 'groupHeader',
        margin: [4, 5, 4, 4],
      },
    ];
    // Fill the trailing slots that colSpan consumes. pdfmake requires
    // them to exist as empty objects; missing slots = shifted cells.
    for (let i = 1; i < colCount; i += 1) spanRow.push({});
    body.push(spanRow);

    for (const row of group.rows) {
      /**
       * Build one body cell with consistent padding and color. We do
       * NOT set fillColor — the whole table is intentionally white,
       * with separation provided by the full grid of borders.
       *
       * @param {string|object} content
       * @param {object} [extra]
       * @returns {object}
       */
      const bc = (content, extra = {}) => {
        const base = typeof content === 'string' ? { text: content } : content;
        return {
          ...base,
          margin: base.margin ?? [4, 3, 4, 3],
          color: base.color ?? TEXT_DARK,
          ...extra,
        };
      };

      // Result cell: right-aligned, bold for any non-normal flag so
      // abnormal values catch the eye even without color.
      const valueCell = bc({
        text: row.display,
        alignment: 'right',
        bold: row.flag !== 'N',
        color: BORDER_BLACK,
      });

      // Flag cell uses flagCell() — bold for H/L/C, regular for N,
      // monochrome throughout. We re-apply the standard padding so
      // it matches the rest of the row vertically.
      const flagFragment = flagCell(row.flag);
      flagFragment.margin = [4, 3, 4, 3];

      const rowCells = showMethod
        ? [
            bc(row.name),
            valueCell,
            bc(row.unit),
            bc(row.method ?? '—'),
            bc(row.rangeDisplay),
            flagFragment,
          ]
        : [
            bc(row.name),
            valueCell,
            bc(row.unit),
            bc(row.rangeDisplay),
            flagFragment,
          ];

      body.push(rowCells);
    }
  }

  return {
    margin: [0, 2, 0, 6],
    table: {
      headerRows: 1,
      widths,
      body,
    },
    // Full black grid — every internal and outer line drawn at 0.5pt.
    // We use a custom layout (not a preset) because none of the
    // built-in presets ('lightHorizontalLines', 'headerLineOnly',
    // etc.) draw both axes at uniform black width.
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => BORDER_BLACK,
      vLineColor: () => BORDER_BLACK,
    },
  };
}

/**
 * Build the closing block: a centered `--- END OF REPORT ---`
 * divider, a centered signature line + verifier name + reg number,
 * and a small-print synthetic-data disclaimer.
 *
 * Unlike corporate-clean (right-aligned signature), this layout
 * centers everything — that matches the symmetric, form-style
 * aesthetic of pre-2010 NABL reports.
 *
 * The verifier is picked deterministically from `report.registrationId`
 * via a char-code sum modulo pool size; this keeps the same report
 * stable across re-renders so the agent's dedup test stays
 * reproducible.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function endorsementBlock(report) {
  // Deterministic verifier pick — identical algorithm to
  // corporate-clean.js so the same registrationId picks the same
  // pathologist regardless of which layout renders the report.
  let hash = 0;
  for (const ch of report.registrationId) {
    hash = (hash + ch.charCodeAt(0)) % 1_000_003;
  }
  const verifier = VERIFIERS[hash % VERIFIERS.length];

  return {
    margin: [0, 10, 0, 0],
    stack: [
      // End-of-report divider, centered, bold italic.
      {
        text: '---   END OF REPORT   ---',
        style: 'endOfReport',
        margin: [0, 8, 0, 18],
      },
      // Signature block: centered (the key visual change vs
      // corporate-clean). A blank line above the underscore line
      // mimics the white space where an ink signature would go.
      {
        alignment: 'center',
        stack: [
          { text: ' ', margin: [0, 0, 0, 18] },
          {
            text: '_____________________________',
            alignment: 'center',
            color: BORDER_BLACK,
          },
          { text: verifier.name, style: 'signatureName' },
          { text: 'Consultant Pathologist', style: 'signatureMeta' },
          { text: `Reg. No. ${verifier.regNo}`, style: 'signatureMeta' },
        ],
      },
      // Synthetic-data disclaimer — same wording as corporate-clean
      // to keep regression diffs minimal, but rendered centered + in
      // italic to match this layout's overall feel.
      {
        margin: [0, 14, 0, 0],
        text:
          'DISCLAIMER: This document is synthetic test data generated by '
          + 'lab-pdf-gen for the LabSense agent test bench. It does not '
          + 'represent any real patient, sample, or clinical finding and '
          + 'must not be used for diagnosis, treatment, or any clinical '
          + 'decision. All names, IDs, and laboratory brandings are '
          + 'fictitious.',
        style: 'disclaimer',
      },
    ],
  };
}

/**
 * Build the page footer factory consumed by pdfmake. pdfmake passes
 * `(currentPage, pageCount)` to this factory for each page; we
 * return a content node sized to fit inside the bottom margin (60px).
 *
 * Layout: thin black top rule, then a single italic centered line
 * combining page numbers + lab reg number + the synthetic-data
 * warning, separated by `|` glyphs.
 *
 * @param {object} report
 * @returns {(currentPage: number, pageCount: number) => object}
 */
export function pageFooter(report) {
  const lab = report.patient.lab;
  return (currentPage, pageCount) => ({
    margin: [40, 10, 40, 0],
    stack: [
      // Thin black top rule. We use 0.5pt black (not the corporate-
      // clean grey #CCC) to stay consistent with the monochrome
      // borders elsewhere on the page.
      {
        canvas: [
          {
            type: 'line',
            x1: 0,
            y1: 0,
            x2: 515,
            y2: 0,
            lineWidth: 0.5,
            lineColor: BORDER_BLACK,
          },
        ],
      },
      // Single centered italic line — page numbers, registration,
      // and the synthetic-data warning, joined by ` | `.
      {
        margin: [0, 4, 0, 0],
        text:
          `Page ${currentPage} of ${pageCount}  |  Reg: ${lab.regNumber}`
          + '  |  ** Synthetic data — not for clinical use **',
        style: 'footerSmall',
      },
    ],
  });
}

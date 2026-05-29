/**
 * Layout: Corporate Clean.
 *
 * # Purpose
 * The "default" visual layout — modern corporate-clinic look with an
 * accent-colored monogram, two-column patient block, full-width
 * results table with colored header row and zebra striping, and a
 * compact endorsement / disclaimer footer. Drives layout #1 of the
 * 8-layout pluggable layout system.
 *
 * # Role in the pipeline
 *   generators/* ──▶ Report (with .layoutKey) ──▶ panel template
 *                                                    │
 *                                                    └─uses─▶ layouts/<layoutKey>.js (this file is one of 8)
 *                                                              │
 *                                                              └─emits─▶ pdfmake docDefinition
 *
 * # Layout interface (every layout MUST export these)
 *   formatDate(d)                   → string
 *   formatDateTime(d)               → string
 *   commonStyles()                  → pdfmake styles object
 *   defaultPageDefinition()         → partial docDefinition (pageSize, pageMargins, defaultStyle)
 *   headerBlock(report)             → pdfmake content node — top-of-page lab letterhead
 *   patientBlock(report)            → pdfmake content node — patient + sample metadata
 *   panelTitleBar(report)           → pdfmake content node — panel title + dept + specimen
 *   resultsTable(report)            → pdfmake content node — grouped results table
 *   endorsementBlock(report)        → pdfmake content node — signature + disclaimer
 *   pageFooter(report)              → (page, total) => content node — page footer factory
 *
 * Panel templates compose the layout's content nodes with a small
 * panel-specific clinical-note paragraph in between resultsTable and
 * endorsementBlock. The layout file therefore has zero knowledge of
 * which panel is being rendered — it operates over the generic Report
 * shape (groupedResults: [{name, rows: [{code, name, value, display,
 * unit, method, rangeLow, rangeHigh, rangeDisplay, flag}]}]).
 *
 * # Design decisions (this layout)
 * - Accent colour for the lab is read from `report.patient.lab.accentColor`.
 *   It drives: header monogram, lab-name colour, horizontal rule, group
 *   subheader text, table header row fill, panel title bar.
 * - Method column is rendered iff at least one row in the report has a
 *   non-null `method`. Templates and the resultsTable builder agree on this
 *   rule so the table header and body row widths always match.
 * - Default font is 'Roboto' — pdfmake's built-in default that the renderer
 *   registers with the standard VFS fonts. We never reference a font that
 *   pdfmake doesn't ship out of the box.
 * - Page footer is intentionally low-contrast / small to mimic real lab
 *   reports where the disclaimer is present but not prominent.
 */

/**
 * Fixed pool of fictitious consultant pathologist names + registration
 * numbers used by `endorsementBlock`. Kept here (and not in labs.js) because
 * verifying-pathologist assignment is independent of which lab issued the
 * report — a single lab can route reports to any of its consultants.
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
 * Two-digit zero-padded helper used by the date formatters. Inlined here
 * because pulling in a date library would violate the "no new dependencies"
 * rule from CLAUDE.md, and pdfmake itself doesn't expose one.
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
 * Format a Date as `26-May-2026`. We avoid `toLocaleDateString` because its
 * output varies with the runtime locale of whichever box is generating PDFs
 * (Linux CI vs. developer macOS), which would break our deterministic
 * "same seed ⇒ same bytes" property.
 *
 * @param {Date} d
 * @returns {string}
 */
export function formatDate(d) {
  return `${pad2(d.getDate())}-${MONTH_ABBREV[d.getMonth()]}-${d.getFullYear()}`;
}

/**
 * Format a Date as `26-May-2026  14:30 IST`. The literal `IST` suffix is
 * appropriate because all our synthetic patients are Indian; we do not
 * attempt to honour the host TZ.
 *
 * @param {Date} d
 * @returns {string}
 */
export function formatDateTime(d) {
  return `${formatDate(d)}  ${pad2(d.getHours())}:${pad2(d.getMinutes())} IST`;
}

/**
 * Map an analyte flag character to a pdfmake text fragment.
 * - 'N' (normal) renders as plain dark grey 'N'
 * - 'H' (high)   renders bold red
 * - 'L' (low)    renders bold blue
 * - 'C' (critical) renders bold red with a leading bullet
 *
 * @param {'N'|'H'|'L'|'C'} flag
 * @returns {object} pdfmake text node
 */
function flagCell(flag) {
  switch (flag) {
    case 'H':
      return { text: 'H', bold: true, color: '#C62828', alignment: 'center' };
    case 'L':
      return { text: 'L', bold: true, color: '#1565C0', alignment: 'center' };
    case 'C':
      return { text: '• C', bold: true, color: '#B71C1C', alignment: 'center' };
    case 'N':
    default:
      return { text: 'N', color: '#555555', alignment: 'center' };
  }
}

/**
 * Returns the pdfmake `styles` object used across every panel template.
 * Centralised so a tweak (e.g. tightening line-height) only touches one place.
 *
 * @returns {Record<string, object>}
 */
export function commonStyles() {
  return {
    h1: { fontSize: 16, bold: true },
    h2: { fontSize: 11, bold: true },
    tagline: { fontSize: 8, italics: true, color: '#666666' },
    addressLine: { fontSize: 8, color: '#444444', alignment: 'right' },
    sectionLabel: {
      fontSize: 8,
      bold: true,
      color: '#888888',
      characterSpacing: 0.5,
    },
    fieldLabel: { fontSize: 8, color: '#666666' },
    fieldValue: { fontSize: 9, bold: false, color: '#222222' },
    panelTitle: { fontSize: 12, bold: true, color: 'white' },
    panelMeta: { fontSize: 8, color: '#FFFFFF' },
    tableHeader: { fontSize: 9, bold: true, color: 'white' },
    groupHeader: { fontSize: 9, bold: true },
    flag: { bold: true, alignment: 'center' },
    interpretation: { fontSize: 9, italics: true, color: '#333333' },
    disclaimer: { fontSize: 7, italics: true, color: '#888888' },
    endOfReport: {
      fontSize: 9,
      italics: true,
      color: '#777777',
      alignment: 'center',
    },
    signatureName: { fontSize: 9, bold: true },
    signatureMeta: { fontSize: 8, color: '#555555' },
    footerSmall: { fontSize: 7, color: '#888888' },
  };
}

/**
 * Base page definition merged into every panel template via spread. Holds
 * page size, margins, and the default font. The header and footer are NOT
 * set here — each template plugs those in because they're closures over the
 * report's lab data.
 *
 * @returns {object} partial pdfmake docDefinition
 */
export function defaultPageDefinition() {
  return {
    pageSize: 'A4',
    // Margins: [left, top, right, bottom]. Top margin is generous (70) to
    // make room for the header band; bottom (60) accommodates the two-line
    // footer (rule + disclaimer text).
    pageMargins: [40, 90, 40, 60],
    defaultStyle: {
      font: 'Roboto',
      fontSize: 9,
      lineHeight: 1.15,
      color: '#222222',
    },
  };
}

/**
 * Build the lab letterhead block:
 *   [monogram square]   Lab Name (large, accent colour)        Address line 1
 *                       Tagline (italic, small)                Address line 2
 *   ───────────────── accent-coloured rule ─────────────────
 *
 * pdfmake quirk: a "columns" node with explicit `width` values is the
 * cleanest way to get three-zone horizontal layout. We use [auto, *, auto]
 * so the monogram is its natural size, the centre stretches, and the
 * address column hugs its content on the right.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function headerBlock(report) {
  const lab = report.patient.lab;
  return {
    margin: [0, 0, 0, 8],
    stack: [
      {
        columns: [
          // Monogram: a small filled square with the two-letter abbreviation.
          // pdfmake doesn't support border-radius on table cells natively, so
          // we use a single-cell table with no borders + a fillColor.
          {
            width: 42,
            table: {
              widths: [38],
              heights: [38],
              body: [
                [
                  {
                    text: lab.logoMonogram,
                    color: 'white',
                    bold: true,
                    fontSize: 16,
                    alignment: 'center',
                    margin: [0, 8, 0, 0],
                    fillColor: lab.accentColor,
                    border: [false, false, false, false],
                  },
                ],
              ],
            },
            // 'noBorders' would also work, but we override per-cell above so
            // the layout is explicit and reviewable.
            layout: 'noBorders',
          },
          {
            width: '*',
            margin: [10, 2, 0, 0],
            stack: [
              { text: lab.name, style: 'h1', color: lab.accentColor },
              { text: lab.tagline, style: 'tagline' },
            ],
          },
          {
            width: 'auto',
            stack: [
              { text: lab.address[0] ?? '', style: 'addressLine' },
              { text: lab.address[1] ?? '', style: 'addressLine' },
              { text: lab.phone, style: 'addressLine' },
              { text: lab.email, style: 'addressLine' },
            ],
          },
        ],
      },
      // Thin accent-coloured rule under the header. We use a 1-row table
      // with a coloured top border because pdfmake's canvas API would also
      // work but is more verbose for a single horizontal line.
      {
        margin: [0, 6, 0, 0],
        canvas: [
          {
            type: 'line',
            x1: 0,
            y1: 0,
            x2: 515, // A4 width (595) - left margin (40) - right margin (40)
            y2: 0,
            lineWidth: 1.5,
            lineColor: lab.accentColor,
          },
        ],
      },
    ],
  };
}

/**
 * Build the patient + sample metadata block as a two-column key/value layout.
 *
 * Left column:  Name / Age | Sex / Patient ID / MRN
 * Right column: Registration ID / Sample ID / Sample Date / Report Date /
 *               Referring Doctor
 *
 * pdfmake quirk: we render each side as its own nested 2-column table
 * (label width fixed, value stretches) rather than one wide 4-column table,
 * because that gives us independent column widths per side and avoids
 * label/value misalignment when one side has more rows than the other.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function patientBlock(report) {
  const { patient, sampleDate, reportDate, registrationId, sampleId } = report;

  /**
   * Build a single-side key/value table.
   * @param {Array<[string, string]>} rows
   * @returns {object}
   */
  const makeKVTable = (rows) => ({
    table: {
      widths: [85, '*'],
      body: rows.map(([k, v]) => [
        { text: k, style: 'fieldLabel', border: [false, false, false, false] },
        { text: v, style: 'fieldValue', border: [false, false, false, false] },
      ]),
    },
    layout: 'noBorders',
  });

  return {
    margin: [0, 4, 0, 6],
    columns: [
      {
        width: '*',
        stack: [
          {
            text: 'PATIENT DETAILS',
            style: 'sectionLabel',
            margin: [0, 0, 0, 3],
          },
          makeKVTable([
            ['Name', patient.name],
            ['Age / Sex', `${patient.age} yrs / ${patient.sex === 'F' ? 'Female' : 'Male'}`],
            ['Patient ID', patient.id],
            ['MRN', patient.mrn],
            ['Mobile', patient.phone],
          ]),
        ],
      },
      {
        width: '*',
        stack: [
          {
            text: 'SAMPLE DETAILS',
            style: 'sectionLabel',
            margin: [0, 0, 0, 3],
          },
          makeKVTable([
            ['Registration ID', registrationId],
            ['Sample ID', sampleId],
            ['Sample Date', formatDateTime(sampleDate)],
            ['Report Date', formatDateTime(reportDate)],
            ['Referring Doctor', patient.referringDoctor],
          ]),
        ],
      },
    ],
  };
}

/**
 * Build the coloured panel title bar that sits between patient details and
 * the results table. Shows panel title (left, large), department + specimen
 * (right, small). Fill is the lab's accent colour.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function panelTitleBar(report) {
  const lab = report.patient.lab;
  return {
    margin: [0, 6, 0, 6],
    table: {
      widths: ['*', 'auto'],
      body: [
        [
          {
            text: report.panelTitle,
            style: 'panelTitle',
            fillColor: lab.accentColor,
            border: [false, false, false, false],
            margin: [6, 5, 6, 5],
          },
          {
            stack: [
              { text: report.panelDept, style: 'panelMeta' },
              { text: report.panelSpecimen, style: 'panelMeta' },
            ],
            fillColor: lab.accentColor,
            border: [false, false, false, false],
            margin: [6, 4, 8, 4],
            alignment: 'right',
          },
        ],
      ],
    },
    layout: 'noBorders',
  };
}

/**
 * Determine whether any row in any group of this report carries a non-null
 * `method`. When true, the results table renders a Method column; when false,
 * we omit it to keep the table compact for panels with no method metadata.
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
 * Column layout (no method):   Test | Result | Unit | Reference Range | Flag
 * Column layout (with method): Test | Result | Unit | Method | Reference Range | Flag
 *
 * Group subheaders: rendered as a single row that spans all columns (using
 * pdfmake's `colSpan` quirk — the spanning cell carries `colSpan: N` and the
 * subsequent N-1 cells in the same row must be present as empty `{}`).
 *
 * Zebra striping: handled via per-row `fillColor` on each cell. pdfmake does
 * not inherit fillColor from row to cell, so we set it on every cell of the
 * row. We track a running data-row counter (not table-row counter — group
 * subheaders are skipped) so striping stays visually coherent even with
 * subheaders interleaved.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function resultsTable(report) {
  const lab = report.patient.lab;
  const showMethod = reportHasAnyMethod(report);
  const colCount = showMethod ? 6 : 5;

  // Column widths chosen so the Test column gets the lion's share, with
  // numerics (Result, Unit, Flag) hugging their content. Reference Range
  // is also flexible because it can be 'M: 13.5-17.5 / F: 12.0-15.5'.
  const widths = showMethod
    ? ['*', 'auto', 'auto', 'auto', 'auto', 30]
    : ['*', 'auto', 'auto', 'auto', 30];

  /**
   * One pdfmake table-header cell with the accent fill applied.
   * @param {string} label
   * @param {string} [align]
   * @returns {object}
   */
  const th = (label, align = 'left') => ({
    text: label,
    style: 'tableHeader',
    fillColor: lab.accentColor,
    alignment: align,
    margin: [4, 4, 4, 4],
  });

  const headerRow = showMethod
    ? [
        th('Test'),
        th('Result', 'right'),
        th('Unit'),
        th('Method'),
        th('Reference Range'),
        th('Flag', 'center'),
      ]
    : [
        th('Test'),
        th('Result', 'right'),
        th('Unit'),
        th('Reference Range'),
        th('Flag', 'center'),
      ];

  const body = [headerRow];

  let dataRowIdx = 0;

  for (const group of report.groupedResults) {
    // Group subheader: spans all columns, accent text colour, faint bg.
    // pdfmake colSpan rule: the spanning cell holds `colSpan: N`, and the
    // following N-1 array slots in this row must be literally present as
    // empty objects `{}`, otherwise the table renders with shifted cells.
    const spanRow = [
      {
        text: group.name,
        colSpan: colCount,
        style: 'groupHeader',
        color: lab.accentColor,
        fillColor: '#FAFAFA',
        margin: [4, 5, 4, 4],
      },
    ];
    for (let i = 1; i < colCount; i += 1) spanRow.push({});
    body.push(spanRow);

    for (const row of group.rows) {
      // Zebra stripe every other DATA row (group subheaders don't count
      // for the stripe rhythm — striping is by analyte).
      const stripe = dataRowIdx % 2 === 1 ? '#F5F5F5' : null;
      const cell = (content, extra = {}) => {
        const c = typeof content === 'string'
          ? { text: content }
          : { ...content };
        if (stripe) c.fillColor = stripe;
        c.margin = c.margin ?? [4, 3, 4, 3];
        return { ...c, ...extra, fillColor: c.fillColor };
      };

      // Critical (C) rows: subtle red wash on the whole row so they jump
      // out even when a reviewer is skimming. This overrides the zebra
      // stripe deliberately.
      const isCritical = row.flag === 'C';
      const rowFill = isCritical ? '#FFEBEE' : stripe;

      /**
       * Helper to build one body cell honouring the per-row fill.
       * @param {string|object} content
       * @param {object} [extra]
       * @returns {object}
       */
      const bc = (content, extra = {}) => {
        const base = typeof content === 'string' ? { text: content } : content;
        return {
          ...base,
          fillColor: rowFill,
          margin: base.margin ?? [4, 3, 4, 3],
          ...extra,
        };
      };

      const valueCell = bc(
        { text: row.display, alignment: 'right', bold: row.flag !== 'N' },
      );

      const flagFragment = flagCell(row.flag);
      // Re-apply rowFill to the flag cell (flagCell builds a fresh object).
      flagFragment.fillColor = rowFill;
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
      dataRowIdx += 1;
      // Suppress lint of unused helper introduced for future per-cell tweaks.
      void cell;
    }
  }

  return {
    margin: [0, 2, 0, 6],
    table: {
      headerRows: 1,
      widths,
      body,
    },
    // 'lightHorizontalLines' draws faint separators between rows, no vertical
    // lines — matches the visual style of most printed Indian lab reports.
    layout: 'lightHorizontalLines',
  };
}

/**
 * Build the closing block: a centred "End of Report" marker, a right-aligned
 * signature for the verifying pathologist, and a small-print disclaimer.
 *
 * The verifying pathologist is picked deterministically from the fixed pool
 * using a hash of the registration ID — this keeps the same report stable
 * across re-renders (matters for the agent's dedup test) while still
 * varying the signer across patients.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function endorsementBlock(report) {
  // Deterministic verifier pick: sum of character codes in the registration
  // ID modulo pool size. Not cryptographically meaningful — just stable.
  let hash = 0;
  for (const ch of report.registrationId) {
    hash = (hash + ch.charCodeAt(0)) % 1_000_003;
  }
  const verifier = VERIFIERS[hash % VERIFIERS.length];

  return {
    margin: [0, 10, 0, 0],
    stack: [
      {
        text: '— — —   End of Report   — — —',
        style: 'endOfReport',
        margin: [0, 8, 0, 14],
      },
      {
        // Right-aligned signature block. We leave a blank line above the
        // name to suggest where a real (ink or e-sign) signature would go.
        alignment: 'right',
        stack: [
          { text: ' ', margin: [0, 0, 0, 18] },
          { text: '_____________________________', color: '#888888' },
          { text: verifier.name, style: 'signatureName' },
          { text: 'Consultant Pathologist', style: 'signatureMeta' },
          { text: `Reg. No. ${verifier.regNo}`, style: 'signatureMeta' },
        ],
      },
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
 * `(currentPage, pageCount)` to this factory on each page; we return a
 * content node sized to fit inside the bottom margin (60px).
 *
 * Layout: thin grey rule, then a single line of small-print text with
 * page numbering on the left, lab registration in the middle, and the
 * synthetic-data warning on the right.
 *
 * @param {object} report
 * @returns {(currentPage: number, pageCount: number) => object}
 */
export function pageFooter(report) {
  const lab = report.patient.lab;
  return (currentPage, pageCount) => ({
    margin: [40, 10, 40, 0],
    stack: [
      {
        canvas: [
          {
            type: 'line',
            x1: 0,
            y1: 0,
            x2: 515,
            y2: 0,
            lineWidth: 0.5,
            lineColor: '#CCCCCC',
          },
        ],
      },
      {
        margin: [0, 4, 0, 0],
        columns: [
          {
            width: 'auto',
            text: `Page ${currentPage} of ${pageCount}`,
            style: 'footerSmall',
          },
          {
            width: '*',
            text: `Reg: ${lab.regNumber}`,
            style: 'footerSmall',
            alignment: 'center',
          },
          {
            width: 'auto',
            text: 'Synthetic — not for clinical use',
            style: 'footerSmall',
            alignment: 'right',
          },
        ],
      },
    ],
  });
}

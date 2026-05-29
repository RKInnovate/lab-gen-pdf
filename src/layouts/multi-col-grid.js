/**
 * Layout: Multi-Column Grid Form.
 *
 * # Purpose
 * The "diagnostic-chain dense print" layout (Dr. Lal PathLabs / Thyrocare /
 * Metropolis aesthetic). The signature property is **information density**:
 * everything is packed onto a single A4 sheet at the smallest readable
 * fontSize in the suite (7.5pt default, 5.5pt section labels), and the
 * results table is rendered as a TWO-COLUMN flow of analyte cells rather
 * than the conventional one-row-per-analyte layout — halving the vertical
 * footprint of the body. Implements layout #5 of the 8-layout system.
 *
 * # Role in the pipeline
 *   generators/* ──▶ Report (with .layoutKey='multi-col-grid') ──▶ panel template
 *                                                                    │
 *                                                                    └─uses─▶ layouts/multi-col-grid.js (this file)
 *                                                                              │
 *                                                                              └─emits─▶ pdfmake docDefinition
 *
 * # Layout interface — 10 exports (contract shared with corporate-clean.js)
 *   formatDate(d)                   → string
 *   formatDateTime(d)               → string
 *   commonStyles()                  → pdfmake styles object
 *   defaultPageDefinition()         → partial docDefinition
 *   headerBlock(report)             → pdfmake content node
 *   patientBlock(report)            → pdfmake content node — 3-col x 5-row grid
 *   panelTitleBar(report)           → pdfmake content node — single accent bar
 *   resultsTable(report)            → pdfmake content node — 2-col analyte flow
 *   endorsementBlock(report)        → pdfmake content node
 *   pageFooter(report)              → (page, total) => content node
 *
 * # Design decisions (density-driven)
 * - Default fontSize 7.5 (smallest in the suite). Sub-labels 5.5pt UPPERCASE.
 * - Page margins are aggressively tight ([28, 55, 28, 45]) — the available
 *   content width on A4 (595pt) is 595 - 28 - 28 = 539pt. All canvas rules
 *   in this layout use that width.
 * - The patient grid is a 3-column block with 15 cells (5 rows × 3 cols)
 *   rendered via a pdfmake `table` (not nested `columns`) because table cells
 *   can carry a `fillColor` AND be aligned in a strict grid, which nested
 *   `columns` can't guarantee when content heights differ.
 * - The results table uses a 2-column outer table; each cell contains a
 *   `stack` of {name+unit, value, range, flag-badge}. pdfmake DOES allow
 *   `stack` inside a table cell — verified, no gotcha here. The flag badge
 *   is itself a single-cell table with a fillColor so it visually reads as
 *   a coloured pill rather than plain coloured text.
 * - Group sub-headers are rendered as a row that spans both result columns
 *   via `colSpan: 2` + the obligatory empty `{}` follower cell (pdfmake's
 *   well-known colSpan rule — the spanning cell carries colSpan and the
 *   subsequent N-1 array slots must be present as empty objects).
 * - Analytes are paired into rows greedily in document order. If a group
 *   has an odd number of analytes, the last row's right cell is an empty
 *   `{}` placeholder so the table grid stays rectangular.
 * - Default font is Roboto (the only font pdfmake's bundled VFS ships).
 */

/**
 * Fixed pool of fictitious consultant pathologist names + registration
 * numbers used by `endorsementBlock`. Local to this layout (parallel to
 * corporate-clean's pool) so the two layouts can diverge independently
 * later — e.g. if we want regional consultants per layout style.
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
 * Two-digit zero-padded helper. Inlined (no date library) to honour the
 * "no new dependencies" rule from CLAUDE.md and to keep date output
 * locale-independent (deterministic same-seed-same-bytes property).
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
 * A4 content width at this layout's tight margins: 595 - 28 - 28 = 539.
 * Hoisted because several canvas rules and full-width bars reference it.
 *
 * @type {number}
 */
const CONTENT_WIDTH = 539;

/**
 * Format a Date as `26-May-2026`. Hand-rolled to avoid `toLocaleDateString`'s
 * locale-dependent output — must be byte-identical across CI Linux and
 * developer macOS to preserve the deterministic-output property.
 *
 * @param {Date} d
 * @returns {string}
 */
export function formatDate(d) {
  return `${pad2(d.getDate())}-${MONTH_ABBREV[d.getMonth()]}-${d.getFullYear()}`;
}

/**
 * Format a Date as `26-May-2026  14:30 IST`. The literal `IST` suffix matches
 * the corporate-clean layout — all our synthetic patients are Indian.
 *
 * @param {Date} d
 * @returns {string}
 */
export function formatDateTime(d) {
  return `${formatDate(d)}  ${pad2(d.getHours())}:${pad2(d.getMinutes())} IST`;
}

/**
 * Build a tiny flag pill (single-cell zero-border table with a fillColor)
 * used inside each analyte cell. H/L/C render on red, N on green; all white
 * 6pt bold. Returns a `table` (not text) because that's the only way to get
 * a coloured rounded-ish background around a single character in pdfmake
 * without dropping to the canvas API.
 *
 * @param {'N'|'H'|'L'|'C'} flag
 * @returns {object} pdfmake content node
 */
function flagBadge(flag) {
  // 'C' rolls into the same red-fill family as H/L — the badge alone can't
  // express "critical vs. high" because we only have ~8pt of horizontal
  // budget. The full-cell wash (see resultsTable) carries that signal.
  const isAbnormal = flag === 'H' || flag === 'L' || flag === 'C';
  const fill = isAbnormal ? '#C62828' : '#2E7D32';
  return {
    table: {
      widths: [8],
      heights: [7],
      body: [
        [
          {
            text: flag,
            color: 'white',
            bold: true,
            fontSize: 6,
            alignment: 'center',
            fillColor: fill,
            border: [false, false, false, false],
            margin: [0, 0.5, 0, 0],
          },
        ],
      ],
    },
    layout: 'noBorders',
  };
}

/**
 * Returns the pdfmake `styles` object used by this layout's panel templates.
 * Every size is deliberately small — this is the dense-print look.
 *
 * @returns {Record<string, object>}
 */
export function commonStyles() {
  return {
    // Header
    labName: { fontSize: 12, bold: true },
    labTagline: { fontSize: 7, italics: true, color: '#666666' },
    addressLine: { fontSize: 7, color: '#444444', alignment: 'right', lineHeight: 1.1 },

    // Patient grid
    gridLabel: {
      fontSize: 5.5,
      bold: true,
      color: '#666666',
      characterSpacing: 0.4,
    },
    gridValue: { fontSize: 7.5, color: '#222222' },

    // Panel bar
    panelTitle: { fontSize: 8, bold: true, color: 'white' },
    panelMeta: { fontSize: 8, bold: true, color: 'white' },

    // Results
    analyteName: { fontSize: 7, bold: true, color: '#222222' },
    analyteValue: { fontSize: 9, bold: true, color: '#222222' },
    analyteRange: { fontSize: 6.5, italics: true, color: '#666666' },
    groupBar: { fontSize: 7.5, bold: true },

    // Endorsement
    endorseLine: { fontSize: 7, italics: true, color: '#555555' },
    disclaimerTiny: { fontSize: 5.5, italics: true, color: '#888888' },

    // Footer
    footerTiny: { fontSize: 6, color: '#888888' },
  };
}

/**
 * Base page definition: A4 with aggressively tight margins and a 7.5pt
 * default font. The render template merges header/footer onto this.
 *
 * @returns {object} partial pdfmake docDefinition
 */
export function defaultPageDefinition() {
  return {
    pageSize: 'A4',
    // [left, top, right, bottom]. Top (55) is just enough for the single-row
    // header band; bottom (45) covers footer rule + page-number line.
    pageMargins: [28, 55, 28, 45],
    defaultStyle: {
      font: 'Roboto',
      fontSize: 7.5,
      lineHeight: 1.15,
      color: '#222222',
    },
  };
}

/**
 * Build the lab letterhead as a single-row 3-zone band:
 *   [monogram tile] [lab name + tagline]                [address / phone]
 *
 * Monogram is a 28x28 accent-coloured square (single-cell borderless table
 * with a fillColor — same trick as corporate-clean but at a smaller size).
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function headerBlock(report) {
  const lab = report.patient.lab;

  return {
    margin: [0, 0, 0, 4],
    columns: [
      // Zone 1: monogram tile, 28pt square.
      {
        width: 30,
        table: {
          widths: [28],
          heights: [28],
          body: [
            [
              {
                text: lab.logoMonogram,
                color: 'white',
                bold: true,
                fontSize: 13,
                alignment: 'center',
                margin: [0, 6, 0, 0],
                fillColor: lab.accentColor,
                border: [false, false, false, false],
              },
            ],
          ],
        },
        layout: 'noBorders',
      },
      // Zone 2: lab name + tagline, hugging the monogram.
      {
        width: '*',
        margin: [6, 2, 0, 0],
        stack: [
          { text: lab.name, style: 'labName', color: lab.accentColor },
          { text: lab.tagline, style: 'labTagline' },
        ],
      },
      // Zone 3: address block right-aligned. Three lines (addr1, addr2, phone)
      // at 7pt with tight 1.1 line-height — see styles.addressLine.
      {
        width: 'auto',
        stack: [
          { text: lab.address[0] ?? '', style: 'addressLine' },
          { text: lab.address[1] ?? '', style: 'addressLine' },
          { text: lab.phone, style: 'addressLine' },
        ],
      },
    ],
  };
}

/**
 * Build the patient + sample metadata block as a 3-COLUMN x 5-ROW grid
 * (15 cells total). The 9 native report fields are padded with 6 lab-form
 * placeholders (referring doctor, fasting state, sample condition, etc.)
 * to fill the grid — typical of dense lab forms which always print every
 * possible field even when blank.
 *
 * Implementation: a single pdfmake `table` with 3 equal-width columns and
 * 5 rows. Each cell is a `stack` of [tiny uppercase label, value]. The
 * whole table sits on a light-grey fill (`#F4F4F4`) achieved by setting
 * `fillColor` on every cell; pdfmake does NOT inherit fillColor from row
 * to cell, so per-cell is the only reliable path. Thin white "gutters"
 * between columns are achieved via the default `noBorders` layout + the
 * uniform fillColor leaving the table's intrinsic 2pt cell padding as
 * white space.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function patientBlock(report) {
  const { patient, sampleDate, reportDate, registrationId, sampleId } = report;

  // Three columns, defined explicitly so they can have different
  // lengths. The identity column carries the new Mobile field, making
  // it one row longer than the other two; the reshape below pads the
  // short columns with empty cells. Placeholders mirror typical Indian
  // lab form fields so the grid looks lived-in rather than half-empty.
  const identityCol = [
    ['Patient Name', patient.name],
    ['Age / Sex', `${patient.age} Y / ${patient.sex === 'F' ? 'F' : 'M'}`],
    ['Patient ID', patient.id],
    ['MRN', patient.mrn],
    ['Mobile', patient.phone],
    ['Referring Dr.', patient.referringDoctor],
  ];
  const sampleCol = [
    ['Registration ID', registrationId],
    ['Sample ID', sampleId],
    ['Sample Date', formatDateTime(sampleDate)],
    ['Report Date', formatDateTime(reportDate)],
    ['Collected By', 'Phlebotomy Desk'],
  ];
  const stateCol = [
    ['Fasting Status', 'Not Specified'],
    ['Sample Condition', 'Satisfactory'],
    ['Specimen Type', report.panelSpecimen],
    ['Department', report.panelDept],
    ['Report Status', 'Final'],
  ];
  const columns = [identityCol, sampleCol, stateCol];

  /**
   * Build one stacked label/value cell with the shared grey fill.
   * @param {string} label
   * @param {string} value
   * @returns {object}
   */
  const cell = (label, value) => ({
    stack: [
      { text: label.toUpperCase(), style: 'gridLabel' },
      { text: value, style: 'gridValue', margin: [0, 1, 0, 0] },
    ],
    fillColor: '#F4F4F4',
    border: [false, false, false, false],
    margin: [3, 2, 3, 2],
  });

  // Reshape the three column arrays into rows, one cell per column.
  // The row count is the longest column; a column that runs out of
  // fields contributes an empty cell. Empty cells are invisible under
  // the borderless layout, so the ragged tail reads as a clean grid.
  const rowCount = Math.max(...columns.map((col) => col.length));
  const body = [];
  for (let r = 0; r < rowCount; r += 1) {
    body.push(
      columns.map((col) => (col[r] ? cell(col[r][0], col[r][1]) : {})),
    );
  }

  return {
    margin: [0, 4, 0, 4],
    table: {
      widths: ['*', '*', '*'],
      body,
    },
    layout: 'noBorders',
  };
}

/**
 * Build the panel title bar — a single accent-coloured row, ~18pt tall.
 * `{panelTitle}` left, `{panelDept} · {panelSpecimen}` right, both white 8pt
 * bold. Two-cell table with shared accent fillColor.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function panelTitleBar(report) {
  const lab = report.patient.lab;
  return {
    margin: [0, 3, 0, 3],
    table: {
      widths: ['*', 'auto'],
      heights: [12],
      body: [
        [
          {
            text: report.panelTitle,
            style: 'panelTitle',
            fillColor: lab.accentColor,
            border: [false, false, false, false],
            margin: [5, 3, 5, 3],
          },
          {
            text: `${report.panelDept} · ${report.panelSpecimen}`,
            style: 'panelMeta',
            fillColor: lab.accentColor,
            border: [false, false, false, false],
            margin: [5, 3, 6, 3],
            alignment: 'right',
          },
        ],
      ],
    },
    layout: 'noBorders',
  };
}

/**
 * Build the results body as a 2-column flow of analyte cells.
 *
 * Outer structure: a pdfmake `table` with `widths: ['*', '*']`. Group
 * sub-headers appear as a full-width row (`colSpan: 2` + empty `{}` follower
 * — pdfmake's required convention). Analytes inside a group are paired
 * left-then-right in document order; an odd analyte at the tail leaves the
 * right cell as an empty `{}` placeholder so the grid stays rectangular.
 *
 * Each analyte cell is a `stack` of four elements:
 *   1. name (unit)    — bold 7pt
 *   2. value          — 9pt bold (largest text in body)
 *   3. (rangeDisplay) — italic 6.5pt grey
 *   4. flag badge     — tiny coloured pill, see `flagBadge`
 *
 * pdfmake note: `stack` inside a table cell works correctly. The flag-badge
 * sub-table inside a stack inside the outer table cell is three levels of
 * nesting — verified to render without overflow as long as the badge's
 * fixed width (8pt) leaves enough room for the parent cell's content.
 *
 * Critical (`C`) flagged rows get a faint red cell-wash so they jump out
 * even though the flag pill itself is the same red as H/L. We track flag
 * per-cell and apply the wash directly on the cell's fillColor.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function resultsTable(report) {
  const lab = report.patient.lab;

  /**
   * Build the inner stack representing one analyte cell. Returns the cell
   * object directly (not just its contents) because we need to set
   * `fillColor` and `border` at the cell level.
   * @param {object} row
   * @returns {object} pdfmake table cell
   */
  const analyteCell = (row) => {
    const isCritical = row.flag === 'C';
    return {
      stack: [
        // Line 1: name + unit. Unit in parentheses keeps the line short.
        {
          text: [
            { text: row.name, style: 'analyteName' },
            { text: row.unit ? `  (${row.unit})` : '', fontSize: 6.5, color: '#888888' },
          ],
        },
        // Line 2: value (largest font in body — the number is what the
        // reader's eye should land on first).
        { text: row.display, style: 'analyteValue', margin: [0, 1, 0, 0] },
        // Line 3: reference range (faint italic). Falls back to em-dash
        // if the analyte carries no range (rare but possible).
        {
          text: `(${row.rangeDisplay || '—'})`,
          style: 'analyteRange',
        },
        // Line 4: tiny flag pill, left-aligned under the range.
        { ...flagBadge(row.flag), margin: [0, 1, 0, 0] },
      ],
      // Hairline border between cells — 0.25pt is the thinnest pdfmake will
      // render at print scale without disappearing.
      border: [true, true, true, true],
      borderColor: ['#DDDDDD', '#DDDDDD', '#DDDDDD', '#DDDDDD'],
      margin: [4, 3, 4, 3],
      // Critical wash: subtle red so the cell stands out at a glance.
      fillColor: isCritical ? '#FFEBEE' : null,
    };
  };

  const body = [];

  for (const group of report.groupedResults) {
    // Group sub-header: full-width bar spanning both result columns.
    // pdfmake colSpan rule — the spanning cell carries colSpan and the
    // subsequent N-1 array slots must be present as empty `{}`.
    body.push([
      {
        text: group.name,
        colSpan: 2,
        style: 'groupBar',
        color: lab.accentColor,
        fillColor: '#FAFAFA',
        margin: [4, 3, 4, 3],
        // Bottom-only border = faint accent underline beneath the group bar.
        border: [false, false, false, true],
        borderColor: [null, null, null, lab.accentColor],
      },
      {},
    ]);

    // Pair analytes left-then-right in document order.
    for (let i = 0; i < group.rows.length; i += 2) {
      const left = analyteCell(group.rows[i]);
      // Empty placeholder cell when the group has an odd number of analytes
      // and we're at the tail — keeps the table grid rectangular. The empty
      // cell still draws its borders (border:[true,...]) so the visual grid
      // remains uniform; a literal `{}` would skip borders and create a hole.
      const right = group.rows[i + 1]
        ? analyteCell(group.rows[i + 1])
        : {
            text: '',
            border: [true, true, true, true],
            borderColor: ['#DDDDDD', '#DDDDDD', '#DDDDDD', '#DDDDDD'],
            margin: [4, 3, 4, 3],
          };
      body.push([left, right]);
    }
  }

  return {
    margin: [0, 2, 0, 4],
    table: {
      widths: ['*', '*'],
      body,
    },
    // Custom layout: we already drew per-cell hairline borders in
    // `analyteCell`, so the table-level layout must NOT add another set on
    // top (which would render at 1pt and look heavy). Returning zero-width
    // lines for every separator hands all border control to the cells.
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  };
}

/**
 * Build the closing endorsement block as a compact 3-column row, plus a
 * faint disclaimer line beneath.
 *
 * Verifier is picked deterministically from the fixed pool using a hash of
 * `report.registrationId` — same scheme as corporate-clean so the same
 * report renders with the same verifier regardless of which layout is in
 * use (matters for the agent's dedup test which is keyed on bytes).
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function endorsementBlock(report) {
  // Deterministic verifier pick — sum-of-char-codes modulo pool size.
  // Not cryptographic; just stable across re-renders for the same report.
  let hash = 0;
  for (const ch of report.registrationId) {
    hash = (hash + ch.charCodeAt(0)) % 1_000_003;
  }
  const verifier = VERIFIERS[hash % VERIFIERS.length];

  return {
    margin: [0, 6, 0, 0],
    stack: [
      // 3-column compact endorsement row.
      {
        columns: [
          {
            width: '*',
            text: `Authorised Signatory: ${verifier.name}`,
            style: 'endorseLine',
          },
          {
            width: 'auto',
            text: `Reg: ${verifier.regNo}`,
            style: 'endorseLine',
            alignment: 'center',
            margin: [8, 0, 8, 0],
          },
          {
            width: 'auto',
            text: `Verified at ${pad2(report.reportDate.getHours())}:${pad2(report.reportDate.getMinutes())} on ${formatDate(report.reportDate)}`,
            style: 'endorseLine',
            alignment: 'right',
          },
        ],
      },
      // Faint disclaimer line beneath, 5.5pt — present-but-not-prominent.
      {
        margin: [0, 4, 0, 0],
        text:
          'DISCLAIMER: Synthetic test data generated by lab-pdf-gen for the '
          + 'LabSense agent test bench. Not a real patient, sample, or '
          + 'clinical finding. Not for diagnosis or treatment. All names, '
          + 'IDs and laboratory brandings are fictitious.',
        style: 'disclaimerTiny',
      },
    ],
  };
}

/**
 * Build the page footer factory consumed by pdfmake. The footer is a single
 * 6pt row with a 0.25pt accent-coloured rule directly above it:
 *   ──── thin accent rule ────
 *   {lab.name}             Page X of Y             Reg ID: {regNumber}
 *
 * pdfmake invokes this factory with `(currentPage, pageCount)` on every
 * page; we return a content node sized to fit inside the 45pt bottom margin.
 *
 * @param {object} report
 * @returns {(currentPage: number, pageCount: number) => object}
 */
export function pageFooter(report) {
  const lab = report.patient.lab;
  return (currentPage, pageCount) => ({
    // Left margin must match the page's left margin (28) so the rule and
    // text align with the rest of the page. Same on the right.
    margin: [28, 6, 28, 0],
    stack: [
      {
        canvas: [
          {
            type: 'line',
            x1: 0,
            y1: 0,
            x2: CONTENT_WIDTH,
            y2: 0,
            lineWidth: 0.25,
            lineColor: lab.accentColor,
          },
        ],
      },
      {
        margin: [0, 3, 0, 0],
        columns: [
          {
            width: '*',
            text: lab.name,
            style: 'footerTiny',
          },
          {
            width: 'auto',
            text: `Page ${currentPage} of ${pageCount}`,
            style: 'footerTiny',
            alignment: 'center',
            margin: [8, 0, 8, 0],
          },
          {
            width: 'auto',
            text: `Reg ID: ${lab.regNumber}`,
            style: 'footerTiny',
            alignment: 'right',
          },
        ],
      },
    ],
  });
}

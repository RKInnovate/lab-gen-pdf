/**
 * Layout: Two-Column Compact.
 *
 * # Purpose
 * Screening-clinic / OPD-quick-print aesthetic — the goal is to fit a
 * whole CBC onto a single A4 page. This is layout #3 of the 8-layout
 * pluggable system and is the densest of the lot. Where
 * `corporate-clean.js` favours generous whitespace and a single
 * wide results table, this layout aggressively compresses every
 * region: tighter page margins, smaller default font (8 instead of 9),
 * a one-row patient strip rather than a two-side label/value grid,
 * and — the signature element — a TWO-COLUMN flow of dot-leader
 * result lines instead of a tabular grid.
 *
 * # Role in the pipeline
 *   generators/* ──▶ Report (layoutKey: 'two-col-compact') ──▶ panel template
 *                                                                │
 *                                                                └─uses─▶ this file
 *                                                                          │
 *                                                                          └─emits─▶ pdfmake docDefinition
 *
 * # Layout interface (every layout MUST export these — the contract is
 * shared with `corporate-clean.js` and consumed by panel templates):
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
 * - Tight margins `[32, 60, 32, 50]` and `defaultStyle.fontSize: 8` are the
 *   density knobs. `lineHeight: 1.1` is the tightest pdfmake renders without
 *   glyph clipping on Roboto.
 * - Header is a flat band (no monogram square) — lab name + tagline left,
 *   address/phone/email as a single inline row on the right. A 0.5pt accent
 *   rule sits under the whole header. Saving the monogram square buys ~30pt
 *   of vertical space, which is worth it for an OPD layout.
 * - Patient block: ONE horizontal strip, 6 cells, light grey
 *   (`#F8F8F8`) background, with thin vertical separators between cells but
 *   no outer border. pdfmake quirk: the cleanest way to get cell-only
 *   vertical rules is a custom `layout` function returning a `vLineWidth`
 *   that is 0.5 for *interior* lines and 0 for left/right (and all hLines).
 * - Panel title bar: minimalist — no fill, just `{panelTitle}` accent-bold
 *   on the left and `{panelDept} · {panelSpecimen}` italic on the right,
 *   on a single line, with a thin accent rule under.
 * - Results: rendered as TWO pdfmake columns. `groupedResults` is split by
 *   alternation (even-indexed groups → column A, odd-indexed → column B)
 *   so two visually-heavy groups don't pile on one side. Each row inside
 *   a column is a borderless 4-column table — `name | dots | result | flag`.
 *   The 4-col-table approach is chosen over `preserveLeadingSpaces` + a
 *   hand-built dot string because pdfmake's text-wrapping in `columns`
 *   makes the latter unreliable: a wrapped name would push the dots onto
 *   their own line, breaking the dot-leader illusion. The dots column is
 *   `*`-width so it always exactly fills the gap between name and result
 *   regardless of the half-width of the parent column.
 * - Endorsement: compact 2-line block right-aligned. Disclaimer is a single
 *   italic sentence (versus corporate-clean's 5-line paragraph).
 * - Footer: a single small centred line — `lab-name · page X/Y · synthetic
 *   test data · reg: {regNumber}`.
 * - Verifier pick: deterministic from `report.registrationId` using the
 *   same hash recipe as `corporate-clean.js`, so the same report rendered
 *   in either layout reports the same signer.
 */

/**
 * Fixed pool of fictitious consultant pathologist names + registration
 * numbers. Intentionally identical to `corporate-clean.js`'s pool so a
 * single report rendered through either layout endorses the same verifier
 * (the deterministic pick keys on `report.registrationId` and pool length;
 * matching pools => matching pick).
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
 * Two-digit zero-pad helper used by the date formatters. Duplicated from
 * corporate-clean rather than imported because the layout files are
 * intentionally self-contained — each layout is a single-file unit so
 * future hand-tweaks to one layout's formatter (e.g. a 24h-only variant)
 * cannot leak into a sibling layout.
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
 * Format a Date as `26-May-2026`. We avoid `toLocaleDateString` so the
 * generator's "same seed ⇒ same bytes" determinism is preserved across
 * Linux CI and developer macOS hosts (locale-driven formatting otherwise
 * differs between them).
 *
 * @param {Date} d
 * @returns {string}
 */
export function formatDate(d) {
  return `${pad2(d.getDate())}-${MONTH_ABBREV[d.getMonth()]}-${d.getFullYear()}`;
}

/**
 * Format a Date as `26-May-2026  14:30 IST`. The literal `IST` suffix is
 * correct for our synthetic Indian patient cohort; we do not honour host TZ.
 *
 * @param {Date} d
 * @returns {string}
 */
export function formatDateTime(d) {
  return `${formatDate(d)}  ${pad2(d.getHours())}:${pad2(d.getMinutes())} IST`;
}

/**
 * Returns the pdfmake `styles` object for the compact layout. Sizes are
 * uniformly smaller than corporate-clean's because the whole layout is
 * tuned for density. `lineHeight: 1.1` is applied in `defaultPageDefinition`
 * rather than per-style so it cascades to every text node.
 *
 * @returns {Record<string, object>}
 */
export function commonStyles() {
  return {
    // Header zone
    labName: { fontSize: 14, bold: true },
    tagline: { fontSize: 7, italics: true, color: '#666666' },
    addressInline: { fontSize: 7, color: '#444444' },

    // Patient strip
    stripLabel: { fontSize: 6.5, color: '#888888', bold: true, characterSpacing: 0.4 },
    stripValue: { fontSize: 8, color: '#222222' },

    // Panel title bar
    panelTitle: { fontSize: 11, bold: true },
    panelMeta: { fontSize: 8, italics: true, color: '#555555' },

    // Results — dot-leader lines
    groupSubHeader: { fontSize: 7.5, bold: true, characterSpacing: 0.6 },
    resultName: { fontSize: 8, color: '#222222' },
    resultDots: { fontSize: 8, color: '#BBBBBB' },
    resultValue: { fontSize: 8, color: '#222222' },
    resultRange: { fontSize: 7, color: '#777777' },

    // Endorsement
    sigName: { fontSize: 8, bold: true },
    sigMeta: { fontSize: 7, color: '#555555' },
    disclaimer: { fontSize: 6.5, italics: true, color: '#999999' },

    // Footer
    footerSmall: { fontSize: 6.5, color: '#888888', alignment: 'center' },
  };
}

/**
 * Base page definition for the compact layout. The tight margins
 * `[32, 60, 32, 50]` and `fontSize: 8` (vs corporate-clean's 9) are the
 * primary density levers; `lineHeight: 1.1` is the tightest setting that
 * still renders Roboto without baseline clipping in pdfmake 0.2.x.
 *
 * @returns {object} partial pdfmake docDefinition
 */
export function defaultPageDefinition() {
  return {
    pageSize: 'A4',
    // [left, top, right, bottom] — top reserved for the (smaller) header,
    // bottom for the single-line footer.
    pageMargins: [32, 60, 32, 50],
    defaultStyle: {
      font: 'Roboto',
      fontSize: 8,
      lineHeight: 1.1,
      color: '#222222',
    },
  };
}

/**
 * Build the compact lab letterhead:
 *   Lab Name (left, accent bold)        Address · Phone · Email (right, inline)
 *   Tagline (left, italic small)
 *   ─────────── thin 0.5pt accent rule ───────────
 *
 * Content width: A4 (595pt) - left (32) - right (32) = 531pt.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function headerBlock(report) {
  const lab = report.patient.lab;

  // Address rendered as a single horizontal line. We join the
  // multi-line address array with a comma so it reads as one street
  // address, then append phone + email separated by a vertical bar
  // (matches the spec's example `123 Demo Lane, …  |  +91 …  |  reports@…`).
  const addressInline = [
    lab.address.join(', '),
    lab.phone,
    lab.email,
  ].join('  |  ');

  return {
    margin: [0, 0, 0, 6],
    stack: [
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: lab.name, style: 'labName', color: lab.accentColor },
              { text: lab.tagline, style: 'tagline' },
            ],
          },
          {
            // 'auto' right column hugs the address line. We add a tiny top
            // margin so the address sits visually aligned with the lab name
            // baseline rather than the cap height.
            width: 'auto',
            margin: [0, 4, 0, 0],
            text: addressInline,
            style: 'addressInline',
            alignment: 'right',
          },
        ],
      },
      // Thin 0.5pt accent rule under the whole header. Canvas API used
      // for the rule (rather than a 1-row table with a top border) because
      // canvas gives sub-pixel control over the line width — important
      // for "thin" at 0.5pt, where 1px tables would look too heavy.
      {
        margin: [0, 4, 0, 0],
        canvas: [
          {
            type: 'line',
            x1: 0,
            y1: 0,
            x2: 531,
            y2: 0,
            lineWidth: 0.5,
            lineColor: lab.accentColor,
          },
        ],
      },
    ],
  };
}

/**
 * Build the compact horizontal patient strip:
 *
 *   ┌─────────┬─────────┬─────────┬─────────┬─────────┬─────────┐
 *   │ Name    │ Age/Sex │ Pat. ID │ Reg     │ Sample  │ Doctor  │
 *   │ Sita... │ 34 / F  │ P0001   │ R0001   │ S0001   │ Dr. ... │
 *   └─────────┴─────────┴─────────┴─────────┴─────────┴─────────┘
 *
 * Light grey fill, no outer border, thin vertical separators between cells.
 *
 * pdfmake quirk: there is no per-cell control over which side gets a
 * border WHEN you also want a layout-level vLineWidth toggle. The cleanest
 * approach is a custom `layout` function that:
 *   - returns 0 for all hLines (top/bottom of every row)
 *   - returns 0 for the outer vLines (i === 0 || i === colCount)
 *   - returns 0.5 for interior vLines (between cells)
 * That gives us "vertical separators between cells, nothing else".
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function patientBlock(report) {
  const { patient, sampleDate, registrationId, sampleId } = report;

  /**
   * Build one cell in the strip. Each cell is a 2-line stack:
   * a small bold uppercase label, then the value.
   * @param {string} label
   * @param {string} value
   * @returns {object}
   */
  const cell = (label, value) => ({
    stack: [
      { text: label.toUpperCase(), style: 'stripLabel' },
      { text: value, style: 'stripValue', margin: [0, 1, 0, 0] },
    ],
    fillColor: '#F8F8F8',
    margin: [6, 4, 6, 4],
    border: [false, false, false, false],
  });

  const sexWord = patient.sex === 'F' ? 'F' : 'M';

  return {
    margin: [0, 4, 0, 6],
    table: {
      // Six equal-width cells. '*' lets pdfmake distribute the 531pt
      // content width evenly, so we don't hand-tune widths per cell.
      widths: ['*', '*', '*', '*', '*', '*'],
      body: [
        [
          cell('Name', patient.name),
          cell('Age / Sex', `${patient.age} / ${sexWord}`),
          cell('Patient ID', patient.id),
          cell('Reg', registrationId),
          cell('Sample', `${sampleId}  ${formatDate(sampleDate)}`),
          cell('Doctor', patient.referringDoctor),
        ],
      ],
    },
    // Custom layout: only interior vertical rules, no horizontal rules
    // anywhere, no outer border. `i` is the line index — for vLines that
    // means 0..colCount inclusive; we want 0.5 for 1..colCount-1.
    layout: {
      hLineWidth: () => 0,
      vLineWidth: (i, node) => {
        const colCount = node.table.widths.length;
        if (i === 0 || i === colCount) return 0;
        return 0.5;
      },
      vLineColor: () => '#DDDDDD',
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  };
}

/**
 * Build the minimalist panel title bar — `{panelTitle}` accent-bold on the
 * left, `{panelDept} · {panelSpecimen}` italic on the right, on a single
 * line, with a thin accent rule beneath. No fill, no padding — matches the
 * "screening clinic quick-print" aesthetic.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function panelTitleBar(report) {
  const lab = report.patient.lab;
  return {
    margin: [0, 2, 0, 4],
    stack: [
      {
        columns: [
          {
            width: '*',
            text: report.panelTitle,
            style: 'panelTitle',
            color: lab.accentColor,
          },
          {
            width: 'auto',
            text: `${report.panelDept}  ·  ${report.panelSpecimen}`,
            style: 'panelMeta',
            alignment: 'right',
            // Tiny top margin so the italic right-side aligns visually
            // with the bold-text baseline on the left.
            margin: [0, 2, 0, 0],
          },
        ],
      },
      {
        margin: [0, 3, 0, 0],
        canvas: [
          {
            type: 'line',
            x1: 0,
            y1: 0,
            x2: 531,
            y2: 0,
            lineWidth: 0.5,
            lineColor: lab.accentColor,
          },
        ],
      },
    ],
  };
}

/**
 * Map an analyte flag character to a pdfmake text node carrying the same
 * red/blue palette as `corporate-clean.flagCell`. We render flags inline
 * in the dot-leader row rather than as a dedicated column, so the node is
 * a plain text fragment — no `alignment` or `margin`.
 *
 * @param {'N'|'H'|'L'|'C'} flag
 * @returns {object} pdfmake text node (returns null-ish empty text for 'N'
 *   so the line stays clean for in-range results)
 */
function flagFragment(flag) {
  switch (flag) {
    case 'H':
      return { text: ' [H]', bold: true, color: '#C62828' };
    case 'L':
      return { text: ' [L]', bold: true, color: '#1565C0' };
    case 'C':
      return { text: ' [C]', bold: true, color: '#B71C1C' };
    case 'N':
    default:
      // Empty text for in-range so the dot-leader line ends cleanly at the
      // reference range. Returning empty text (vs null) keeps the parent
      // text-array structure uniform.
      return { text: '' };
  }
}

/**
 * Build a single dot-leader result row.
 *
 * Visual:
 *   Haemoglobin ········· 14.2 g/dL  (13.5 - 17.5) [H]
 *
 * Implementation note (the signature element):
 *   We use a borderless 4-column pdfmake table per row:
 *     col 1 (auto)  — test name
 *     col 2 ('*')   — dotted leader, filled to width
 *     col 3 (auto)  — `{value} {unit}  ({range})` + flag fragment
 *     col 4 (auto)  — kept empty as a tiny right-pad (helps when the row
 *                     sits in a narrow `columns` half, where pdfmake's
 *                     right-edge can clip a trailing flag bracket)
 *
 *   The `*`-width dots column expands to consume whatever gap remains
 *   between the auto-sized name on the left and the auto-sized value on
 *   the right. The dots themselves are produced by repeating the middle-dot
 *   character `·` enough times to comfortably overflow any half-page
 *   width; pdfmake clips overflow via `noWrap: true`, so we never see
 *   the dots wrap to a second line.
 *
 *   We chose this 4-col-table approach over `preserveLeadingSpaces` + a
 *   hand-built dot string because pdfmake's text-wrapping inside the
 *   parent `columns` layout makes the latter brittle: a long test name
 *   would force the dot string onto its own line, breaking the leader.
 *
 * @param {object} row — single entry of `group.rows`
 * @returns {object} pdfmake content node (a borderless 4-col table)
 */
function dotLeaderRow(row) {
  // 60 middle-dots is generous — wider than any half-page can render at
  // fontSize 8, so pdfmake will always clip rather than ever leave a gap.
  // The middle-dot (U+00B7) is preferred over a period because it sits
  // vertically centred on the line, which reads as a proper leader.
  const DOTS = '· '.repeat(60);

  // Compose the value side as a text-array so the flag (when present)
  // inherits the inline-flow of the value, and so the range fragment
  // can carry its own lighter colour without breaking layout.
  const valueText = [
    {
      text: row.display + (row.unit ? ` ${row.unit}` : ''),
      style: 'resultValue',
      bold: row.flag && row.flag !== 'N',
    },
    {
      text: `  (${row.rangeDisplay})`,
      style: 'resultRange',
    },
    flagFragment(row.flag),
  ];

  return {
    margin: [0, 0, 0, 1],
    table: {
      widths: ['auto', '*', 'auto', 2],
      body: [
        [
          {
            text: row.name,
            style: 'resultName',
            border: [false, false, false, false],
            noWrap: true,
            margin: [0, 0, 2, 0],
          },
          {
            text: DOTS,
            style: 'resultDots',
            border: [false, false, false, false],
            noWrap: true,
          },
          {
            text: valueText,
            border: [false, false, false, false],
            alignment: 'right',
            noWrap: true,
            margin: [2, 0, 0, 0],
          },
          // Empty right-pad cell — keeps the trailing flag bracket from
          // sitting flush against the column edge.
          { text: '', border: [false, false, false, false] },
        ],
      ],
    },
    layout: 'noBorders',
  };
}

/**
 * Build a column of group sub-blocks. Each group within the column gets a
 * small accent-coloured uppercase sub-header with a faint bottom rule,
 * followed by its rows as dot-leader lines.
 *
 * @param {Array<{name: string, rows: Array<object>}>} groups
 * @param {string} accentColor — `report.patient.lab.accentColor`
 * @returns {Array<object>} pdfmake content nodes ready to nest under a column
 */
function buildColumnStack(groups, accentColor) {
  const out = [];

  for (const group of groups) {
    // Group sub-header: small bold uppercase, accent-coloured, with a
    // faint bottom rule. We render the rule as a separate canvas node
    // (rather than border on the text) so the rule width matches the
    // column width regardless of how short the heading text is.
    out.push({
      text: group.name.toUpperCase(),
      style: 'groupSubHeader',
      color: accentColor,
      margin: [0, 4, 0, 1],
    });
    out.push({
      margin: [0, 0, 0, 2],
      canvas: [
        {
          type: 'line',
          x1: 0,
          y1: 0,
          // Half of content width (531/2 ≈ 265) minus a small inner gutter
          // (5pt). pdfmake's `columns` adds a default 5pt gap between
          // columns, so the rule should not span the whole 265.
          x2: 255,
          y2: 0,
          lineWidth: 0.25,
          lineColor: '#DDDDDD',
        },
      ],
    });

    for (const row of group.rows) {
      out.push(dotLeaderRow(row));
    }
  }

  return out;
}

/**
 * Build the results region as a TWO-COLUMN flow of dot-leader rows.
 *
 * Distribution rule: groups are split by index parity — even-indexed
 * groups (0, 2, 4, …) go to column A, odd-indexed (1, 3, 5, …) go to
 * column B. This deliberately interleaves: if column A and column B were
 * filled in halves (first half / second half of `groupedResults`), the
 * dense groups (CBC's "RBC Indices") would all pile on one side. Alternation
 * keeps the visual weight balanced.
 *
 * Note on the function's name: we keep it as `resultsTable` for symmetry
 * with the layout interface, even though this layout renders the results
 * as dot-leader rows rather than a tabular grid. The interface name is
 * load-bearing across all 8 layouts; the visual treatment is not.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function resultsTable(report) {
  const accent = report.patient.lab.accentColor;

  // Split groups by index parity. We keep the original group order within
  // each column (so the panel's first group still appears first in column A).
  const colAGroups = [];
  const colBGroups = [];
  report.groupedResults.forEach((g, idx) => {
    if (idx % 2 === 0) colAGroups.push(g);
    else colBGroups.push(g);
  });

  return {
    margin: [0, 2, 0, 4],
    columns: [
      {
        width: '*',
        stack: buildColumnStack(colAGroups, accent),
      },
      {
        width: '*',
        stack: buildColumnStack(colBGroups, accent),
      },
    ],
    // pdfmake `columns` default gutter is 0pt; we add an explicit gap so
    // the dot-leader rows in column A and column B don't visually touch.
    columnGap: 14,
  };
}

/**
 * Build the compact endorsement block: a 2-line signature right-aligned
 * (`Verified by: Dr. X, MD  |  Reg: …`), and a single-sentence italic
 * grey disclaimer beneath. Verifier pick is deterministic from
 * `report.registrationId` so the same report endorses the same signer
 * regardless of which layout renders it.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function endorsementBlock(report) {
  // Deterministic verifier pick — same hash recipe as `corporate-clean.js`
  // so a single report's signer is layout-invariant.
  let hash = 0;
  for (const ch of report.registrationId) {
    hash = (hash + ch.charCodeAt(0)) % 1_000_003;
  }
  const verifier = VERIFIERS[hash % VERIFIERS.length];

  return {
    margin: [0, 8, 0, 0],
    stack: [
      {
        alignment: 'right',
        text: [
          { text: 'Verified by: ', style: 'sigMeta' },
          { text: verifier.name, style: 'sigName' },
          { text: '  |  Reg: ', style: 'sigMeta' },
          { text: verifier.regNo, style: 'sigMeta' },
        ],
      },
      {
        margin: [0, 4, 0, 0],
        text:
          'Synthetic test data generated by lab-pdf-gen — not a real '
          + 'patient record, not for clinical use.',
        style: 'disclaimer',
        alignment: 'right',
      },
    ],
  };
}

/**
 * Build the single-line centred footer. pdfmake passes
 * `(currentPage, pageCount)` on each page. The footer sits inside the
 * 50pt bottom margin reserved by `defaultPageDefinition`.
 *
 * Format: `{lab.name} · page X/Y · synthetic test data · reg: {regNumber}`
 *
 * @param {object} report
 * @returns {(currentPage: number, pageCount: number) => object}
 */
export function pageFooter(report) {
  const lab = report.patient.lab;
  return (currentPage, pageCount) => ({
    // Match page horizontal margins so the centred text is centred against
    // the same content box the body uses.
    margin: [32, 14, 32, 0],
    text: [
      { text: lab.name },
      { text: '  ·  ' },
      { text: `page ${currentPage}/${pageCount}` },
      { text: '  ·  ' },
      { text: 'synthetic test data' },
      { text: '  ·  ' },
      { text: `reg: ${lab.regNumber}` },
    ],
    style: 'footerSmall',
  });
}

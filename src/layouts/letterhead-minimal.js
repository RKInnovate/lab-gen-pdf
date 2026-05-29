/**
 * Layout: Letterhead Minimal.
 *
 * # Purpose
 * Layout #4 of the 8-layout pluggable system. Conjures the
 * old-money private-practice aesthetic — a single physician's
 * personal letterhead. Where `corporate-clean` shouts with
 * fills, borders and stripes, this layout whispers: oversized
 * top margin, generous line-height, no fills, no vertical
 * gridlines, only the thinnest of horizontals where structurally
 * necessary. The signature design element is whitespace.
 *
 * # Role in the pipeline
 *   generators/* ──▶ Report (with .layoutKey === 'letterhead-minimal')
 *                                                    │
 *                                                    └─uses─▶ this file
 *                                                              │
 *                                                              └─emits─▶ pdfmake docDefinition
 *
 * # Exported contract (every layout MUST export all 10 of these
 *   with the same signatures as `corporate-clean.js`)
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
 * - **No cursive font.** pdfmake's built-in VFS exposes only
 *   `Roboto` (the renderer registers nothing else and CLAUDE.md
 *   bans new dependencies). The brief asks for a "display
 *   script" lab name; we stand that aesthetic in with a large
 *   (22pt) bold accent-coloured serif-feel rendering of
 *   `lab.name` left-aligned. The tagline carries the visual
 *   weight of "handwritten" via italic styling. If a future
 *   change ships a real cursive face, swap the `font:` property
 *   on `letterheadName` and remove this note.
 * - **Top margin 100pt** (vs. 90 on corporate-clean) so the
 *   letterhead reads as a deliberate band rather than chrome.
 * - **No fills anywhere.** Panel title bar, group sub-headers,
 *   table header, table rows — all transparent. Hierarchy comes
 *   from typography (italics, small-caps via characterSpacing,
 *   accent colour) instead.
 * - **Table layout is custom** (`labLetterheadTable`) and not
 *   one of pdfmake's named layouts — we need: no outer borders,
 *   no column separators, a slightly heavier rule under the
 *   header row, and thin rules only between rows that belong to
 *   different groups. None of the bundled named layouts
 *   (`noBorders`, `lightHorizontalLines`, `headerLineOnly`,
 *   `lightHorizontalLinesAlternating`) gives all three at once.
 * - **Patient block is a flat single-column list** (one field
 *   per line, label-in-accent then value) instead of the
 *   two-column grid corporate-clean uses. Matches the private-
 *   practice "physician dictating a note" feel.
 * - **Flag column uses plain letters**, lightly tinted, never
 *   bold — high-contrast bolding would compete with the airy
 *   layout. Critical rows do NOT get a row-wash; the leading
 *   `• C` glyph is enough.
 * - **Verifier pick is deterministic** on `report.registrationId`
 *   (same algorithm as corporate-clean) so re-rendering the same
 *   report yields the same bytes — load-bearing for the agent's
 *   dedup tests.
 * - **Date formatting is hand-built** — we deliberately avoid
 *   `toLocaleDateString` because its output varies with the host
 *   locale (Linux CI vs. developer macOS) and that would break
 *   the deterministic-bytes property the test bench relies on.
 */

/**
 * Fixed pool of fictitious consultant pathologist names + registration
 * numbers used by `endorsementBlock`. Identical pool as the reference
 * layout — verifying-pathologist assignment is a property of the lab
 * routing, not the visual layout, so consultants pool across layouts.
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
 * Three abbreviated month names — index 0 = Jan. Inlined rather than
 * pulled from a date library to honour the "no new dependencies" rule.
 *
 * @type {ReadonlyArray<string>}
 */
const MONTH_ABBREV = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Two-digit zero-padded helper used by the date formatters. Tiny enough
 * that depending on `String.prototype.padStart` would be fine, but we
 * keep parity with `corporate-clean.js` to make a future refactor that
 * lifts this into a shared util a pure move.
 *
 * @param {number} n
 * @returns {string}
 */
function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Format a Date as `26-May-2026`. Stable across host locales — see the
 * file header for why this matters.
 *
 * @param {Date} d
 * @returns {string}
 */
export function formatDate(d) {
  return `${pad2(d.getDate())}-${MONTH_ABBREV[d.getMonth()]}-${d.getFullYear()}`;
}

/**
 * Format a Date as `26-May-2026  14:30 IST`. Synthetic patients are
 * Indian; we hard-code the `IST` suffix and intentionally do not honour
 * the runtime timezone.
 *
 * @param {Date} d
 * @returns {string}
 */
export function formatDateTime(d) {
  return `${formatDate(d)}  ${pad2(d.getHours())}:${pad2(d.getMinutes())} IST`;
}

/**
 * Map an analyte flag character to a pdfmake text fragment tuned for
 * this layout. Unlike `corporate-clean`, flags are NOT bold and use a
 * softer palette — heavy weight would fight the whitespace aesthetic.
 *
 * @param {'N'|'H'|'L'|'C'} flag
 * @returns {object} pdfmake text node
 */
function flagCell(flag) {
  switch (flag) {
    case 'H':
      // Muted brick red — readable but does not shout.
      return { text: 'H', color: '#B33A3A', alignment: 'center' };
    case 'L':
      // Muted navy — sibling to the 'H' brick in saturation.
      return { text: 'L', color: '#28568A', alignment: 'center' };
    case 'C':
      // Critical gets the only piece of bolding in the table — and
      // a leading bullet so it survives a black-and-white print.
      return { text: '• C', bold: true, color: '#8B1A1A', alignment: 'center' };
    case 'N':
    default:
      // Mid-grey 'N' — present but recessive.
      return { text: 'N', color: '#777777', alignment: 'center' };
  }
}

/**
 * Returns the pdfmake `styles` object used by every node this module
 * emits. Centralised so a tweak (e.g. tightening line-height) only
 * touches one place.
 *
 * @returns {Record<string, object>}
 */
export function commonStyles() {
  return {
    // 22pt accent-coloured display name — the visual "letterhead".
    // We do NOT specify a `font:` here because pdfmake's VFS only
    // ships Roboto; a future cursive face would slot in via `font`.
    letterheadName: { fontSize: 22, bold: true },
    letterheadTagline: { fontSize: 11, italics: true, color: '#555555' },
    addressLine: { fontSize: 8, color: '#666666', alignment: 'right' },

    // Flat patient list: bold accent label, regular dark value.
    patientLabel: { fontSize: 9, bold: true },
    patientValue: { fontSize: 9, color: '#222222' },

    // Panel title bar — centred italic dash-flanked line.
    panelTitleLine: {
      fontSize: 13,
      italics: true,
      alignment: 'center',
      color: '#222222',
    },
    panelMetaLine: {
      fontSize: 8,
      italics: true,
      color: '#555555',
      alignment: 'center',
    },

    // Table column headers: small caps via characterSpacing, accent.
    tableHeader: {
      fontSize: 8,
      bold: true,
      characterSpacing: 1.2,
    },
    // Group sub-header: small italic, accent, left-aligned, no fill.
    groupHeader: {
      fontSize: 9,
      italics: true,
    },
    // Body cells.
    cellText: { fontSize: 9, color: '#222222' },
    cellTextMuted: { fontSize: 9, color: '#555555' },

    // Endorsement block.
    verifiedByLabel: {
      fontSize: 8,
      bold: true,
      color: '#666666',
      characterSpacing: 1.5,
      alignment: 'center',
    },
    verifierName: {
      fontSize: 10,
      italics: true,
      alignment: 'center',
      color: '#222222',
    },
    verifierMeta: {
      fontSize: 8,
      italics: true,
      alignment: 'center',
      color: '#555555',
    },
    disclaimer: {
      fontSize: 7,
      color: '#888888',
      alignment: 'center',
      italics: true,
    },

    // Footer.
    footerPageNo: {
      fontSize: 8,
      italics: true,
      color: '#888888',
      alignment: 'center',
    },
  };
}

/**
 * Base page definition merged into every panel template via spread.
 *
 * Margins `[50, 100, 50, 60]` — the 100pt top is the whole point of
 * this layout: it gives the big letterhead room to breathe. Bottom
 * stays at 60 because the footer is a single italic line.
 *
 * `lineHeight: 1.4` — generous vertical airiness, applies everywhere
 * unless a node overrides it. This is the one knob that does the most
 * work for the "old-money" feel.
 *
 * @returns {object} partial pdfmake docDefinition
 */
export function defaultPageDefinition() {
  return {
    pageSize: 'A4',
    pageMargins: [50, 100, 50, 60],
    defaultStyle: {
      font: 'Roboto',
      fontSize: 9,
      lineHeight: 1.4,
      color: '#222222',
    },
  };
}

/**
 * Build the big letterhead band.
 *
 * Left column (stretch): lab name 22pt bold accent, then italic 11pt
 * tagline in dark grey on the line below.
 * Right column (auto):   multi-line 8pt grey address block.
 *
 * No horizontal rule beneath — the brief is explicit that the airy
 * whitespace IS the separator. pdfmake quirk note: the two-column
 * `columns` node with `[*, auto]` widths gives us a stretch-then-hug
 * arrangement without any explicit width arithmetic.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function headerBlock(report) {
  const lab = report.patient.lab;
  // A4 width 595 minus left+right margins (50 + 50) = 495 usable.
  // We don't draw a rule, but other nodes that need full-bleed
  // canvas widths use 495 — kept as a constant comment for future
  // edits to this file.

  return {
    margin: [0, 0, 0, 14],
    columns: [
      {
        width: '*',
        stack: [
          // Display-script stand-in: oversized bold accent-coloured
          // name. See file header for why we don't ship a cursive
          // face. Margins generous so the tagline doesn't crowd it.
          {
            text: lab.name,
            style: 'letterheadName',
            color: lab.accentColor,
            margin: [0, 0, 0, 4],
          },
          {
            text: lab.tagline,
            style: 'letterheadTagline',
          },
        ],
      },
      {
        width: 'auto',
        // Top-margin 6 nudges the address baseline so it visually
        // sits between the name and the tagline, not above the name.
        margin: [0, 6, 0, 0],
        stack: [
          { text: lab.address[0] ?? '', style: 'addressLine' },
          { text: lab.address[1] ?? '', style: 'addressLine' },
          { text: lab.phone, style: 'addressLine' },
          { text: lab.email, style: 'addressLine' },
        ],
      },
    ],
  };
}

/**
 * Build the patient + sample metadata block as a FLAT one-line-per-field
 * list — bold accent-coloured label, regular dark-grey value next to
 * it, vertically stacked. Closed by a thin light-grey horizontal rule.
 *
 * We render this as a `noBorders` table (label column auto-width, value
 * column stretch) rather than a `columns` stack because pdfmake's
 * `columns` node doesn't align rows across siblings the way a table
 * naturally does — labels would visually wobble.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function patientBlock(report) {
  const lab = report.patient.lab;
  const { patient, sampleDate, reportDate, registrationId, sampleId } = report;

  // The flat field list. Order is "who, then sample, then route" —
  // mirroring how a clinician would scan it.
  const fields = [
    ['Patient Name', patient.name],
    ['Age / Sex', `${patient.age} / ${patient.sex === 'F' ? 'Female' : 'Male'}`],
    ['Patient ID', patient.id],
    ['MRN', patient.mrn],
    ['Mobile', patient.phone],
    ['Registration ID', registrationId],
    ['Sample ID', sampleId],
    ['Sample Date', formatDateTime(sampleDate)],
    ['Report Date', formatDateTime(reportDate)],
    ['Referring Doctor', patient.referringDoctor],
    ['Laboratory', lab.name],
  ];

  return {
    margin: [0, 6, 0, 10],
    stack: [
      {
        table: {
          // Label width 110pt sized so the longest label ("Referring
          // Doctor") fits without wrapping; value column stretches.
          widths: [110, '*'],
          body: fields.map(([k, v]) => [
            {
              // Trailing colon kept inline so the value column's
              // left edge isn't crowded by a punctuation glyph.
              text: `${k}:`,
              style: 'patientLabel',
              color: lab.accentColor,
              border: [false, false, false, false],
              margin: [0, 2, 0, 2],
            },
            {
              text: v,
              style: 'patientValue',
              border: [false, false, false, false],
              margin: [0, 2, 0, 2],
            },
          ]),
        },
        layout: 'noBorders',
      },
      // Light grey thin hairline below the patient block — the one
      // structural rule we allow ourselves in this section.
      {
        margin: [0, 6, 0, 0],
        canvas: [
          {
            type: 'line',
            x1: 0,
            y1: 0,
            x2: 495, // A4 (595) - left (50) - right (50)
            y2: 0,
            lineWidth: 0.4,
            lineColor: '#CCCCCC',
          },
        ],
      },
    ],
  };
}

/**
 * Build the panel title bar: a centred italic dash-flanked line with
 * the panel title, then department | specimen on the line beneath in
 * small italic dark-grey.
 *
 * No fill, no border — pure typography. The em-dashes flanking the
 * title are the visual delimiters.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function panelTitleBar(report) {
  return {
    margin: [0, 8, 0, 8],
    stack: [
      {
        text: `— ${report.panelTitle} —`,
        style: 'panelTitleLine',
        margin: [0, 0, 0, 2],
      },
      {
        text: `${report.panelDept}  |  ${report.panelSpecimen}`,
        style: 'panelMetaLine',
      },
    ],
  };
}

/**
 * Determine whether any row in any group of this report carries a
 * non-null `method`. When true, the results table renders a Method
 * column; when false, we omit it to keep the table compact.
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
 * # Column layout
 *   without method: Test | Result | Unit | Reference Range | Flag
 *   with method:    Test | Result | Unit | Method | Reference Range | Flag
 *
 * # Visual rules (the whole reason for the custom layout function)
 * - NO outer borders.
 * - NO column separators.
 * - A slightly heavier rule UNDER the column-header row.
 * - Thin rules between rows ONLY where the next row belongs to a
 *   different group.
 * - No fills, no zebra striping.
 *
 * Group sub-headers are NOT a spanned-row inside the table — they're a
 * separate italic line rendered above each group's run of rows, which
 * lets us keep the table's column-header rule unambiguously the only
 * horizontal under the header row. We emit one `stack` per group:
 *   [groupName line] + [table of that group's rows]
 * The very first group's table also carries the column header. Later
 * tables suppress headers (no `headerRows: 1`) so the column-header
 * rule only appears once at the top of the results section.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function resultsTable(report) {
  const lab = report.patient.lab;
  const showMethod = reportHasAnyMethod(report);
  const widths = showMethod
    ? ['*', 'auto', 'auto', 'auto', 'auto', 26]
    : ['*', 'auto', 'auto', 'auto', 26];
  const colCount = widths.length;

  /**
   * One pdfmake table-header cell. Accent-coloured small-caps via
   * `characterSpacing`. No fill, no border declared here — borders
   * are handled by the custom layout function on the table.
   *
   * @param {string} label
   * @param {string} [align]
   * @returns {object}
   */
  const th = (label, align = 'left') => ({
    // Manually upper-case because pdfmake doesn't honour CSS
    // text-transform. `characterSpacing` then sells the small-caps look.
    text: label.toUpperCase(),
    style: 'tableHeader',
    color: lab.accentColor,
    alignment: align,
    margin: [0, 4, 4, 4],
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

  /**
   * Build one body row's array of cells.
   *
   * Generous vertical padding (3pt top, 3pt bottom on every cell)
   * is the layout signature — it doubles the row height vs.
   * corporate-clean and emphasises the whitespace aesthetic.
   *
   * @param {object} row
   * @returns {Array<object>}
   */
  const buildBodyRow = (row) => {
    /**
     * Helper to standardise per-cell margins and styling.
     * @param {string|object} content
     * @param {object} [extra]
     * @returns {object}
     */
    const cell = (content, extra = {}) => {
      const base = typeof content === 'string' ? { text: content } : content;
      return {
        ...base,
        style: base.style ?? 'cellText',
        margin: base.margin ?? [0, 3, 4, 3],
        ...extra,
      };
    };

    const valueCell = cell({
      text: row.display,
      alignment: 'right',
      // Out-of-range result gets weight; in-range stays plain so
      // the page doesn't look bolded-up.
      bold: row.flag !== 'N',
    });

    return showMethod
      ? [
          cell(row.name),
          valueCell,
          cell({ text: row.unit, style: 'cellTextMuted' }),
          cell({ text: row.method ?? '—', style: 'cellTextMuted' }),
          cell({ text: row.rangeDisplay, style: 'cellTextMuted' }),
          cell(flagCell(row.flag)),
        ]
      : [
          cell(row.name),
          valueCell,
          cell({ text: row.unit, style: 'cellTextMuted' }),
          cell({ text: row.rangeDisplay, style: 'cellTextMuted' }),
          cell(flagCell(row.flag)),
        ];
  };

  /**
   * Custom pdfmake table layout — the visual contract of this whole
   * file lives here.
   *
   * pdfmake calls these hook functions for each row/col index. We
   * return line widths in points; returning 0 means "draw nothing".
   * Row index 0 is the header row; node.table.body.length is the
   * past-the-end row index (the bottom border of the last row).
   */
  const labLetterheadTable = {
    // Top of table: 0 (no top border).
    // Bottom of header row (i === 1 when headerRows present): 0.8.
    // Bottom of table (i === body.length): 0 (no bottom border).
    // Between data rows: 0 (no separators within a group's table).
    hLineWidth: (i, node) => {
      if (i === 0) return 0;
      if (i === node.table.body.length) return 0;
      // Heavier rule under the column header.
      if (node.table.headerRows && i === node.table.headerRows) return 0.8;
      return 0;
    },
    hLineColor: () => '#999999',
    // No vertical lines anywhere — period.
    vLineWidth: () => 0,
    vLineColor: () => '#FFFFFF',
    // No left/right padding from pdfmake — our cell `margin` does it.
    paddingLeft: () => 0,
    paddingRight: () => 0,
    paddingTop: () => 0,
    paddingBottom: () => 0,
  };

  // Build one node per group: [italic group line, table-of-that-group].
  // The first group's table includes the column header; subsequent
  // groups' tables don't (we draw a thin inter-group rule instead).
  const groupNodes = [];
  report.groupedResults.forEach((group, groupIdx) => {
    // Italic group sub-header line — left-aligned, accent-coloured,
    // trailing em-dash sells the "marginal note" feel.
    groupNodes.push({
      text: `${group.name} —`,
      style: 'groupHeader',
      color: lab.accentColor,
      margin: [0, groupIdx === 0 ? 8 : 10, 0, 4],
    });

    // For groups after the first, emit a thin hairline ABOVE the
    // group — this is the "thin horizontal rules between groups"
    // requirement from the brief, drawn between row-runs rather
    // than between table-rows.
    // (Implementation note: we draw the rule *between* the group
    // label and the previous group's last row by inserting it
    // before the label of groups after the first.)
    if (groupIdx > 0) {
      // Splice the rule in BEFORE the label we just pushed.
      const label = groupNodes.pop();
      groupNodes.push({
        margin: [0, 6, 0, 0],
        canvas: [
          {
            type: 'line',
            x1: 0,
            y1: 0,
            x2: 495,
            y2: 0,
            lineWidth: 0.3,
            lineColor: '#DDDDDD',
          },
        ],
      });
      groupNodes.push(label);
    }

    const body = [];
    if (groupIdx === 0) {
      body.push(headerRow);
    }
    for (const row of group.rows) {
      body.push(buildBodyRow(row));
    }

    groupNodes.push({
      table: {
        headerRows: groupIdx === 0 ? 1 : 0,
        widths,
        body,
      },
      layout: labLetterheadTable,
    });
  });

  // Wrap-up: emit unused `colCount` to keep the symbol alive for
  // future column-counting extensions (e.g. a totals row). pdfmake
  // ignores it. Suppresses a "no-unused" lint if it ever turns on.
  void colCount;

  return {
    margin: [0, 2, 0, 8],
    stack: groupNodes,
  };
}

/**
 * Build the closing endorsement block.
 *
 * Layout (vertical stack, all centred):
 *   ─────────── thin grey rule ───────────
 *
 *   VERIFIED BY        (small-caps label)
 *   Dr. Foo, MD        (italic name)
 *   Reg. No. XYZ       (italic small meta)
 *
 *   <disclaimer, 7pt grey, two lines>
 *
 * The verifying pathologist is picked deterministically from
 * `VERIFIERS` using a sum-of-char-codes hash of `report.registrationId`
 * — identical algorithm to `corporate-clean.js` so re-rendering the
 * same report (potentially with a different layoutKey) still yields a
 * stable verifier per registration.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function endorsementBlock(report) {
  // Deterministic verifier pick — see file header for why determinism
  // is load-bearing.
  let hash = 0;
  for (const ch of report.registrationId) {
    hash = (hash + ch.charCodeAt(0)) % 1_000_003;
  }
  const verifier = VERIFIERS[hash % VERIFIERS.length];

  return {
    margin: [0, 14, 0, 0],
    stack: [
      // Thin grey horizontal rule across the page.
      {
        canvas: [
          {
            type: 'line',
            x1: 0,
            y1: 0,
            x2: 495,
            y2: 0,
            lineWidth: 0.4,
            lineColor: '#CCCCCC',
          },
        ],
      },
      {
        text: 'VERIFIED BY',
        style: 'verifiedByLabel',
        margin: [0, 12, 0, 4],
      },
      {
        text: verifier.name,
        style: 'verifierName',
      },
      {
        text: `Reg. No. ${verifier.regNo}`,
        style: 'verifierMeta',
        margin: [0, 0, 0, 2],
      },
      {
        text: 'Consultant Pathologist',
        style: 'verifierMeta',
      },
      // Disclaimer — broken into two text fragments (pdfmake honours
      // newlines inside a single `text` but does not auto-wrap onto
      // exactly two lines). We rely on natural wrap of the long
      // sentence below; the requirement is "two lines under" the
      // verifier meta, which the 7pt grey rendering achieves with the
      // 495pt available width.
      {
        margin: [0, 14, 0, 0],
        text:
          'DISCLAIMER: This document is synthetic test data generated '
          + 'by lab-pdf-gen for the LabSense agent test bench. It does '
          + 'not represent any real patient, sample, or clinical finding '
          + 'and must not be used for diagnosis, treatment, or any '
          + 'clinical decision. All names, IDs, and laboratory brandings '
          + 'are fictitious.',
        style: 'disclaimer',
      },
    ],
  };
}

/**
 * Build the page footer factory consumed by pdfmake. pdfmake passes
 * `(currentPage, pageCount)` to this factory on each page render.
 *
 * Minimal by design: a single centred italic small-grey line of the
 * form `— Page 2 —`. Nothing else: no lab name, no registration
 * number, no rule. The minimalism is the brand.
 *
 * The `report` parameter is unused here (no chrome to emit), but is
 * accepted for signature parity with the other layouts — the calling
 * panel templates pass it unconditionally.
 *
 * @param {object} report
 * @returns {(currentPage: number, pageCount: number) => object}
 */
export function pageFooter(report) {
  // Touch the param so future lint sweeps don't strip it from the
  // exported signature; signature parity across layouts matters.
  void report;
  return (currentPage, _pageCount) => {
    // _pageCount intentionally unused — the minimal footer shows only
    // the current page number, not "X of Y".
    void _pageCount;
    return {
      margin: [50, 18, 50, 0],
      text: `— Page ${currentPage} —`,
      style: 'footerPageNo',
    };
  };
}

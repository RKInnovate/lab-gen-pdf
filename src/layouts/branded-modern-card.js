/**
 * Layout: Branded Modern Card.
 *
 * # Purpose
 * App-y / health-tech visual layout reminiscent of 1mg Labs, HealthifyMe
 * and Pharmeasy reports — full-bleed accent-coloured banner at the top,
 * a light-grey sidebar carrying patient meta, and a vertical STACK OF
 * CARDS (one per analyte) instead of a flat table. Drives layout #6 of
 * the 8-layout pluggable layout system.
 *
 * # Role in the pipeline
 *   generators/* ──▶ Report (with .layoutKey) ──▶ panel template
 *                                                    │
 *                                                    └─uses─▶ layouts/<layoutKey>.js (this file is one of 8)
 *                                                              │
 *                                                              └─emits─▶ pdfmake docDefinition
 *
 * # Layout interface (every layout MUST export these — same contract as
 *   corporate-clean.js)
 *   formatDate(d)                   → string
 *   formatDateTime(d)               → string
 *   commonStyles()                  → pdfmake styles object
 *   defaultPageDefinition()         → partial docDefinition (pageSize, pageMargins, defaultStyle)
 *   headerBlock(report)             → pdfmake content node — full-bleed banner
 *   patientBlock(report)            → pdfmake content node — sidebar + main meta strip
 *   panelTitleBar(report)           → pdfmake content node — embedded into patientBlock's main column
 *   resultsTable(report)            → pdfmake content node — vertical card stack
 *   endorsementBlock(report)        → pdfmake content node — tinted verifier card + disclaimer
 *   pageFooter(report)              → (page, total) => content node — accent footer strip
 *
 * # Design decisions (this layout)
 * - pageMargins are [0, 0, 0, 50]. Horizontal and top margins are ZERO so
 *   the banner header and the footer strip can be full-bleed. Every block
 *   below the banner re-introduces a 40pt left/right inset via its own
 *   `margin` field, which keeps the page rhythm correct without forcing
 *   pdfmake into per-page header positioning gymnastics.
 * - The lab's accent colour is the dominant pigment — banner fill,
 *   monogram disc fill, panel-title text, card border, card-value text
 *   (when normal), group-strip fill, and the footer strip all share it.
 *   This intentionally pushes this layout to the "most colour-saturated"
 *   end of the 8-layout spectrum.
 * - Rounded corners: pdfmake does NOT support border-radius on tables.
 *   We fake the "rounded card" look with a single-cell `table` that
 *   carries a thin (0.5pt) accent border on all four sides plus a very
 *   light `#FAFAFA` fill and generous 6pt inner padding. To human eyes
 *   the soft inner padding + thin border reads as a card; the corners
 *   are technically right-angled but the contrast against the page is
 *   gentle enough that it doesn't jar.
 * - Full-bleed banner: implemented as a `table` with the page-wide
 *   width (595pt for A4) and `fillColor: lab.accentColor`. Because
 *   pageMargins are [0,0,0,_] this lays flush against the page edge.
 * - Verifier picking is deterministic over `report.registrationId` —
 *   identical reasoning to corporate-clean (dedup test needs stable
 *   bytes across re-renders).
 */

/**
 * A4 page width in pdfmake points. Used to size the full-bleed banner
 * and footer strips because pdfmake's `table` widths need to be told an
 * absolute pixel value — `'*'` only stretches inside the printable area
 * defined by the current pageMargins.
 */
const A4_WIDTH_PT = 595;

/**
 * Internal horizontal inset used by every non-banner content block.
 * Banner + footer ignore this (they are full-bleed). Everything else
 * applies `[CONTENT_INSET, top, CONTENT_INSET, bottom]` margins so the
 * body reads as if there were 40pt page margins.
 */
const CONTENT_INSET = 40;

/**
 * Soft tinted background for the endorsement card. The spec asks for a
 * 10%-opacity tint of the lab's accent; pdfmake does not honour alpha
 * channels in fillColor strings, so we settle on this fixed near-white
 * blue-grey which reads as "calm callout" against any accent the labs.js
 * palette currently uses.
 */
const ENDORSEMENT_TINT = '#F0F4F8';

/**
 * Fixed pool of fictitious consultant pathologist names + registration
 * numbers used by `endorsementBlock`. Kept inline (and not imported from
 * corporate-clean.js) because each layout file is a self-contained
 * module — re-exporting through corporate-clean would couple the two
 * layouts and complicate the dispatch table.
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
 * Two-digit zero-padded helper used by the date formatters. Inlined per
 * project policy (no `date-fns`, no `dayjs`, no extra dependencies).
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
 * Format a Date as `26-May-2026`. Locale-independent on purpose so the
 * "same seed ⇒ same bytes" dedup property survives across CI boxes.
 *
 * @param {Date} d
 * @returns {string}
 */
export function formatDate(d) {
  return `${pad2(d.getDate())}-${MONTH_ABBREV[d.getMonth()]}-${d.getFullYear()}`;
}

/**
 * Format a Date as `26-May-2026  14:30 IST`. IST is hard-coded — all
 * synthetic patients are Indian and we do not honour the host TZ.
 *
 * @param {Date} d
 * @returns {string}
 */
export function formatDateTime(d) {
  return `${formatDate(d)}  ${pad2(d.getHours())}:${pad2(d.getMinutes())} IST`;
}

/**
 * Colour pick for the "result value" text in each card. Normal values
 * render in the lab's accent, high/critical in red, low in blue. Kept as
 * a tiny helper because the same mapping drives the value colour AND the
 * flag-chip fill.
 *
 * @param {'N'|'H'|'L'|'C'} flag
 * @param {string} accent
 * @returns {string} hex colour
 */
function valueColorFor(flag, accent) {
  switch (flag) {
    case 'H':
    case 'C':
      return '#C62828';
    case 'L':
      return '#1565C0';
    case 'N':
    default:
      return accent;
  }
}

/**
 * Colour pick for the flag-chip background. Critical (C) reuses the H
 * red — the chip text differentiates them with the explicit letter.
 *
 * @param {'N'|'H'|'L'|'C'} flag
 * @returns {string} hex colour
 */
function chipFillFor(flag) {
  switch (flag) {
    case 'H':
    case 'C':
      return '#C62828';
    case 'L':
      return '#1565C0';
    case 'N':
    default:
      return '#2E7D32';
  }
}

/**
 * Returns the pdfmake `styles` object used across every panel template.
 * Names are kept compatible with corporate-clean.js (panel templates
 * reference styles by name) so any template that worked under that
 * layout still finds the styles it needs here.
 *
 * @returns {Record<string, object>}
 */
export function commonStyles() {
  return {
    h1: { fontSize: 18, bold: true, color: 'white' },
    h2: { fontSize: 11, bold: true },
    tagline: { fontSize: 9, italics: true, color: 'white' },
    addressLine: { fontSize: 8, color: 'white', alignment: 'right' },
    sectionLabel: {
      fontSize: 7,
      bold: true,
      color: '#888888',
      characterSpacing: 0.6,
    },
    fieldLabel: { fontSize: 7, color: '#666666', bold: true, characterSpacing: 0.4 },
    fieldValue: { fontSize: 9, color: '#222222' },
    panelTitle: { fontSize: 16, bold: true },
    panelMeta: { fontSize: 9, italics: true, color: '#666666' },
    tableHeader: { fontSize: 9, bold: true, color: 'white' },
    groupHeader: { fontSize: 9, bold: true, color: 'white' },
    flag: { bold: true, alignment: 'center' },
    interpretation: { fontSize: 9, italics: true, color: '#333333' },
    disclaimer: { fontSize: 7, italics: true, color: '#888888' },
    endOfReport: {
      fontSize: 9,
      italics: true,
      color: '#777777',
      alignment: 'center',
    },
    signatureName: { fontSize: 10, bold: true },
    signatureMeta: { fontSize: 8, color: '#555555' },
    footerSmall: { fontSize: 7, color: 'white', alignment: 'center' },
    cardAnalyteName: { fontSize: 10, bold: true },
    cardUnit: { fontSize: 7, color: '#777777' },
    cardValue: { fontSize: 18, bold: true },
    cardRange: { fontSize: 7, color: '#666666' },
    cardChip: { fontSize: 8, bold: true, color: 'white', alignment: 'center' },
  };
}

/**
 * Base page definition. Margins are [0, 0, 0, 50] because the banner
 * header and footer strip are full-bleed — every other block re-adds
 * a CONTENT_INSET horizontally via its own margin.
 *
 * @returns {object} partial pdfmake docDefinition
 */
export function defaultPageDefinition() {
  return {
    pageSize: 'A4',
    // [left, top, right, bottom]. Zero left/top/right so the banner sits
    // flush against the page edge; 50 bottom keeps the footer strip from
    // bumping into the last card.
    pageMargins: [0, 0, 0, 50],
    defaultStyle: {
      font: 'Roboto',
      fontSize: 9,
      lineHeight: 1.2,
      color: '#222222',
    },
  };
}

/**
 * Build the full-bleed banner header.
 *
 * Layout: a single-row, 3-column `table` filled with the lab's accent
 * colour. Columns from left to right are:
 *   1. White-stroked monogram circle (40pt) with the lab's logoMonogram.
 *      pdfmake has no ellipse helper inside a table cell, so we draw the
 *      circle as a `canvas` node nested inside the cell — this is the
 *      cleanest path to a true circle while still letting the cell fill
 *      colour the surrounding banner.
 *   2. Lab name (18pt white bold) over tagline (9pt white italic).
 *   3. Right-aligned address lines + regNumber (white).
 *
 * The table's width array is sized to the A4 page width so the banner is
 * truly full-bleed.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function headerBlock(report) {
  const lab = report.patient.lab;

  // Monogram cell content: stack of a canvas circle and the letter,
  // absolutely positioned via margins so the letter sits centred over
  // the circle. The circle radius (20pt) and 1.5pt stroke give the
  // 40pt-diameter spec'd disc with a white border on an accent fill.
  const monogramCell = {
    width: 60,
    margin: [12, 14, 0, 0],
    stack: [
      {
        canvas: [
          {
            type: 'ellipse',
            x: 20,
            y: 20,
            color: lab.accentColor,
            // White stroke ring around the disc.
            lineColor: 'white',
            lineWidth: 1.5,
            r1: 20,
            r2: 20,
          },
        ],
      },
      // The monogram letter is drawn ON TOP of the canvas by giving it a
      // negative top-margin equal to (canvas height - desired offset).
      // Canvas height of an ellipse drawing is roughly 2*r1; we offset
      // upwards by ~33pt to centre a 22pt-cap-height letter inside.
      {
        text: lab.logoMonogram,
        color: 'white',
        bold: true,
        fontSize: 22,
        alignment: 'center',
        width: 40,
        margin: [0, -33, 0, 0],
      },
    ],
  };

  // Centre column: lab name + tagline. Vertical padding tuned so the
  // text optically centres against the 85pt-tall banner.
  const nameCell = {
    width: '*',
    margin: [12, 22, 8, 0],
    stack: [
      { text: lab.name, style: 'h1' },
      { text: lab.tagline, style: 'tagline' },
    ],
  };

  // Right column: address lines stacked, then the regNumber in italic.
  const addrCell = {
    width: 'auto',
    margin: [0, 18, 14, 0],
    stack: [
      { text: lab.address[0] ?? '', style: 'addressLine' },
      { text: lab.address[1] ?? '', style: 'addressLine' },
      {
        text: lab.regNumber,
        fontSize: 7,
        italics: true,
        color: 'white',
        alignment: 'right',
        margin: [0, 2, 0, 0],
      },
    ],
  };

  return {
    // Zero margin on all sides so the banner bleeds to the page edge.
    margin: [0, 0, 0, 0],
    table: {
      // Full A4 width split into three columns. Monogram + address hug
      // their content; the centre stretches.
      widths: [80, '*', 'auto'],
      heights: [85],
      body: [
        [
          // Each cell carries its own accent fillColor so the whole row
          // reads as one solid banner — pdfmake doesn't inherit table-
          // level fills onto cells.
          { ...monogramCell, fillColor: lab.accentColor, border: [false, false, false, false] },
          { ...nameCell, fillColor: lab.accentColor, border: [false, false, false, false] },
          { ...addrCell, fillColor: lab.accentColor, border: [false, false, false, false] },
        ],
      ],
    },
    layout: 'noBorders',
  };
}

/**
 * Build the sidebar + main column block. The "patient" block here also
 * absorbs the panel title meta strip because the modern-app look puts
 * patient info and panel info side by side rather than stacked. The
 * dispatch contract still calls `panelTitleBar` separately afterwards —
 * to avoid duplication, this layout's `panelTitleBar` returns a thin
 * compact strip that visually complements (rather than repeats) the
 * sidebar.
 *
 * The sidebar is a single-cell table with a light-grey fill so the
 * background visually delimits the patient region. pdfmake table-cells
 * are the easiest way to get a coloured rectangle that respects flow.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function patientBlock(report) {
  const { patient, sampleDate, reportDate, registrationId, sampleId } = report;

  /**
   * Build one label/value pair as a small vertical stack — tiny bold
   * uppercase label, then the value. This is the dominant pattern in
   * mobile-first lab apps and keeps the sidebar scannable.
   *
   * @param {string} label
   * @param {string} value
   * @returns {object}
   */
  const kvStack = (label, value) => ({
    margin: [0, 0, 0, 8],
    stack: [
      { text: label.toUpperCase(), style: 'fieldLabel' },
      { text: value, style: 'fieldValue', margin: [0, 1, 0, 0] },
    ],
  });

  // Sidebar: 140pt wide, light-grey fill, six patient fields stacked.
  // We pad inside the cell with 10pt all round so the labels don't kiss
  // the edge.
  const sidebar = {
    width: 140,
    table: {
      widths: ['*'],
      body: [
        [
          {
            border: [false, false, false, false],
            fillColor: '#F5F5F5',
            margin: [10, 10, 10, 10],
            stack: [
              { text: 'PATIENT', style: 'sectionLabel', margin: [0, 0, 0, 8] },
              kvStack('Name', patient.name),
              kvStack('Age / Sex', `${patient.age} yrs / ${patient.sex === 'F' ? 'Female' : 'Male'}`),
              kvStack('Patient ID', patient.id),
              kvStack('MRN', patient.mrn),
              kvStack('Referring Doctor', patient.referringDoctor),
              kvStack('Lab', report.patient.lab.name),
            ],
          },
        ],
      ],
    },
    layout: 'noBorders',
  };

  // Main column: panel title (large, accent) + dept/specimen meta +
  // a compact two-line strip of registration / sample / dates.
  const main = {
    width: '*',
    margin: [16, 0, 0, 0],
    stack: [
      {
        text: report.panelTitle,
        style: 'panelTitle',
        color: report.patient.lab.accentColor,
      },
      {
        text: `${report.panelDept}  ·  ${report.panelSpecimen}`,
        style: 'panelMeta',
        margin: [0, 2, 0, 10],
      },
      // Meta strip: two columns × two rows of label/value pairs. Uses
      // nested columns instead of a table so the values can flow with
      // their natural widths.
      {
        columns: [
          {
            width: '*',
            stack: [
              kvStack('Registration ID', registrationId),
              kvStack('Sample Date', formatDateTime(sampleDate)),
            ],
          },
          {
            width: '*',
            stack: [
              kvStack('Sample ID', sampleId),
              kvStack('Report Date', formatDateTime(reportDate)),
            ],
          },
        ],
      },
    ],
  };

  return {
    margin: [CONTENT_INSET, 16, CONTENT_INSET, 6],
    columns: [sidebar, main],
  };
}

/**
 * In this layout the panel title is already shown inside `patientBlock`'s
 * main column. To avoid visual duplication while still honouring the
 * 10-export contract, we return a slim accent divider that doubles as a
 * "begin results" marker. Panel templates can keep calling
 * `panelTitleBar` in the same slot they did for corporate-clean.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function panelTitleBar(report) {
  const lab = report.patient.lab;
  return {
    margin: [CONTENT_INSET, 4, CONTENT_INSET, 8],
    // 2pt accent rule. pdfmake's canvas is the lightest way to draw a
    // single horizontal stripe; the x2 is computed from the printable
    // width (A4 page width minus the two inset margins).
    canvas: [
      {
        type: 'rect',
        x: 0,
        y: 0,
        w: A4_WIDTH_PT - CONTENT_INSET * 2,
        h: 2,
        color: lab.accentColor,
      },
    ],
  };
}

/**
 * Build the results region as a vertical STACK OF CARDS — one card per
 * analyte. Group subheaders render as slim full-width accent strips.
 *
 * Each card is emulated as a one-cell `table` whose cell has:
 *   - thin 0.5pt accent border on all four sides (pdfmake CAN draw cell
 *     borders in any colour by using a table layout function);
 *   - `fillColor: '#FAFAFA'` very-light grey so the card lifts off the
 *     white page;
 *   - 6pt internal padding via the cell's `margin`.
 * The card content is a `columns` node with three regions: name+unit
 * (40%), value (35%), range + chip (25%).
 *
 * pdfmake limitation worked around: table cells don't support
 * border-radius. We tolerate the right-angled corners and lean on the
 * gentle fill + thin accent border to read as a card.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function resultsTable(report) {
  const lab = report.patient.lab;
  const stack = [];

  // pdfmake table `layout` function: lets us tint every border on the
  // card the lab's accent colour at 0.5pt. We can't return one shared
  // function across all cards because each invocation closes over its
  // own colour — but here every card uses the same accent so a single
  // closure is fine.
  const cardLayout = {
    hLineWidth: () => 0.5,
    vLineWidth: () => 0.5,
    hLineColor: () => lab.accentColor,
    vLineColor: () => lab.accentColor,
    paddingLeft: () => 8,
    paddingRight: () => 8,
    paddingTop: () => 6,
    paddingBottom: () => 6,
  };

  for (const group of report.groupedResults) {
    // Group strip: full-width accent rectangle with the group name in
    // white bold. Implemented as a single-cell table with no borders
    // and the accent fill so it spans the printable width.
    stack.push({
      margin: [0, 6, 0, 4],
      table: {
        widths: ['*'],
        body: [
          [
            {
              text: group.name,
              style: 'groupHeader',
              fillColor: lab.accentColor,
              margin: [8, 4, 8, 4],
              border: [false, false, false, false],
            },
          ],
        ],
      },
      layout: 'noBorders',
    });

    for (const row of group.rows) {
      const valueColor = valueColorFor(row.flag, lab.accentColor);
      const chipFill = chipFillFor(row.flag);

      // Left region: analyte name + unit.
      const leftRegion = {
        width: '40%',
        stack: [
          { text: row.name, style: 'cardAnalyteName' },
          { text: row.unit || ' ', style: 'cardUnit', margin: [0, 2, 0, 0] },
        ],
      };

      // Middle region: large coloured value. We rely on pdfmake's
      // vertical alignment quirks — adding a small top margin nudges
      // the value baseline closer to the analyte-name baseline.
      const middleRegion = {
        width: '35%',
        stack: [
          {
            text: row.display,
            style: 'cardValue',
            color: valueColor,
            margin: [0, 0, 0, 0],
          },
        ],
      };

      // Right region: range line + flag chip. The chip is itself a
      // single-cell table with the chip fill colour and white bold text;
      // this is the only way to get a coloured pill-ish marker inside
      // pdfmake without resorting to a custom canvas drawing.
      const rightRegion = {
        width: '25%',
        alignment: 'right',
        stack: [
          {
            text: `Range: ${row.rangeDisplay}`,
            style: 'cardRange',
            margin: [0, 2, 0, 4],
          },
          {
            table: {
              widths: [42],
              body: [
                [
                  {
                    text: row.flag === 'C' ? 'CRIT' : row.flag,
                    style: 'cardChip',
                    fillColor: chipFill,
                    margin: [0, 2, 0, 2],
                    border: [false, false, false, false],
                  },
                ],
              ],
            },
            layout: 'noBorders',
            alignment: 'right',
          },
        ],
      };

      stack.push({
        margin: [0, 0, 0, 5],
        table: {
          widths: ['*'],
          body: [
            [
              {
                // Light-grey fill + accent border + inner padding ⇒ card.
                fillColor: '#FAFAFA',
                columns: [leftRegion, middleRegion, rightRegion],
              },
            ],
          ],
        },
        layout: cardLayout,
      });
    }
  }

  return {
    margin: [CONTENT_INSET, 4, CONTENT_INSET, 6],
    stack,
  };
}

/**
 * Build the verifier endorsement block as a soft tinted card followed by
 * the synthetic-data disclaimer. The verifier name+regNo are picked
 * deterministically from `report.registrationId` so the same report
 * always signs out to the same pathologist (dedup stability).
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function endorsementBlock(report) {
  // Deterministic verifier: sum of char codes mod pool size. Same
  // algorithm as corporate-clean — repeated here rather than imported
  // to keep the layout file self-contained.
  let hash = 0;
  for (const ch of report.registrationId) {
    hash = (hash + ch.charCodeAt(0)) % 1_000_003;
  }
  const verifier = VERIFIERS[hash % VERIFIERS.length];

  return {
    margin: [CONTENT_INSET, 12, CONTENT_INSET, 0],
    stack: [
      // "End of Report" rule above the card — gives a visual break
      // between the last result card and the sign-off.
      {
        text: '— — —   End of Report   — — —',
        style: 'endOfReport',
        margin: [0, 4, 0, 10],
      },
      // Verifier card: tinted background, no border. We fake the
      // rounded-card look the same way as result cards above —
      // generous padding makes the right-angled corners read as soft.
      {
        table: {
          widths: ['*'],
          body: [
            [
              {
                fillColor: ENDORSEMENT_TINT,
                margin: [12, 10, 12, 10],
                border: [false, false, false, false],
                stack: [
                  {
                    text: `Verified by ${verifier.name}`,
                    style: 'signatureName',
                  },
                  {
                    text: `MCI Reg. ${verifier.regNo}`,
                    style: 'signatureMeta',
                    margin: [0, 2, 0, 6],
                  },
                  {
                    text:
                      'This report has been reviewed and digitally endorsed. '
                      + 'DISCLAIMER: synthetic test data generated by '
                      + 'lab-pdf-gen for the LabSense agent test bench — '
                      + 'does not represent any real patient, sample, or '
                      + 'clinical finding; must not be used for diagnosis '
                      + 'or treatment. All names, IDs, and brandings are '
                      + 'fictitious.',
                    style: 'disclaimer',
                  },
                ],
              },
            ],
          ],
        },
        layout: 'noBorders',
      },
    ],
  };
}

/**
 * Build the page footer factory. The footer is a full-bleed accent
 * strip with centred white text — `lab-name · Page X of Y · Synthetic
 * test data — not for clinical use`. pdfmake invokes the returned
 * function once per page with `(currentPage, pageCount)`.
 *
 * Implementation note: pdfmake's footer area is positioned inside the
 * bottom page margin, so a full-bleed strip needs a width equal to the
 * A4 page width AND a zero left margin on the returned content node.
 *
 * @param {object} report
 * @returns {(currentPage: number, pageCount: number) => object}
 */
export function pageFooter(report) {
  const lab = report.patient.lab;
  return (currentPage, pageCount) => ({
    // Zero margins on left/right so the strip is flush against the page
    // edge — same trick as the banner header at the top.
    margin: [0, 18, 0, 0],
    table: {
      widths: [A4_WIDTH_PT],
      heights: [22],
      body: [
        [
          {
            text: `${lab.name}  ·  Page ${currentPage} of ${pageCount}  ·  Synthetic test data — not for clinical use`,
            style: 'footerSmall',
            fillColor: lab.accentColor,
            margin: [0, 7, 0, 0],
            border: [false, false, false, false],
          },
        ],
      ],
    },
    layout: 'noBorders',
  });
}

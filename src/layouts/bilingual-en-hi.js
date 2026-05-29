/**
 * Layout: Bilingual English + Hindi (Devanagari).
 *
 * # Purpose
 * Government / public-sector / North-Indian state-mandated bilingual lab
 * report. Every label-bearing text node appears in BOTH English and
 * Devanagari Hindi (English first, Hindi in parentheses). Values
 * themselves (numerics, units, IDs, dates, doctor names) stay in
 * English because that is how real Indian bilingual lab reports are
 * printed — only labels are translated, not patient-specific data.
 *
 * Drives layout #8 of the 8-layout pluggable layout system. Visually
 * a sibling of `corporate-clean` — same chrome (accent monogram,
 * coloured panel bar, zebra table), with bilingual labels layered on
 * top so the file doubles as an OCR stress test for the same data
 * rendered in two scripts.
 *
 * # Font-family contract (cross-agent)
 * Devanagari text is rendered with `font: 'NotoSansDevanagari'` on
 * the inline pdfmake text node. A SIBLING fan-out agent is vendoring
 * the Noto Sans Devanagari TTFs under `assets/fonts/` and registering
 * the family with pdfmake's VFS in parallel with this work. We
 * assume the family name `'NotoSansDevanagari'` (Regular + Bold) is
 * available at render time. If it is missing the renderer logs a
 * one-line warning and falls back to Roboto, which will render the
 * Devanagari code points as `.notdef` boxes — that's the documented
 * graceful-degradation behaviour and this file does not need to
 * detect it.
 *
 * # Role in the pipeline
 *   generators/* ──▶ Report (with .layoutKey='bilingual-en-hi') ──▶ panel template
 *                                                                    │
 *                                                                    └─uses─▶ layouts/bilingual-en-hi.js
 *                                                                              │
 *                                                                              └─emits─▶ pdfmake docDefinition
 *
 * # 10-export contract (every layout MUST export these — same shape
 * as corporate-clean.js)
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
 * - Page margins requested by the spec are `[40, 70, 40, 60]`. The
 *   header is slightly more compact than corporate-clean's 90 top
 *   margin because the lab name stays single-line (English-only).
 * - Default font for Latin/numeric text is `'Roboto'`; Devanagari
 *   strings are tagged inline with `font: 'NotoSansDevanagari'`.
 * - Indian addresses on real bilingual reports are printed in English,
 *   so the right-column address stays English-only.
 * - Group sub-headers (e.g. "Erythrocyte Profile") and analyte names
 *   inside the results table are NOT translated — they are scientific
 *   nomenclature and translating them per row would (a) be error-prone
 *   and (b) double the table height, which breaks the OCR-test goal of
 *   keeping the data layout comparable to the monolingual layouts.
 */

/**
 * English-to-Hindi label dictionary. Centralised so the labels match
 * across the patient block, panel bar, table header, signature line
 * and footer. Lookup is by EXACT English label string (case-sensitive)
 * to keep the call sites trivial.
 *
 * Translations chosen to match common usage on Indian government /
 * public-hospital bilingual lab forms — they are intentionally formal
 * (e.g. "रोगी" for "patient" rather than the colloquial "मरीज़").
 *
 * @type {Readonly<Record<string, string>>}
 */
const EN_HI_LABELS = Object.freeze({
  'Patient Name': 'रोगी का नाम',
  Name: 'नाम',
  'Age/Sex': 'आयु/लिंग',
  'Age / Sex': 'आयु/लिंग',
  'Patient ID': 'रोगी आईडी',
  MRN: 'एमआरएन',
  Mobile: 'मोबाइल',
  'Registration ID': 'पंजीकरण आईडी',
  'Sample ID': 'सैंपल आईडी',
  'Sample Date': 'नमूना तिथि',
  'Report Date': 'रिपोर्ट तिथि',
  'Referring Doctor': 'परामर्श चिकित्सक',
  Department: 'विभाग',
  Specimen: 'नमूना',
  Test: 'परीक्षण',
  Result: 'परिणाम',
  Unit: 'इकाई',
  'Reference Range': 'संदर्भ सीमा',
  Flag: 'टिप्पणी',
  Method: 'विधि',
  'Verified by': 'द्वारा सत्यापित',
  Page: 'पृष्ठ',
  of: 'का',
  'Patient Details': 'रोगी विवरण',
  'Sample Details': 'नमूना विवरण',
  'End of Report': 'रिपोर्ट समाप्त',
  'Consultant Pathologist': 'परामर्श रोगविज्ञानी',
});

/**
 * Lab-tagline translations. Real bilingual reports translate the
 * tagline line because it is short prose (e.g. "NABL Accredited")
 * rather than data. Keyed by the EXACT English tagline string used
 * in `labs.js`. If a lab's tagline is not in this map we fall back
 * to a generic Hindi tagline (`गुणवत्ता निदान` — "Quality Diagnostics").
 *
 * @type {Readonly<Record<string, string>>}
 */
const TAGLINE_HI = Object.freeze({
  'NABL Accredited • Synthetic Sample Data':
    'एनएबीएल मान्यता प्राप्त • सिंथेटिक नमूना डेटा',
  'For Testing Only — Not for Clinical Use':
    'केवल परीक्षण हेतु — नैदानिक उपयोग नहीं',
  'Quality • Accuracy • Reliability (Test Data)':
    'गुणवत्ता • सटीकता • विश्वसनीयता (परीक्षण डेटा)',
  'Synthetic Lab Data — LabSense Test Bench':
    'सिंथेटिक प्रयोगशाला डेटा — लैबसेंस परीक्षण मंच',
});

/** Generic Hindi tagline used when a lab's tagline isn't mapped. */
const TAGLINE_HI_FALLBACK = 'गुणवत्ता निदान';

/**
 * Build a pdfmake inline-array text node that renders the given
 * English label followed by its Hindi translation in parentheses.
 *
 * pdfmake's inline-array pattern is the only way to mix fonts within
 * a single visual line: each element of the `text` array can carry
 * its own `font`, `bold`, etc. The renderer joins them with no extra
 * spacing, so we add the ` (`, `)` literal fragments ourselves.
 *
 * If the label has no translation in `EN_HI_LABELS` we return the
 * plain English string — the call site can hand the result to any
 * pdfmake content slot that accepts either a string or a styled
 * node.
 *
 * Note: only the English fragment is marked `bold: true` by default;
 * `bold` is also set on the Hindi fragment so the visual weight
 * matches across scripts (Devanagari at the same point size as Latin
 * tends to look slightly lighter, so bolding both keeps the row
 * legible).
 *
 * @param {string} enLabel
 * @returns {string | { text: Array<object> }}
 */
function bilingual(enLabel) {
  const hi = EN_HI_LABELS[enLabel] || '';
  if (!hi) return enLabel;
  return {
    text: [
      { text: enLabel, bold: true },
      { text: ' (' },
      // Devanagari fragment: explicit font family. The renderer's
      // font registry resolves this; missing-font behaviour is
      // documented in the file header.
      { text: hi, font: 'NotoSansDevanagari', bold: true },
      { text: ')' },
    ],
  };
}

/**
 * Fixed pool of fictitious consultant pathologist names + registration
 * numbers used by `endorsementBlock`. Same pool as the other layouts
 * — keeping it local (not in labs.js) means verifier assignment is
 * independent of which lab issued the report.
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
 * Two-digit zero-pad helper for the hand-built date formatter.
 * Inlined to honour the CLAUDE.md "no new dependencies" rule.
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
 * Format a Date as `26-May-2026`. Locale-independent to keep
 * `same seed ⇒ same bytes` deterministic across Linux CI and macOS
 * developer machines. Date values are English/Latin numerics on
 * bilingual reports — we don't render dates in Devanagari numerals.
 *
 * @param {Date} d
 * @returns {string}
 */
export function formatDate(d) {
  return `${pad2(d.getDate())}-${MONTH_ABBREV[d.getMonth()]}-${d.getFullYear()}`;
}

/**
 * Format a Date as `26-May-2026  14:30 IST`. The `IST` suffix is
 * appropriate — all synthetic patients are Indian and the host TZ
 * is ignored.
 *
 * @param {Date} d
 * @returns {string}
 */
export function formatDateTime(d) {
  return `${formatDate(d)}  ${pad2(d.getHours())}:${pad2(d.getMinutes())} IST`;
}

/**
 * Map an analyte flag character to a pdfmake text fragment. Identical
 * to corporate-clean — flag glyphs ('N', 'H', 'L', 'C') stay as
 * single Latin letters because that is how Indian bilingual reports
 * print them in practice.
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
 * pdfmake `styles` object used across this layout. Mirrors
 * corporate-clean's style names so panel templates can switch layouts
 * with no template-side changes. A few line-height / size tweaks
 * relative to corporate-clean: bilingual labels are visually taller
 * than monolingual ones, so we bump `lineHeight` on label-bearing
 * styles slightly so two-script lines don't crowd.
 *
 * @returns {Record<string, object>}
 */
export function commonStyles() {
  return {
    h1: { fontSize: 16, bold: true },
    h2: { fontSize: 11, bold: true },
    tagline: { fontSize: 8, italics: true, color: '#666666', lineHeight: 1.25 },
    addressLine: { fontSize: 8, color: '#444444', alignment: 'right' },
    sectionLabel: {
      fontSize: 8,
      bold: true,
      color: '#888888',
      characterSpacing: 0.5,
    },
    fieldLabel: { fontSize: 8, color: '#666666', lineHeight: 1.25 },
    fieldValue: { fontSize: 9, bold: false, color: '#222222' },
    panelTitle: { fontSize: 12, bold: true, color: 'white' },
    panelMeta: { fontSize: 8, color: '#FFFFFF', lineHeight: 1.25 },
    tableHeader: { fontSize: 9, bold: true, color: 'white', lineHeight: 1.2 },
    groupHeader: { fontSize: 9, bold: true },
    flag: { bold: true, alignment: 'center' },
    interpretation: { fontSize: 9, italics: true, color: '#333333' },
    disclaimer: { fontSize: 7, italics: true, color: '#888888', lineHeight: 1.25 },
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
 * Base page definition merged into every panel template via spread.
 *
 * Spec-mandated margins: `[40, 70, 40, 60]`. Top margin (70) is
 * tighter than corporate-clean (90) because the header stays
 * single-line — the tagline gets a bilingual treatment but doesn't
 * wrap; the lab name and address stay English-only.
 *
 * @returns {object} partial pdfmake docDefinition
 */
export function defaultPageDefinition() {
  return {
    pageSize: 'A4',
    pageMargins: [40, 70, 40, 60],
    defaultStyle: {
      // Latin/numeric default. Devanagari fragments override via the
      // inline `font: 'NotoSansDevanagari'` carried by `bilingual()`.
      font: 'Roboto',
      fontSize: 9,
      lineHeight: 1.15,
      color: '#222222',
    },
  };
}

/**
 * Build the lab letterhead block:
 *   [monogram square]   Lab Name (English-only)             Address (English)
 *                       Tagline EN (Tagline HI)
 *   ─────────────────── accent-coloured rule ───────────────────
 *
 * Bilingual coverage: only the tagline is translated. Lab name stays
 * English-only (real Indian bilingual letterheads keep the brand in
 * English), and Indian addresses are conventionally printed in English.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function headerBlock(report) {
  const lab = report.patient.lab;
  const taglineHi = TAGLINE_HI[lab.tagline] || TAGLINE_HI_FALLBACK;

  // Tagline node uses pdfmake's inline-array form so the Hindi
  // fragment carries its own `font` family. We italicise the English
  // side (matching the `tagline` style) but leave the Hindi upright
  // — italic Devanagari from Noto Sans Devanagari is not shipped, so
  // forcing italics would risk a synthetic-oblique fallback.
  const taglineNode = {
    text: [
      { text: lab.tagline, italics: true },
      { text: '  (' },
      { text: taglineHi, font: 'NotoSansDevanagari' },
      { text: ')' },
    ],
    style: 'tagline',
  };

  return {
    margin: [0, 0, 0, 8],
    stack: [
      {
        columns: [
          // Accent-fill monogram square, identical mechanics to
          // corporate-clean — single-cell borderless table with a
          // fillColor. pdfmake has no border-radius primitive.
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
            layout: 'noBorders',
          },
          {
            width: '*',
            margin: [10, 2, 0, 0],
            stack: [
              { text: lab.name, style: 'h1', color: lab.accentColor },
              taglineNode,
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
      {
        margin: [0, 6, 0, 0],
        canvas: [
          {
            type: 'line',
            x1: 0,
            y1: 0,
            x2: 515, // A4 width (595) − 40 − 40 left/right margins.
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
 * Build the patient + sample metadata block as a two-column key/value
 * layout. Every LABEL on the left side of each row is bilingual;
 * every VALUE on the right side stays English / numeric (names, IDs,
 * dates).
 *
 * Section headings (`PATIENT DETAILS` / `SAMPLE DETAILS`) get the
 * bilingual treatment too — they are short prose, not identifiers.
 *
 * pdfmake quirk: keeping the left column width fixed at 110 (wider
 * than corporate-clean's 85) gives bilingual labels enough room not
 * to wrap on a single line; if a translation is unusually long the
 * pdfmake text engine falls back to soft-wrap, which is fine.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function patientBlock(report) {
  const { patient, sampleDate, reportDate, registrationId, sampleId } = report;

  /**
   * Build one side of the patient/sample table. Each row is
   * `[bilingual-label, plain-value]`.
   *
   * @param {Array<[string, string]>} rows
   * @returns {object}
   */
  const makeKVTable = (rows) => ({
    table: {
      widths: [110, '*'],
      body: rows.map(([k, v]) => [
        {
          // bilingual() returns either a string or an inline-array
          // text node; both forms are valid pdfmake cell contents.
          ...(typeof bilingual(k) === 'string'
            ? { text: bilingual(k) }
            : bilingual(k)),
          style: 'fieldLabel',
          border: [false, false, false, false],
        },
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
            // Section heading uses bilingual() too so the Hindi label
            // appears in the same row of the heading.
            ...(() => {
              const node = bilingual('Patient Details');
              return typeof node === 'string' ? { text: node } : node;
            })(),
            style: 'sectionLabel',
            margin: [0, 0, 0, 3],
          },
          makeKVTable([
            ['Patient Name', patient.name],
            ['Age/Sex', `${patient.age} yrs / ${patient.sex === 'F' ? 'Female' : 'Male'}`],
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
            ...(() => {
              const node = bilingual('Sample Details');
              return typeof node === 'string' ? { text: node } : node;
            })(),
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
 * Build the coloured panel title bar.
 *
 * - Panel title: English-only. Lab test names in India are written
 *   in English on real reports; translating them ("Complete Blood
 *   Count" → "संपूर्ण रक्त गणना") would require a per-panel dictionary
 *   that is out of scope for v1.
 * - Department line: bilingualised by appending ` | विभाग` so the
 *   word "Department" is shown in Hindi without the renderer having
 *   to look up each individual department name.
 * - Specimen line: prefixed with bilingual "Specimen" label.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function panelTitleBar(report) {
  const lab = report.patient.lab;

  // Department string: append a Hindi "विभाग" suffix using the
  // inline-array form so the Hindi fragment carries its own font.
  const deptNode = {
    text: [
      { text: report.panelDept, color: '#FFFFFF' },
      { text: ' | ', color: '#FFFFFF' },
      { text: 'विभाग', font: 'NotoSansDevanagari', color: '#FFFFFF' },
    ],
    style: 'panelMeta',
  };

  // Specimen string: bilingual "Specimen" label + the English value.
  const specimenNode = {
    text: [
      { text: 'Specimen', color: '#FFFFFF', bold: true },
      { text: ' (', color: '#FFFFFF' },
      {
        text: EN_HI_LABELS.Specimen,
        font: 'NotoSansDevanagari',
        color: '#FFFFFF',
        bold: true,
      },
      { text: '): ', color: '#FFFFFF' },
      { text: report.panelSpecimen, color: '#FFFFFF' },
    ],
    style: 'panelMeta',
  };

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
            stack: [deptNode, specimenNode],
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
 * Returns true iff any row in any group of this report carries a
 * non-null `method`. When true, the results table renders a Method
 * column; otherwise it is omitted to keep the table compact.
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
 * Header columns are BILINGUAL — each column header reads
 * `English (हिन्दी)`. Body rows stay English-only:
 *   - analyte names are scientific nomenclature (would need a 200+
 *     entry dictionary to translate accurately, out of scope for v1)
 *   - values are numeric / unit literals
 *   - flags are single-letter glyphs (N/H/L/C)
 *
 * Group sub-headers (e.g. "Erythrocyte Profile") also stay
 * English-only for the same nomenclature reason — translating
 * "Erythrocyte" to "लाल रक्त कोशिका" per row would clutter the table
 * without OCR-test value (those strings aren't on the table-extraction
 * path we care about).
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function resultsTable(report) {
  const lab = report.patient.lab;
  const showMethod = reportHasAnyMethod(report);
  const colCount = showMethod ? 6 : 5;

  // Column widths: Test gets the lion's share, numerics hug. Slightly
  // wider Test column than corporate-clean to absorb bilingual header
  // height (we use '*' so this is implicit, no change).
  const widths = showMethod
    ? ['*', 'auto', 'auto', 'auto', 'auto', 30]
    : ['*', 'auto', 'auto', 'auto', 30];

  /**
   * One table-header cell rendered as a bilingual stack. We use a
   * two-line stack (English on line 1, Hindi on line 2) rather than
   * parentheses here because the table header gets tight horizontal
   * space — stacking keeps each column narrow.
   *
   * @param {string} enLabel
   * @param {string} [align]
   * @returns {object}
   */
  const th = (enLabel, align = 'left') => {
    const hi = EN_HI_LABELS[enLabel] || '';
    return {
      stack: hi
        ? [
            { text: enLabel, bold: true, color: 'white', alignment: align },
            {
              text: hi,
              font: 'NotoSansDevanagari',
              bold: true,
              color: 'white',
              alignment: align,
              fontSize: 8,
            },
          ]
        : [{ text: enLabel, bold: true, color: 'white', alignment: align }],
      style: 'tableHeader',
      fillColor: lab.accentColor,
      margin: [4, 4, 4, 4],
    };
  };

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
    // Group subheader: spans all columns. pdfmake colSpan rule —
    // the spanning cell holds `colSpan: N`, and the following N-1
    // array slots in this row must be literally present as `{}`.
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
      // Zebra stripe by DATA-row index (subheaders do not count).
      const stripe = dataRowIdx % 2 === 1 ? '#F5F5F5' : null;

      // Critical rows: subtle red wash overrides the zebra stripe so
      // they jump out on a quick skim.
      const isCritical = row.flag === 'C';
      const rowFill = isCritical ? '#FFEBEE' : stripe;

      /**
       * Build one body cell honouring the per-row fill.
       * @param {string | object} content
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
    }
  }

  return {
    margin: [0, 2, 0, 6],
    table: {
      headerRows: 1,
      widths,
      body,
    },
    // Faint horizontals only — matches printed Indian lab-report style.
    layout: 'lightHorizontalLines',
  };
}

/**
 * Build the closing block: "End of Report" marker (bilingual),
 * verifying-pathologist signature (bilingual "Verified by" /
 * "Consultant Pathologist" labels; name + reg-no stay English),
 * and a bilingual two-sentence disclaimer.
 *
 * Verifier is picked deterministically from the fixed pool using a
 * sum-of-charcodes hash of the registration ID — keeps the same
 * report stable across re-renders (dedup test invariant) while
 * varying the signer across patients.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function endorsementBlock(report) {
  // Deterministic verifier pick: sum of character codes in the
  // registration ID modulo pool size. Not cryptographically
  // meaningful — just stable.
  let hash = 0;
  for (const ch of report.registrationId) {
    hash = (hash + ch.charCodeAt(0)) % 1_000_003;
  }
  const verifier = VERIFIERS[hash % VERIFIERS.length];

  // Bilingual "End of Report" marker rendered as an inline array so
  // Hindi fragment carries the Devanagari font.
  const endMarker = {
    text: [
      { text: '— — —   End of Report   ' },
      { text: '(', italics: true },
      {
        text: EN_HI_LABELS['End of Report'],
        font: 'NotoSansDevanagari',
        italics: true,
      },
      { text: ')', italics: true },
      { text: '   — — —' },
    ],
    style: 'endOfReport',
    margin: [0, 8, 0, 14],
  };

  // Bilingual "Consultant Pathologist" label under the signature.
  const consultantNode = {
    text: [
      { text: 'Consultant Pathologist' },
      { text: ' (' },
      {
        text: EN_HI_LABELS['Consultant Pathologist'],
        font: 'NotoSansDevanagari',
      },
      { text: ')' },
    ],
    style: 'signatureMeta',
  };

  // Two-sentence bilingual disclaimer. English sentence first
  // (matches reading order on Indian bilingual forms), Hindi
  // translation second on its own line for legibility.
  const disclaimerNode = {
    text: [
      {
        text:
          'DISCLAIMER: This document is synthetic test data generated by '
          + 'lab-pdf-gen for the LabSense agent test bench. It does not '
          + 'represent any real patient, sample, or clinical finding and '
          + 'must not be used for diagnosis, treatment, or any clinical '
          + 'decision. All names, IDs, and laboratory brandings are '
          + 'fictitious.\n',
      },
      {
        text:
          'अस्वीकरण: यह दस्तावेज़ लैबसेंस एजेंट परीक्षण मंच हेतु '
          + 'lab-pdf-gen द्वारा निर्मित सिंथेटिक परीक्षण डेटा है। यह किसी '
          + 'वास्तविक रोगी, नमूने या नैदानिक निष्कर्ष का प्रतिनिधित्व नहीं '
          + 'करता और इसका उपयोग निदान, उपचार या किसी भी नैदानिक निर्णय '
          + 'हेतु नहीं किया जाना चाहिए। सभी नाम, आईडी और प्रयोगशाला '
          + 'ब्रांडिंग काल्पनिक हैं।',
        font: 'NotoSansDevanagari',
      },
    ],
    style: 'disclaimer',
  };

  return {
    margin: [0, 10, 0, 0],
    stack: [
      endMarker,
      {
        // Right-aligned signature block. Blank top line suggests
        // where an ink/e-signature would go on a printed report.
        alignment: 'right',
        stack: [
          { text: ' ', margin: [0, 0, 0, 18] },
          { text: '_____________________________', color: '#888888' },
          { text: verifier.name, style: 'signatureName' },
          consultantNode,
          { text: `Reg. No. ${verifier.regNo}`, style: 'signatureMeta' },
        ],
      },
      { margin: [0, 14, 0, 0], ...disclaimerNode },
    ],
  };
}

/**
 * Page footer factory consumed by pdfmake. pdfmake passes
 * `(currentPage, pageCount)` to this on each page; the returned node
 * is sized to fit inside the bottom margin (60px).
 *
 * Layout: thin grey rule, then a single line of small-print text:
 *   left   — bilingual "Page X of Y" (`Page` + `of` translated)
 *   centre — lab registration number (English)
 *   right  — synthetic-data warning (English + short Hindi gloss)
 *
 * @param {object} report
 * @returns {(currentPage: number, pageCount: number) => object}
 */
export function pageFooter(report) {
  const lab = report.patient.lab;
  return (currentPage, pageCount) => {
    // Bilingual "Page X of Y" rendered inline so the Hindi fragments
    // carry the Devanagari font without disturbing the numerics.
    const pageNode = {
      text: [
        { text: 'Page ' },
        {
          text: EN_HI_LABELS.Page,
          font: 'NotoSansDevanagari',
        },
        { text: ` ${currentPage} ` },
        { text: 'of ' },
        {
          text: EN_HI_LABELS.of,
          font: 'NotoSansDevanagari',
        },
        { text: ` ${pageCount}` },
      ],
      style: 'footerSmall',
    };

    // Right-hand warning: short English + Hindi gloss. We keep this
    // tight so it fits on a single line of the 7pt footer text.
    const warningNode = {
      text: [
        { text: 'Synthetic — not for clinical use ' },
        { text: '(' },
        {
          text: 'सिंथेटिक — नैदानिक उपयोग नहीं',
          font: 'NotoSansDevanagari',
        },
        { text: ')' },
      ],
      style: 'footerSmall',
      alignment: 'right',
    };

    return {
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
            { width: 'auto', ...pageNode },
            {
              width: '*',
              text: `Reg: ${lab.regNumber}`,
              style: 'footerSmall',
              alignment: 'center',
            },
            { width: 'auto', ...warningNode },
          ],
        },
      ],
    };
  };
}

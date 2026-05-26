/**
 * Layout: Faxed / Photocopied Look.
 *
 * # Purpose
 * Drives layout #7 of the 8-layout pluggable system. Mimics a photocopied
 * or low-fidelity fax of an otherwise normal corporate lab report. The
 * report's *content* is fully real (same Report shape, same panel rows,
 * same verifier pool, same disclaimer) — only the *rendering* is
 * degraded. The objective is to stress-test the downstream OCR + parsing
 * pipeline on realistic low-quality inputs without resorting to any
 * external post-processing step (no ImageMagick blur, no scanner sim).
 *
 * # Degradation effects implemented (each is intentional, not a bug)
 *  1. Global text colour pushed off pure-black (`#3D3D3D`) to simulate
 *     the contrast loss of a second- or third-generation photocopy.
 *  2. Body fontSize bumped to 9.5 + lineHeight 1.35 — looks like a
 *     slightly-zoomed photocopy where the operator over-scaled.
 *  3. `characterSpacing: 0.4` on the default style — emulates the
 *     "ink-spread" / toner-bleed look of a fax. pdfmake supports
 *     `characterSpacing` per-text and on `defaultStyle`.
 *  4. The lab's `accentColor` is overridden to a desaturated grey-blue
 *     (`#6B7280`) because real photocopies wash brand colour out of
 *     the headline + panel-bar regions.
 *  5. Full-page light-grey rectangle (`#ECECEC`) as the very first
 *     content node, positioned via `absolutePosition: { x: 0, y: 0 }`
 *     with a pdfmake canvas `rect` sized to A4 (595x842 pt). pdfmake
 *     does not expose a true "page background" API — the documented
 *     `background:` docDefinition key is an alternative, but the
 *     first-content + absolutePosition trick keeps the page-background
 *     logic inside the same module that owns the other degradation
 *     tricks (rather than splitting between this file and main.js /
 *     the renderer).
 *  6. Three faint horizontal "scan-line" rules (`#D5D5D5`, lineWidth
 *     0.3) at fixed Y coordinates — they look like the horizontal
 *     banding old fax machines leave behind. Also positioned with
 *     `absolutePosition`.
 *  7. A small irregular "toner smudge" — an 8-vertex polyline forming
 *     an oval-ish blob in either the top-right or bottom-left corner.
 *     The corner choice is deterministic from a hash of
 *     `registrationId` so re-rendering the same report is stable.
 *  8. Header rule + section dividers use a *dashed* line pattern
 *     (`dash: { length: 2, space: 1.5 }`) in a flat grey, evoking the
 *     stepped horizontal scan of an old fax.
 *  9. Patient block + results table borders are dashed grey instead of
 *     solid. No row fills (zebra striping removed) because photocopies
 *     don't preserve background tint.
 * 10. Flag column renders H / L / C / N in bold *grey* — colour is
 *     deliberately gone, because a real photocopy / fax of a colour
 *     original collapses to greyscale.
 *
 * # pdfmake quirks worth noting (so a reviewer doesn't second-guess)
 * - `absolutePosition: { x, y }` is per-content-node and works on any
 *   node, including the `canvas` node we use for the page-tint rect
 *   and the scan-line rules. The node still consumes flow space if
 *   you give it a stack — keeping these as bare `canvas` nodes avoids
 *   that and they overlay subsequent flowed content.
 * - `dash: { length, space }` lives on individual canvas vector
 *   elements (line / rect / polyline). It is NOT a table-border
 *   property; for dashed table borders we draw a synthetic canvas
 *   rectangle behind the table using `pageBreakBefore: false` and
 *   keep the table itself border-less, OR we accept solid grey
 *   borders via the table layout's `hLineColor` / `vLineColor`. We
 *   take the second route here for simplicity — dashed *separators*
 *   above/below the table (drawn via canvas) carry the "dashed" feel
 *   visually, while the table's own grid stays solid-but-grey.
 * - `characterSpacing` on `defaultStyle` propagates to every text
 *   node unless explicitly overridden, exactly what we want.
 *
 * # Out of scope (deliberate)
 * No rotation, no skew, no per-glyph jitter — pdfmake exposes no
 * affine transforms. Those distortions belong in a post-processing
 * raster step, not in the PDF generator.
 */

/**
 * Fixed pool of fictitious consultant pathologist names + registration
 * numbers. Identical to corporate-clean's pool so the verifier identity
 * picked for a given `registrationId` is the same regardless of layout —
 * useful when manually diff-checking two layouts of the same patient.
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
 * Layout-wide washed-out accent colour applied in place of the lab's
 * real accent. Photocopies/faxes collapse saturated colour to a flat
 * grey-blue, so all monogram fills, panel title bars, and rules use
 * this single value.
 */
// Bumped from the original `#6B7280` to a darker slate so the
// monogram tile + panel bar + page accent rules stand out against
// the page tint. The previous value sat too close to the page tint
// luminance and the monogram letter on top was effectively invisible.
const FAX_ACCENT = '#4B5563';

/**
 * Body / default text colour. Softer than pure black to simulate
 * second-generation photocopy contrast loss.
 */
// Bumped from `#3D3D3D` → `#262626` so body text reads cleanly on
// the `#ECECEC` page tint. The "photocopied" feel was overdriving
// readability — real faxes lose contrast but not to the point of
// being unscannable, which the previous value approached.
const FAX_INK = '#262626';

/**
 * Slightly darker variant used for headers + the lab name so they
 * still stand out against the body text inside the washed-out palette.
 */
const FAX_INK_DARK = '#111111';

/**
 * Dashed-rule grey used for the header underline and section dividers.
 */
const FAX_RULE = '#8A8A8A';

/**
 * Dashed-border grey used for the patient + results tables.
 */
const FAX_BORDER = '#9A9A9A';

/**
 * Page-background tint (full-page rectangle behind all content).
 */
const FAX_PAGE_TINT = '#ECECEC';

/**
 * Scan-line rule colour — faint enough to look like banding, not
 * intentional structure.
 */
const FAX_SCAN_LINE = '#D5D5D5';

/**
 * Smudge polygon fill colour.
 */
const FAX_SMUDGE = '#D8D8D8';

/**
 * A4 dimensions in pdfmake points (1 pt = 1/72 in). Hard-coded here
 * because we draw the page-background rect at absolute coordinates,
 * before pdfmake's page-layout engine can hand us a width.
 */
const A4_W = 595;
const A4_H = 842;

/**
 * Two-digit zero-padded helper for the date formatters. Inlined to
 * avoid a date-library dependency (forbidden by CLAUDE.md).
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
 * Format a Date as `26-May-2026`. We hand-build the string (rather
 * than `toLocaleDateString`) so the output is identical across the
 * Linux CI box and the developer's macOS — important for the
 * "same seed => same bytes" property of the test bench.
 *
 * @param {Date} d
 * @returns {string}
 */
export function formatDate(d) {
  return `${pad2(d.getDate())}-${MONTH_ABBREV[d.getMonth()]}-${d.getFullYear()}`;
}

/**
 * Format a Date as `26-May-2026  14:30 IST`. The `IST` suffix is
 * literal because all synthetic patients are Indian; we don't honour
 * the host TZ.
 *
 * @param {Date} d
 * @returns {string}
 */
export function formatDateTime(d) {
  return `${formatDate(d)}  ${pad2(d.getHours())}:${pad2(d.getMinutes())} IST`;
}

/**
 * Deterministic integer hash over a string. Used in two places:
 *  (1) verifier pick from the pool, and
 *  (2) which corner the smudge sits in.
 * Both must be stable across re-renders of the same `registrationId`,
 * so we use a plain sum-of-char-codes (already proven stable by the
 * corporate-clean layout).
 *
 * @param {string} s
 * @returns {number}
 */
function stableHash(s) {
  let h = 0;
  for (const ch of s) {
    h = (h + ch.charCodeAt(0)) % 1_000_003;
  }
  return h;
}

/**
 * Map an analyte flag character to a pdfmake text fragment in the
 * faxed palette. Unlike corporate-clean we deliberately drop all
 * red/blue colouring — a real photocopy of a colour original is
 * greyscale, so H/L/C/N differ only in weight and (for C) a leading
 * bullet glyph, not in hue.
 *
 * @param {'N'|'H'|'L'|'C'} flag
 * @returns {object} pdfmake text node
 */
function flagCell(flag) {
  switch (flag) {
    case 'H':
      return { text: 'H', bold: true, color: FAX_INK_DARK, alignment: 'center' };
    case 'L':
      return { text: 'L', bold: true, color: FAX_INK_DARK, alignment: 'center' };
    case 'C':
      return { text: '• C', bold: true, color: FAX_INK_DARK, alignment: 'center' };
    case 'N':
    default:
      return { text: 'N', color: FAX_INK, alignment: 'center' };
  }
}

/**
 * Returns the pdfmake `styles` object used across every panel template
 * in this layout. Centralising the colour + spacing tweaks here means
 * the degradation aesthetic stays consistent if anyone tweaks a single
 * block; we don't want one block accidentally rendering crisp & black.
 *
 * @returns {Record<string, object>}
 */
export function commonStyles() {
  return {
    h1: { fontSize: 16, bold: true, color: FAX_ACCENT, characterSpacing: 0.6 },
    h2: { fontSize: 11, bold: true, color: FAX_INK_DARK },
    tagline: { fontSize: 8, italics: true, color: '#6E6E6E' },
    addressLine: { fontSize: 8, color: '#555555', alignment: 'right' },
    sectionLabel: {
      fontSize: 8,
      bold: true,
      color: '#7A7A7A',
      // Wider character spacing on uppercase section labels mimics the
      // toner-spread look more strongly on all-caps glyphs.
      characterSpacing: 0.7,
    },
    fieldLabel: { fontSize: 8, color: '#6A6A6A' },
    fieldValue: { fontSize: 9, bold: false, color: FAX_INK },
    panelTitle: { fontSize: 12, bold: true, color: FAX_INK_DARK },
    panelMeta: { fontSize: 8, color: FAX_INK },
    tableHeader: { fontSize: 9, bold: true, color: FAX_INK_DARK },
    groupHeader: { fontSize: 9, bold: true, color: FAX_INK_DARK },
    flag: { bold: true, alignment: 'center' },
    interpretation: { fontSize: 9, italics: true, color: FAX_INK },
    disclaimer: { fontSize: 7, italics: true, color: '#7A7A7A' },
    endOfReport: {
      fontSize: 9,
      italics: true,
      color: '#7A7A7A',
      alignment: 'center',
      characterSpacing: 0.8,
    },
    signatureName: { fontSize: 9, bold: true, color: FAX_INK_DARK },
    signatureMeta: { fontSize: 8, color: '#555555' },
    footerSmall: { fontSize: 7, color: '#7A7A7A' },
  };
}

/**
 * Base page definition merged into every panel template via spread.
 * Compared to corporate-clean we:
 *   - keep pageSize A4 but use tighter top/bottom margins (40 / 70 /
 *     40 / 60 per the layout spec) — the page-tint trick draws below
 *     the margins so the user perceives the same "field" of content.
 *   - bump fontSize to 9.5 and lineHeight to 1.35 for the zoomed-
 *     photocopy feel.
 *   - apply `characterSpacing: 0.4` on `defaultStyle` for ink-spread.
 *   - default text colour is FAX_INK, not near-black.
 *
 * @returns {object} partial pdfmake docDefinition
 */
export function defaultPageDefinition() {
  return {
    pageSize: 'A4',
    // [left, top, right, bottom] — per layout spec.
    pageMargins: [40, 70, 40, 60],
    defaultStyle: {
      font: 'Roboto',
      fontSize: 9.5,
      lineHeight: 1.35,
      // characterSpacing on defaultStyle propagates to every text node
      // unless overridden — the "ink-spread" look.
      characterSpacing: 0.4,
      color: FAX_INK,
    },
    // pdfmake's documented `background:` doc-level key. The function
    // is called per page with `(currentPage, pageSize)` and the
    // returned content is painted BENEATH all flow content + header
    // + footer — exactly what we want for the photocopy tint and
    // scan-line bands. Putting these in headerBlock or as the first
    // content node (the previous attempt) made pdfmake paint them
    // on top of the flow content, hiding every patient/result row.
    background: faxedPageBackground,
  };
}

/**
 * Build the full-page tint rectangle. Drawn first so it sits behind
 * everything else; the explicit `absolutePosition: { x: 0, y: 0 }`
 * pins it to the page origin (top-left corner, ignoring margins).
 *
 * pdfmake quirk: a canvas node with an `absolutePosition` does NOT
 * consume layout flow space, so the rest of the document still flows
 * starting at the configured top margin.
 *
 * @returns {object} pdfmake content node
 */
function pageTintRect() {
  return {
    // No absolutePosition here — when invoked from the doc-level
    // `background:` callback pdfmake places the canvas at (0,0) of
    // the page automatically. Drop absolutePosition so the rect is
    // not double-positioned.
    canvas: [
      {
        type: 'rect',
        x: 0,
        y: 0,
        w: A4_W,
        h: A4_H,
        // `color` on a canvas rect is the fill; no stroke means no
        // visible border on the tint.
        color: FAX_PAGE_TINT,
      },
    ],
  };
}

/**
 * pdfmake doc-level `background` callback. Painted under every page.
 * Composes the page tint rect, scan-line bands, and toner-smudge
 * shape into a single `stack` so pdfmake renders all three at the
 * same z-layer. The smudge is deterministic per page (uses a fixed
 * corner here rather than the per-report registrationId hash — the
 * background callback can't see `report`; per-report smudge would
 * require switching to a `pageBackground(report)` export and
 * threading it through every panel template).
 *
 * @param {number} _currentPage — 1-based page index (unused; same
 *   background on every page)
 * @param {{width:number,height:number}} _pageSize — pdfmake passes
 *   the active page's dimensions; we use the static A4_W/A4_H
 *   constants so a future page-size change doesn't silently move
 *   the artefacts off-page.
 * @returns {object} pdfmake content node (stack of canvas elements)
 */
function faxedPageBackground(_currentPage, _pageSize) {
  // pdfmake's background callback wants a single canvas node, not a
  // stack of multiple canvases. Merge the tint rect, scan-line rules,
  // and the smudge polygon into one canvas array.
  return {
    canvas: [
      // Full-page tint — drawn first so subsequent shapes paint on top.
      {
        type: 'rect',
        x: 0,
        y: 0,
        w: A4_W,
        h: A4_H,
        color: FAX_PAGE_TINT,
      },
      // Four faint scan-line bands at fixed Y positions.
      ...[165, 305, 465, 625].map((y) => ({
        type: 'line',
        x1: 0,
        y1: y,
        x2: A4_W,
        y2: y,
        lineWidth: 0.3,
        lineColor: FAX_SCAN_LINE,
      })),
      // Toner-smudge polygon, fixed bottom-left corner. Per-report
      // variability was dropped here because this callback runs in a
      // closure that has no access to `report` — see the file header.
      {
        type: 'polyline',
        closePath: true,
        color: FAX_SMUDGE,
        lineWidth: 0,
        points: faxedSmudgePoints(),
      },
    ],
  };
}

/**
 * Compute the 8 vertices of the fixed bottom-left toner-smudge
 * polygon. Returned as a fresh array each call (pdfmake mutates
 * canvas arrays internally during layout).
 *
 * @returns {Array<{x:number,y:number}>}
 */
function faxedSmudgePoints() {
  const cx = 60;
  const cy = A4_H - 70;
  const rx = 18;
  const ry = 12;
  const points = [];
  for (let i = 0; i < 8; i += 1) {
    const theta = (Math.PI * 2 * i) / 8;
    points.push({
      x: cx + rx * Math.cos(theta),
      y: cy + ry * Math.sin(theta),
    });
  }
  return points;
}


/**
 * Build a small set of faint horizontal "scan-line" artifacts.
 * Three rules placed at fixed Y positions across the page — visual
 * echo of an old fax machine's horizontal banding. Drawn at
 * absolute positions so they survive content reflow.
 *
 * @returns {object[]} array of pdfmake content nodes
 */
function scanLineArtifacts() {
  // Spread roughly every ~120 vertical points across the A4 height
  // (842 pt). Four bands feels enough to read as a pattern without
  // overpowering the content underneath. When invoked from the
  // background callback the canvas y1/y2 give the absolute page Y
  // directly (no need for the per-node absolutePosition wrapper).
  const ys = [165, 305, 465, 625];
  return ys.map((y) => ({
    canvas: [
      {
        type: 'line',
        x1: 0,
        y1: y,
        x2: A4_W,
        y2: y,
        lineWidth: 0.3,
        lineColor: FAX_SCAN_LINE,
      },
    ],
  }));
}

/**
 * Build a small irregular "toner smudge" — an 8-vertex polyline
 * approximating an oval-ish blob, filled in flat grey. The corner
 * is chosen deterministically from the registrationId hash so the
 * same patient renders to the same bytes on every run.
 *
 * pdfmake supports `polyline` with a `points` array, optional
 * `closePath: true` to back-stitch to the first vertex, and `color`
 * for the fill. We use 8 points around an ellipse centre to get an
 * "almost-oval, not-quite-circle" shape that reads as organic.
 *
 * @param {string} registrationId
 * @returns {object} pdfmake content node
 */
function smudgeShape(registrationId) {
  // Two corner choices: top-right and bottom-left, picked by parity
  // of the stable hash. Either picks a centre (cx, cy) inside the
  // printable area but near the page edge.
  const h = stableHash(registrationId);
  const topRight = (h % 2) === 0;

  // Approximate radii — taken from the spec's 15-25pt range. Use
  // hash-driven offset so different patients get slightly different
  // smudge sizes; still deterministic per `registrationId`.
  const rx = 14 + ((h >> 3) % 10); // 14..23
  const ry = 9 + ((h >> 5) % 8);   // 9..16

  const cx = topRight ? A4_W - 50 : 60;
  const cy = topRight ? 55 : A4_H - 70;

  // Eight evenly-spaced angles around the centre. cos / sin generate
  // a clean ellipse; we keep this deterministic (no rng) so the
  // smudge for a given registrationId is byte-stable.
  const points = [];
  for (let i = 0; i < 8; i += 1) {
    const theta = (Math.PI * 2 * i) / 8;
    points.push({
      x: cx + rx * Math.cos(theta),
      y: cy + ry * Math.sin(theta),
    });
  }

  return {
    absolutePosition: { x: 0, y: 0 },
    canvas: [
      {
        type: 'polyline',
        // `closePath: true` joins the last vertex back to the first
        // so the polyline encloses an area pdfmake can fill.
        closePath: true,
        // `color` is the fill on a closed polyline.
        color: FAX_SMUDGE,
        lineWidth: 0,
        points,
      },
    ],
  };
}

/**
 * Build the lab letterhead block in the washed-out palette.
 * Structurally identical to corporate-clean (monogram square, lab
 * name + tagline centre, address right) but:
 *   - monogram square is grey-on-grey, not accent-on-white
 *   - lab name renders in FAX_ACCENT (desat grey-blue), not the
 *     lab's real accentColor
 *   - the horizontal rule under the header is drawn as a dashed
 *     canvas line, not a solid one
 *
 * pdfmake quirk: `dash: { length, space }` lives on individual
 * canvas vector elements (line / rect / polyline). We pass it
 * alongside `lineWidth` + `lineColor`.
 *
 * Additionally, this is the place we inject the page-tint rect,
 * scan-line artifacts, and smudge — they ride along on the header
 * stack so they appear on every page (the panel templates render
 * `headerBlock(report)` once per page, in pdfmake's `header:`
 * factory; per-page repetition of these artifacts is desired).
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function headerBlock(report) {
  const lab = report.patient.lab;
  return {
    margin: [0, 0, 0, 8],
    stack: [
      // (background tint + scan-line bands + smudge moved to the
      // doc-level `background:` callback wired in defaultPageDefinition
      // so pdfmake paints them BEHIND content. Keeping them here in
      // the stack caused the absolute-positioned rects to occlude the
      // patient block / results table on top.)
      {
        columns: [
          // Grey-on-grey monogram square. Single-cell table is the
          // cleanest way to get a filled square in pdfmake (no
          // border-radius API is available).
          {
            width: 42,
            table: {
              widths: [38],
              heights: [38],
              body: [
                [
                  {
                    text: lab.logoMonogram,
                    // Pure white on the darker FAX_ACCENT fill gives
                    // ~7:1 contrast. The previous '#F2F2F2' was too
                    // close to the page tint to read when the tile
                    // fill didn't pop perceptually (some PDF viewers
                    // anti-alias light fills against light pages so
                    // aggressively that the tile boundary disappears,
                    // and a near-white letter on top vanishes too).
                    color: '#FFFFFF',
                    bold: true,
                    fontSize: 16,
                    alignment: 'center',
                    margin: [0, 8, 0, 0],
                    fillColor: FAX_ACCENT,
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
              { text: lab.name, style: 'h1' },
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
      // Dashed grey rule under the header. `dash: { length: 2,
      // space: 1.5 }` produces a tight dot-dash pattern that reads
      // as "old fax horizontal scan".
      {
        margin: [0, 6, 0, 0],
        canvas: [
          {
            type: 'line',
            x1: 0,
            y1: 0,
            x2: 515, // A4 (595) - left margin (40) - right margin (40)
            y2: 0,
            lineWidth: 1,
            lineColor: FAX_RULE,
            dash: { length: 2, space: 1.5 },
          },
        ],
      },
    ],
  };
}

/**
 * Build the patient + sample metadata block as a two-column key/value
 * layout. Same structure as corporate-clean (independent left + right
 * tables so labels stay aligned regardless of asymmetric row counts),
 * but rendered with dashed grey borders around the key/value tables
 * to reinforce the photocopy aesthetic, and no fills.
 *
 * pdfmake quirk: cell-level `border: [L, T, R, B]` is the per-edge
 * toggle; the actual border *style* (dashed) is not exposed on table
 * cells directly. We emulate dashing by setting `border: [false, ...]`
 * on the cells and drawing dashed canvas lines above + below each
 * side panel as section separators.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function patientBlock(report) {
  const { patient, sampleDate, reportDate, registrationId, sampleId } = report;

  /**
   * Build a single-side key/value table. We keep cell borders off and
   * rely on the surrounding dashed rules for visual structure — that
   * way the table itself stays clean even though the page reads as
   * "boxed sections".
   *
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

  /**
   * Dashed grey separator rule spanning the printable width. Used
   * above + below the patient block to give it "boxed dashed" feel
   * without messing with per-cell border styles (which pdfmake does
   * not allow to be dashed).
   *
   * @returns {object}
   */
  const dashedRule = () => ({
    margin: [0, 2, 0, 2],
    canvas: [
      {
        type: 'line',
        x1: 0,
        y1: 0,
        x2: 515,
        y2: 0,
        lineWidth: 0.6,
        lineColor: FAX_BORDER,
        dash: { length: 2, space: 1.5 },
      },
    ],
  });

  return {
    margin: [0, 4, 0, 6],
    stack: [
      dashedRule(),
      {
        margin: [0, 4, 0, 4],
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
      },
      dashedRule(),
    ],
  };
}

/**
 * Build the panel title bar. Low-contrast grey fill (`#E0E0E0`) with
 * dark-grey text — no accent colour at all, because photocopies don't
 * preserve saturated brand backgrounds.
 *
 * The `report.patient.lab` argument is still accepted (in case future
 * tweaks want to surface the lab regNumber here), but is intentionally
 * unused — destructuring it out would change the signature.
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function panelTitleBar(report) {
  return {
    margin: [0, 6, 0, 6],
    table: {
      widths: ['*', 'auto'],
      body: [
        [
          {
            text: report.panelTitle,
            style: 'panelTitle',
            // Low-contrast grey wash — reads as "this is a heading"
            // without the colour-soaked feel of the source layout.
            fillColor: '#E0E0E0',
            border: [false, false, false, false],
            margin: [6, 5, 6, 5],
          },
          {
            stack: [
              { text: report.panelDept, style: 'panelMeta' },
              { text: report.panelSpecimen, style: 'panelMeta' },
            ],
            fillColor: '#E0E0E0',
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
 * Determine whether any row in any group of this report carries a
 * non-null `method`. Drives whether the results table shows the
 * Method column; identical rule to corporate-clean so panel
 * templates can keep their column-width assumptions stable across
 * layouts.
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
 * Build the grouped results table in the faxed palette.
 *
 * Column layout (no method):   Test | Result | Unit | Reference Range | Flag
 * Column layout (with method): Test | Result | Unit | Method | Reference Range | Flag
 *
 * Differences vs corporate-clean:
 *   - header row fill is flat `#D0D0D0` grey (not accent)
 *   - header text colour is dark grey (not white)
 *   - no zebra striping — faxes don't render row-level backgrounds
 *   - no red wash on critical rows — flag glyph alone conveys it
 *   - body cell borders use `hLineColor` / `vLineColor` set to
 *     `FAX_BORDER` via a custom table layout (pdfmake cannot dash
 *     table borders, but flat-grey solid borders still read as
 *     "low-contrast photocopy" rather than crisp lines)
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function resultsTable(report) {
  const showMethod = reportHasAnyMethod(report);
  const colCount = showMethod ? 6 : 5;

  const widths = showMethod
    ? ['*', 'auto', 'auto', 'auto', 'auto', 30]
    : ['*', 'auto', 'auto', 'auto', 30];

  /**
   * Build a header-row cell. Flat grey fill, dark grey bold text.
   * @param {string} label
   * @param {string} [align]
   * @returns {object}
   */
  const th = (label, align = 'left') => ({
    text: label,
    style: 'tableHeader',
    fillColor: '#D0D0D0',
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

  for (const group of report.groupedResults) {
    // Group subheader: spans all columns. pdfmake colSpan rule: the
    // spanning cell holds `colSpan: N` and the following N-1 array
    // slots must be present as empty `{}` placeholders.
    const spanRow = [
      {
        text: group.name,
        colSpan: colCount,
        style: 'groupHeader',
        // Slightly darker grey wash than the page tint so the
        // subheader still reads as a section break against the
        // page-tint background.
        fillColor: '#DCDCDC',
        margin: [4, 5, 4, 4],
      },
    ];
    for (let i = 1; i < colCount; i += 1) spanRow.push({});
    body.push(spanRow);

    for (const row of group.rows) {
      /**
       * Build one body cell with no fill (no zebra striping, no
       * critical wash — both are deliberately absent here).
       *
       * @param {string|object} content
       * @returns {object}
       */
      const bc = (content) => {
        const base = typeof content === 'string' ? { text: content } : content;
        return {
          ...base,
          margin: base.margin ?? [4, 3, 4, 3],
        };
      };

      const valueCell = bc({
        text: row.display,
        alignment: 'right',
        bold: row.flag !== 'N',
      });

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
    // Custom layout: thin flat-grey borders everywhere. pdfmake
    // does not expose dashed table borders, so we settle for
    // washed-out solid lines — the dashed separators around the
    // patient block + the dashed header rule carry the "fax" feel,
    // and the table itself stays scannable.
    layout: {
      hLineWidth: () => 0.4,
      vLineWidth: () => 0.4,
      hLineColor: () => FAX_BORDER,
      vLineColor: () => FAX_BORDER,
    },
  };
}

/**
 * Build the closing block: a centred "End of Report" marker, a
 * right-aligned signature for the verifying pathologist, and a
 * small-print disclaimer.
 *
 * Same verifier-picking logic as corporate-clean (sum-of-char-codes
 * mod pool size, stable across re-renders).
 *
 * Visual tweaks vs corporate-clean:
 *   - signature underline is a dashed grey canvas line, not the
 *     "_____________________________" underscore-glyph hack
 *   - disclaimer paragraph styled to look like washed-out small print
 *
 * @param {object} report
 * @returns {object} pdfmake content node
 */
export function endorsementBlock(report) {
  // Deterministic verifier pick — see corporate-clean for rationale.
  const verifier = VERIFIERS[stableHash(report.registrationId) % VERIFIERS.length];

  return {
    margin: [0, 10, 0, 0],
    stack: [
      {
        text: '— — —   End of Report   — — —',
        style: 'endOfReport',
        margin: [0, 8, 0, 14],
      },
      {
        alignment: 'right',
        stack: [
          // Space where a real ink signature would sit.
          { text: ' ', margin: [0, 0, 0, 18] },
          // Dashed grey signature line — canvas-drawn so we get a
          // genuine dashed pattern (an underscore glyph row, however
          // many we string together, will always render solid).
          {
            // We can't easily right-align a canvas node; instead we
            // wrap it in a fixed-width column container.
            columns: [
              { width: '*', text: '' },
              {
                width: 200,
                canvas: [
                  {
                    type: 'line',
                    x1: 0,
                    y1: 0,
                    x2: 200,
                    y2: 0,
                    lineWidth: 0.6,
                    lineColor: FAX_RULE,
                    dash: { length: 2, space: 1.5 },
                  },
                ],
              },
            ],
          },
          { text: verifier.name, style: 'signatureName', margin: [0, 4, 0, 0] },
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
 * `(currentPage, pageCount)` to the factory on each page.
 *
 * Layout: dashed grey rule, then a single small-print line with
 * page numbering on the left, lab registration in the middle, and
 * the synthetic-data warning on the right. All washed-out per the
 * layout aesthetic.
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
            lineColor: FAX_RULE,
            dash: { length: 2, space: 1.5 },
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

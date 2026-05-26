/**
 * CBC (Complete Blood Count) panel template.
 *
 * # Purpose
 * Renders a Report whose `panel === 'cbc'` into a pdfmake docDefinition. CBC
 * is our longest synthetic report (~20 analytes across Erythrocyte, Indices,
 * Leukocyte, Differential and Platelet groups) and therefore the one most
 * likely to push onto a second page on A4 — useful for the agent's
 * multi-page parsing edge cases.
 *
 * # Role in the pipeline
 * Called by src/index.js (renderer entry) after the generator has produced
 * a fully populated Report for a CBC sample. Returns a docDefinition that
 * pdfmake serialises to bytes on disk.
 *
 * # Design decisions
 * - Adds a "Clinical Interpretation" paragraph between the results table
 *   and the endorsement block. The text varies based on whether any row
 *   carries a non-N flag — this is documented as a desired hash-variety
 *   driver in the agent README; keeping the interpretation deterministic
 *   means same seed ⇒ same bytes for regression tests.
 * - We do NOT inject any analyte-level commentary (e.g. "low MCV suggests
 *   microcytic anaemia") — that level of synthesis is out of scope for a
 *   stress-test PDF and risks the document being mistaken for clinical
 *   guidance even with the synthetic-data disclaimer.
 */

import { layoutFor } from '../layouts/index.js';

/**
 * Return true if any row in the report carries a non-normal flag.
 *
 * @param {object} report
 * @returns {boolean}
 */
function hasAbnormal(report) {
  for (const group of report.groupedResults) {
    for (const row of group.rows) {
      if (row.flag !== 'N') return true;
    }
  }
  return false;
}

/**
 * Build the pdfmake docDefinition for a CBC report.
 *
 * @param {object} report — fully populated Report object, see PLAN.md for shape
 * @returns {object} pdfmake docDefinition ready to pass to PdfPrinter.createPdfKitDocument
 *
 * @example
 *   const printer = new PdfPrinter(fonts);
 *   const doc = printer.createPdfKitDocument(buildDocDefinition(report));
 *   doc.pipe(fs.createWriteStream(`out/${report.patient.id}.pdf`));
 *   doc.end();
 */
export function buildDocDefinition(report) {
  // Each Report carries the layoutKey assigned at planning time;
  // panel templates never re-pick the layout, otherwise the same
  // Report would produce different bytes across runs.
  const layout = layoutFor(report.layoutKey);

  const interpretation = hasAbnormal(report)
    ? 'Some values are outside the reference range; clinical correlation '
      + 'with patient history and additional investigations is recommended.'
    : 'All measured analytes are within the stated reference range; no '
      + 'significant haematological abnormality detected on this sample.';

  return {
    ...layout.defaultPageDefinition(),
    // pdfmake calls `header` for every page; we keep the header simple (no
    // per-page conditionals) because the lab letterhead should repeat
    // identically on every printed page.
    header: () => ({
      margin: [40, 20, 40, 0],
      stack: [layout.headerBlock(report)],
    }),
    footer: layout.pageFooter(report),
    content: [
      layout.patientBlock(report),
      layout.panelTitleBar(report),
      layout.resultsTable(report),
      {
        margin: [0, 8, 0, 0],
        stack: [
          { text: 'Clinical Interpretation', style: 'h2' },
          {
            text: interpretation,
            style: 'interpretation',
            margin: [0, 2, 0, 0],
          },
        ],
      },
      layout.endorsementBlock(report),
    ],
    styles: layout.commonStyles(),
  };
}

/**
 * Urine Routine & Microscopy panel template.
 *
 * # Purpose
 * Renders a Report whose `panel === 'urine'` into a pdfmake docDefinition.
 * The urine panel is the only panel in the generator that mixes numeric
 * analytes (pH, specific gravity, microalbumin) with qualitative ones
 * (colour, appearance, casts, crystals, microorganisms, urobilinogen) —
 * typically 10-15 rows across physical, chemical, and microscopic groups.
 *
 * # Role in the pipeline
 * Same as the other panel templates: called by the renderer after the
 * generator has populated the Report.
 *
 * # Design decisions
 * - Qualitative analytes are handled transparently by the layout's
 *   resultsTable: it prints `row.display` as-is and applies no numeric
 *   formatting, so strings like "Pale Yellow" or "Nil" flow through with
 *   no special-casing at the template level. Confirmed against
 *   src/layouts/corporate-clean.js — the value cell is built as
 *   `{ text: row.display, alignment: 'right', ... }`.
 * - Adds a "Urine-Routine Interpretation" paragraph between the results
 *   table and the endorsement block. The note covers two clinically real
 *   caveats: (a) qualitative findings need correlation with collection
 *   method and clinical history, and (b) microalbuminuria is an early
 *   nephropathy marker that warrants ACR confirmation — both are standard
 *   footnotes on real Indian urine reports.
 * - We do not branch the disclaimer on the actual findings. Always-on
 *   disclaimers match how real labs print them and keep output
 *   deterministic for regression tests.
 */

import { layoutFor } from '../layouts/index.js';

/**
 * Build the pdfmake docDefinition for a Urine Routine & Microscopy report.
 *
 * @param {object} report — fully populated Report object (must carry layoutKey)
 * @returns {object} pdfmake docDefinition
 */
export function buildDocDefinition(report) {
  const layout = layoutFor(report.layoutKey);
  return {
    ...layout.defaultPageDefinition(),
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
          { text: 'Urine-Routine Interpretation', style: 'h2' },
          {
            text:
              'Findings should be correlated with clinical history and the '
              + 'urinary sample\'s collection method (random midstream vs '
              + 'catheterised). Casts, crystals, and microorganisms can '
              + 'appear in small quantities in healthy individuals; '
              + 'persistent findings warrant repeat testing on a fresh '
              + 'first-morning sample. Trace urobilinogen is physiological. '
              + 'Positive urinary microalbumin (> 20 mg/L) is an early '
              + 'marker of nephropathy in diabetic / hypertensive patients '
              + 'and should prompt confirmation with a quantitative spot '
              + 'urine ACR (albumin-to-creatinine ratio).',
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

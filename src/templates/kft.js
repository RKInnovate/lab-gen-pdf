/**
 * KFT (Kidney / Renal Function Test) panel template.
 *
 * # Purpose
 * Renders a Report whose `panel === 'kft'` into a pdfmake docDefinition.
 * KFT panels typically include urea, creatinine, eGFR, uric acid, and the
 * core electrolytes (sodium, potassium, chloride, bicarbonate) — around
 * 7-10 analytes across one or two groups.
 *
 * # Role in the pipeline
 * Same as the other panel templates: called by the renderer after the
 * generator has populated the Report.
 *
 * # Design decisions
 * - Adds an "Interpretation Notes" paragraph between the results table and
 *   the endorsement block. The note explains the KDIGO eGFR staging
 *   (CKD-EPI 2009) and the standard caveat that a single eGFR snapshot is
 *   not a CKD diagnosis on its own — both are universal footnotes on real
 *   Indian KFT reports and reinforce the visual realism goal of the
 *   generator.
 * - We also call out the haemolysis / handling caveat for electrolytes
 *   (especially potassium) because spurious hyperkalaemia from sample delay
 *   is a clinically common pitfall that real reports do flag.
 * - We do not branch the disclaimer on the actual eGFR result. Always-on
 *   disclaimers match how real labs print them and keep the output
 *   deterministic for regression tests.
 */

import { layoutFor } from '../layouts/index.js';

/**
 * Build the pdfmake docDefinition for a Kidney Function Test report.
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
          { text: 'Interpretation Notes', style: 'h2' },
          {
            text:
              'eGFR is calculated using the CKD-EPI 2009 formula. Values '
              + '>= 90 mL/min/1.73m^2 indicate normal renal function; 60-89 '
              + 'mild decrease; 30-59 moderate decrease (CKD stage 3); 15-29 '
              + 'severe decrease (stage 4); below 15 indicates kidney failure '
              + '(stage 5). Single-point eGFR should be confirmed with a '
              + 'repeat sample 3 months apart per KDIGO guidance. Electrolyte '
              + 'values may be affected by haemolysis and sample-handling '
              + 'delays.',
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

/**
 * HbA1c (Glycated Haemoglobin) panel template.
 *
 * # Purpose
 * Renders a Report whose `panel === 'hba1c'` into a pdfmake docDefinition.
 * The HbA1c panel is short — typically HbA1c %, estimated Average Glucose
 * (eAG), and optionally a fasting / post-prandial glucose pair — so the
 * output is reliably single-page.
 *
 * # Role in the pipeline
 * Same as the other panel templates: called by the renderer after the
 * generator has populated the Report.
 *
 * # Design decisions
 * - Adds a "Glycaemic Interpretation" paragraph between the results table
 *   and the endorsement block. The note quotes the ADA 2024 diagnostic
 *   thresholds and explains the eAG conversion formula — both are standard
 *   footnotes on real Indian HbA1c reports and lend visual realism.
 * - We deliberately include the confounder caveat (haemoglobinopathies,
 *   recent transfusion, pregnancy) because the agent's OCR pipeline
 *   sometimes encounters this paragraph and we want the synthetic corpus
 *   to look representative.
 * - We do not branch the note based on whether HbA1c crosses any cutoff —
 *   always-on disclaimers match real-world reports and keep output
 *   deterministic for regression tests.
 */

import { layoutFor } from '../layouts/index.js';

/**
 * Build the pdfmake docDefinition for an HbA1c / Glycaemic Profile report.
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
          { text: 'Glycaemic Interpretation', style: 'h2' },
          {
            text:
              'ADA 2024 diagnostic thresholds: HbA1c < 5.7% normal, 5.7-6.4% '
              + 'pre-diabetes, >= 6.5% diabetes mellitus. The estimated '
              + 'Average Glucose (eAG) is derived from HbA1c using the linear '
              + 'conversion eAG (mg/dL) = (28.7 x HbA1c) - 46.7. eAG '
              + 'correlates with the average glucose exposure over the '
              + 'preceding 8-12 weeks but does NOT substitute for '
              + 'self-monitored fasting / post-prandial glucose for '
              + 'day-to-day management. Interpret in the clinical context of '
              + 'haemoglobinopathies, recent transfusion, or pregnancy, '
              + 'which can confound HbA1c.',
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

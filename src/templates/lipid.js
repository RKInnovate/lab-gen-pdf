/**
 * Lipid panel template.
 *
 * # Purpose
 * Renders a Report whose `panel === 'lipid'` into a pdfmake docDefinition.
 * The lipid panel is shorter than CBC (typically 5-7 analytes including
 * the Friedewald-derived LDL), so the rendered PDF is usually single-page.
 *
 * # Role in the pipeline
 * Same as the other panel templates: called by the renderer after the
 * generator has populated the Report.
 *
 * # Design decisions
 * - Adds a small Friedewald caveat below the table. Real Indian lab reports
 *   almost universally print this disclaimer because reflexive LDL is still
 *   uncommon outside metro tertiary centres. Including it makes the
 *   synthetic PDF visually convincing.
 * - We do not flag the case where triglycerides actually exceed 400 — the
 *   caveat is unconditional, matching real-world reports.
 */

import {
  commonStyles,
  defaultPageDefinition,
  endorsementBlock,
  headerBlock,
  pageFooter,
  panelTitleBar,
  patientBlock,
  resultsTable,
} from './shared.js';

/**
 * Build the pdfmake docDefinition for a Lipid Profile report.
 *
 * @param {object} report — fully populated Report object
 * @returns {object} pdfmake docDefinition
 */
export function buildDocDefinition(report) {
  return {
    ...defaultPageDefinition(),
    header: () => ({
      margin: [40, 20, 40, 0],
      stack: [headerBlock(report)],
    }),
    footer: pageFooter(report),
    content: [
      patientBlock(report),
      panelTitleBar(report),
      resultsTable(report),
      {
        margin: [0, 8, 0, 0],
        stack: [
          { text: 'Notes', style: 'h2' },
          {
            text:
              'LDL Cholesterol is calculated using the Friedewald formula '
              + '(LDL = Total Cholesterol − HDL − Triglycerides / 5). The '
              + 'calculated result is unreliable when triglycerides exceed '
              + '400 mg/dL; a direct LDL measurement is recommended in '
              + 'that case.',
            style: 'interpretation',
            margin: [0, 2, 0, 0],
          },
        ],
      },
      endorsementBlock(report),
    ],
    styles: commonStyles(),
  };
}

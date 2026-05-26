/**
 * LFT (Liver Function Test) panel template.
 *
 * # Purpose
 * Renders a Report whose `panel === 'lft'` into a pdfmake docDefinition.
 * LFT panels typically cover bilirubin fractions, AST, ALT, ALP, GGT and
 * protein/albumin — around 8-10 analytes in one or two groups.
 *
 * # Role in the pipeline
 * Same as the other panel templates: called by the renderer after the
 * generator has populated the Report.
 *
 * # Design decisions
 * - Adds a "Specimen handling" note. Haemolysed or lipaemic specimens
 *   genuinely confound photometric bilirubin and enzyme assays, and the
 *   note is a standard footnote on Indian LFT reports — it lends visual
 *   realism while costing nothing.
 * - We do not attempt to compute the AST/ALT (De Ritis) ratio in the
 *   rendered PDF. If product wants it later, the generator should
 *   pre-compute it and add it as a regular row, not the template.
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
 * Build the pdfmake docDefinition for a Liver Function Test report.
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
          { text: 'Specimen Handling Note', style: 'h2' },
          {
            text:
              'Haemolysed or lipaemic samples may produce erroneously '
              + 'elevated bilirubin and transaminase values. If clinical '
              + 'context does not match the reported values, a fresh '
              + 'specimen drawn under fasting conditions is advised.',
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

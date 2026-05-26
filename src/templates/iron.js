/**
 * Iron Studies panel template.
 *
 * # Purpose
 * Renders a Report whose `panel === 'iron'` into a pdfmake docDefinition.
 * The iron-studies panel typically includes serum iron, TIBC, transferrin
 * saturation, and ferritin — around 4-6 analytes in a single group.
 *
 * # Role in the pipeline
 * Same as the other panel templates: called by the renderer after the
 * generator has populated the Report.
 *
 * # Design decisions
 * - Adds an "Iron-Profile Interpretation" paragraph between the results
 *   table and the endorsement block. The note contrasts iron-deficiency
 *   anaemia with anaemia of chronic disease — this is the canonical
 *   bedside dichotomy that every real iron-studies report footnotes, and
 *   reproducing it makes the synthetic PDF visually convincing.
 * - We explicitly note that ferritin is an acute-phase reactant. This is
 *   a clinically important caveat (inflammation can mask deficiency) and
 *   is a standard footnote in real lab reports.
 * - We do not branch the disclaimer on the actual ferritin/TSAT values —
 *   always-on disclaimers match how real labs print them and keep output
 *   deterministic for regression tests.
 */

import { layoutFor } from '../layouts/index.js';

/**
 * Build the pdfmake docDefinition for an Iron Studies report.
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
          { text: 'Iron-Profile Interpretation', style: 'h2' },
          {
            text:
              'Iron-deficiency anaemia typically shows low Serum Iron, '
              + 'raised TIBC, low Transferrin Saturation (< 16%), and low '
              + 'Ferritin (< 30 ng/mL). Anaemia of chronic disease usually '
              + 'shows low/normal iron, low/normal TIBC, and raised Ferritin '
              + '(acute-phase reactant). Ferritin is acute-phase elevated in '
              + 'inflammation and may mask deficiency; if Ferritin is normal '
              + 'but other markers suggest deficiency, consider an '
              + 'inflammatory panel (ESR/CRP). A morning fasting sample is '
              + 'preferred — diurnal variation in serum iron can be '
              + 'substantial.',
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

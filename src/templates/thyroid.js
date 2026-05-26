/**
 * Thyroid panel template.
 *
 * # Purpose
 * Renders a Report whose `panel === 'thyroid'` into a pdfmake docDefinition.
 * The thyroid panel is the shortest (TSH, T3, T4 — or their free variants),
 * so the output is reliably single-page.
 *
 * # Role in the pipeline
 * Same as the other panel templates: called by the renderer after the
 * generator has populated the Report.
 *
 * # Design decisions
 * - Adds a "Reference range" note about trimester-specific TSH ranges.
 *   This is a clinically real caveat (ATA and Endocrine Society guidance
 *   both recommend trimester-specific cutoffs) and is a near-universal
 *   footnote on Indian thyroid reports — its presence reinforces the
 *   "looks like a real lab PDF" goal of the generator.
 * - We do not branch the disclaimer on patient sex/age, even though the
 *   note only matters in pregnancy. Always-on disclaimers match how real
 *   labs print them.
 */

import { layoutFor } from '../layouts/index.js';

/**
 * Build the pdfmake docDefinition for a Thyroid Function Test report.
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
          { text: 'Reference Range Note', style: 'h2' },
          {
            text:
              'Reference ranges quoted above apply to non-pregnant adults. '
              + 'TSH and free T4 ranges vary by trimester in pregnancy; '
              + 'trimester-specific ranges (per ATA / Endocrine Society '
              + 'guidance) should be applied where appropriate. Inter-assay '
              + 'variation may also exist between laboratories.',
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

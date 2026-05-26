/**
 * Fictitious lab brandings used as the header/footer chrome on
 * generated PDFs.
 *
 * # Why four labs (not one)
 * The agent's dedup hash is taken over the entire file bytes, so
 * varying the printed header is enough to push different patients'
 * PDFs into different SHA-256 buckets. With one branding all 2k
 * files would share a large run of identical pixels, which is fine
 * for the dedup path (still hashes uniquely on result rows) but
 * makes the PDFs look unrealistic when reviewed by a human and
 * doesn't exercise the rendered-template variety we care about.
 *
 * # Why these specific names
 * They are deliberately implausible suffixes ("Demo", "Synthetic",
 * "QA Path Lab") so a reviewer skimming a generated PDF can tell
 * at a glance it is *not* a real report from a real lab. We never
 * want one of these to slip into a marketing screenshot or into a
 * triage queue and be confused with production traffic.
 *
 * # Field semantics
 *   slug          — filesystem-safe, used in generated filenames
 *   name          — top-of-page banner
 *   tagline       — small italic line under the name
 *   address       — multi-line address block on the right of header
 *   phone, email  — printed in the footer
 *   regNumber     — fake NABL / ICMR registration string; printed
 *                   in the footer to look authentic
 *   accentColor   — hex string driving the header bar + table head
 *   logoMonogram  — two-letter abbreviation rendered as a square in
 *                   the header (we don't ship raster logos to keep
 *                   the generator self-contained)
 */

export const LABS = [
  {
    slug: 'medlab-demo',
    name: 'MedLab Diagnostics (Demo)',
    tagline: 'NABL Accredited • Synthetic Sample Data',
    address: [
      '4th Floor, Demo Towers',
      'M.G. Road, Bengaluru 560001',
    ],
    phone: '+91 80 0000 0000',
    email: 'info@medlab-demo.example',
    regNumber: 'NABL-DEMO/MC-0001 • CIN: U85100KA0000DEM0',
    accentColor: '#0F4C81',
    logoMonogram: 'ML',
  },
  {
    slug: 'citypath-qa',
    name: 'CityPath Pathology Centre (QA)',
    tagline: 'For Testing Only — Not for Clinical Use',
    address: [
      'Plot 12, Industrial Phase II',
      'Pune 411019',
    ],
    phone: '+91 20 0000 1111',
    email: 'qa@citypath-qa.example',
    regNumber: 'NABL-DEMO/MC-0002 • Reg. ID: PATH/MH/QA/2024',
    accentColor: '#2E7D32',
    logoMonogram: 'CP',
  },
  {
    slug: 'primehealth-synth',
    name: 'PrimeHealth Diagnostics (Synthetic)',
    tagline: 'Quality • Accuracy • Reliability (Test Data)',
    address: [
      '2nd Floor, Health Plaza',
      'Andheri East, Mumbai 400069',
    ],
    phone: '+91 22 0000 2222',
    email: 'reports@primehealth-synth.example',
    regNumber: 'NABL-DEMO/MC-0003 • GSTIN: 27AAACDEM0001Z1',
    accentColor: '#6A1B9A',
    logoMonogram: 'PH',
  },
  {
    slug: 'apex-sim',
    name: 'Apex Diagnostic Centre (Simulator)',
    tagline: 'Synthetic Lab Data — LabSense Test Bench',
    address: [
      'Ground Floor, Heritage Complex',
      'Sector 18, Noida 201301',
    ],
    phone: '+91 120 000 3333',
    email: 'ops@apex-sim.example',
    regNumber: 'NABL-DEMO/MC-0004 • Reg. ID: APX/UP/SIM/0001',
    accentColor: '#C62828',
    logoMonogram: 'AD',
  },
];

/**
 * Pick a lab branding for a patient. Recurring patients should
 * stay with the same lab across visits (real labs route follow-ups
 * to themselves), so the caller should reuse the same lab for
 * every report belonging to one patient — this helper only does
 * the initial pick.
 *
 * @param {ReturnType<import('./seedrand.js').createRng>} rng
 * @returns {(typeof LABS)[number]}
 */
export function pickLab(rng) {
  return rng.pick(LABS);
}

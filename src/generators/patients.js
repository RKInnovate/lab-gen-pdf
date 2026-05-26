/**
 * Patient + report-shell planner.
 *
 * # Purpose
 * Produces the demographic + scheduling skeleton for every report
 * the generator will emit. Each "shell" carries the patient
 * identity, the panel to run, the sample/report timestamps and the
 * lab branding — everything *except* the analyte values. The
 * value-sampling step (`analytes.fillReport`) consumes one shell at
 * a time and returns a fully populated Report ready for templating.
 *
 * # Why a separate planning pass
 * The patient mix is not uniform: ~70% of real lab traffic is
 * one-off walk-ins and ~30% is recurring patients coming back for
 * follow-ups over weeks or months. Splitting the work into a
 * planner + filler lets us reason about the *population* shape
 * (unique vs recurring, panel preference, visit cadence) without
 * tangling it into per-value sampling code. It also keeps the
 * dedup-test surface honest: the agent should see brand-new
 * patients alongside familiar ones returning with new sample IDs.
 *
 * # Determinism
 * All randomness flows through a `createRng` instance supplied by
 * the caller. Same seed in → same shells out, in the same order,
 * with the same patient IDs and timestamps. The downstream
 * `fillReport` step is similarly seeded so the whole pipeline is
 * reproducible end-to-end.
 *
 * # Why hard-coded name/doctor pools
 * The generator is self-contained on purpose — no extra deps, no
 * faker package, no network. The pools below are small but big
 * enough to give the rendered reports surface variety without
 * making the generated data look like a name-generator dump.
 */

import { pickLab } from '../labs.js';

// Indian first names split by sex. Kept intentionally short so the
// recurring-patient set has overlap with the walk-in set — the
// dedup-test cares about *file* uniqueness, not name uniqueness.
const MALE_FIRST_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Reyansh', 'Ayaan',
  'Krishna', 'Ishaan', 'Shaurya', 'Rohan', 'Karthik', 'Rahul', 'Siddharth',
  'Anirudh', 'Pranav', 'Harsh', 'Manish', 'Suresh', 'Ramesh', 'Mahesh',
  'Vikram', 'Sanjay', 'Ajay', 'Deepak', 'Nitin', 'Sandeep', 'Rajesh',
  'Prakash', 'Anil', 'Sunil', 'Amit', 'Rohit', 'Vinod', 'Mukesh',
];

const FEMALE_FIRST_NAMES = [
  'Aanya', 'Aadhya', 'Diya', 'Pari', 'Ananya', 'Saanvi', 'Myra', 'Anika',
  'Navya', 'Kiara', 'Aaradhya', 'Riya', 'Priya', 'Pooja', 'Neha', 'Sneha',
  'Anjali', 'Kavya', 'Meera', 'Lakshmi', 'Sunita', 'Geeta', 'Rekha',
  'Sushma', 'Anita', 'Vandana', 'Shweta', 'Deepika', 'Divya', 'Swati',
  'Ritu', 'Pallavi', 'Nisha', 'Shilpa', 'Sangeeta',
];

// Middle names used roughly 25% of the time. Single-letter initials
// are common on Indian lab reports too, so we mix in a handful.
const MIDDLE_NAMES = [
  'Kumar', 'Devi', 'Lal', 'Prasad', 'Chandra', 'Nath', 'Bai', 'Rani',
  'K.', 'S.', 'R.', 'M.', 'P.', 'V.',
];

const SURNAMES = [
  'Sharma', 'Verma', 'Gupta', 'Singh', 'Kumar', 'Patel', 'Shah', 'Mehta',
  'Iyer', 'Iyengar', 'Reddy', 'Naidu', 'Rao', 'Nair', 'Menon', 'Pillai',
  'Bose', 'Banerjee', 'Mukherjee', 'Chatterjee', 'Ghosh', 'Das', 'Dutta',
  'Joshi', 'Desai', 'Trivedi', 'Bhatt', 'Pandey', 'Tiwari', 'Mishra',
  'Yadav', 'Chauhan', 'Rathore', 'Khanna', 'Kapoor', 'Malhotra', 'Saxena',
];

// Fictitious referring physicians. Real labs see many referrers, so
// per-report random pick is more realistic than per-patient pin.
const REFERRING_DOCTORS = [
  'Dr. Arvind Menon, MD',
  'Dr. Sushma Iyer, MBBS',
  'Dr. Rakesh Joshi, MD (Med)',
  'Dr. Priya Nair, MBBS, DGO',
  'Dr. Kiran Reddy, MD, DM (Cardio)',
  'Dr. Sanjay Bose, MBBS, MS',
  'Dr. Anita Sharma, MD (Path)',
  'Dr. Vikram Patel, MBBS, DCH',
  'Dr. Neha Kapoor, MD (Endo)',
  'Dr. Harish Rao, MBBS',
  'Dr. Meera Banerjee, MD, DM (Gastro)',
  'Dr. Suresh Yadav, MBBS, MD',
  'Dr. Lakshmi Pillai, MBBS, DGO',
  'Dr. Aditya Mukherjee, MD (Med)',
  'Dr. Rohit Saxena, MBBS, MS (Gen Surg)',
];

const DEFAULT_PANEL_WEIGHTS = { cbc: 4, lipid: 3, lft: 2, thyroid: 2 };

// 18 months of history, in milliseconds. The recurring-patient
// scheduler spreads visits across this window with a minimum
// 14-day gap so the dates *look* like real follow-up cadences.
const EIGHTEEN_MONTHS_MS = 18 * 30 * 24 * 60 * 60 * 1000;
const MIN_VISIT_GAP_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Build a single patient identity record.
 *
 * Why pulled into a helper: the same shape is needed for both the
 * unique-walk-in path and the recurring-patient path, and keeping
 * it in one place means name/MRN/age formatting drifts can't
 * diverge between the two callers.
 *
 * @param {object} args
 * @param {ReturnType<import('../seedrand.js').createRng>} args.rng
 * @param {number} args.sequence - monotonically increasing patient counter, used for the P-XXXXXX id
 * @param {object} args.lab - lab branding object from `LABS`
 * @returns {{
 *   id: string, mrn: string, name: string,
 *   age: number, sex: 'M'|'F',
 *   referringDoctor: string, lab: object
 * }}
 */
function buildPatient({ rng, sequence, lab }) {
  const sex = rng.bool(0.5) ? 'M' : 'F';
  const firstPool = sex === 'M' ? MALE_FIRST_NAMES : FEMALE_FIRST_NAMES;
  const first = rng.pick(firstPool);
  const last = rng.pick(SURNAMES);

  // ~25% of patients carry a middle name or initial — matches the
  // mix on most Indian lab reports we've reviewed.
  const hasMiddle = rng.bool(0.25);
  const middle = hasMiddle ? rng.pick(MIDDLE_NAMES) : null;
  const name = middle ? `${first} ${middle} ${last}` : `${first} ${last}`;

  // Age skews toward 25-65 (the "I have a doctor and a checkup
  // schedule" demographic) but the full 6-92 band is reachable so
  // edge-of-physiological ranges still get exercised.
  const age = weightedAge(rng);

  // Patient ID is sequential + zero-padded; gives the dedup-test
  // a stable, sortable key without leaking the RNG order.
  const id = `P-${String(sequence).padStart(6, '0')}`;

  // MRN is lab-scoped. The 7-digit suffix is drawn fresh per
  // patient — collisions across labs are fine because the lab slug
  // namespaces them.
  const year = new Date().getFullYear();
  const mrnSuffix = String(rng.int(1, 9999999)).padStart(7, '0');
  const mrn = `${lab.slug}/MRN/${year}/${mrnSuffix}`;

  return {
    id,
    mrn,
    name,
    age,
    sex,
    referringDoctor: rng.pick(REFERRING_DOCTORS),
    lab,
  };
}

/**
 * Weighted age sampler.
 *
 * Strategy: three age bands with hand-tuned weights — the middle
 * band (25-65) gets the lion's share, the young (6-24) and old
 * (66-92) tails fill in the rest. Within a band we draw uniformly.
 * This is intentionally coarse; trying to fit a real population
 * pyramid would be overkill for synthetic test data.
 *
 * @param {ReturnType<import('../seedrand.js').createRng>} rng
 * @returns {number} integer age in years, 6..92 inclusive
 */
function weightedAge(rng) {
  const bands = [
    { min: 6, max: 24, weight: 1 },
    { min: 25, max: 65, weight: 6 },
    { min: 66, max: 92, weight: 2 },
  ];
  const band = rng.weighted(bands, (b) => b.weight);
  return rng.int(band.min, band.max);
}

/**
 * Build a registration ID + sample ID pair for one report.
 *
 * Why two IDs: real labs print both. The registration ID is the
 * front-desk-issued sequence ("REG/2026/000042"), the sample ID is
 * the barcode applied at draw time ("SMP-A1B2C3-4567"). Re-using
 * the same RNG keeps everything reproducible.
 *
 * @param {ReturnType<import('../seedrand.js').createRng>} rng
 * @param {Date} sampleDate
 * @param {number} reportSequence - monotonically increasing across the whole run
 */
function buildIds(rng, sampleDate, reportSequence) {
  const year = sampleDate.getFullYear();
  const registrationId = `REG/${year}/${String(reportSequence).padStart(6, '0')}`;

  // 6 hex chars from the RNG. We hand-roll instead of using
  // crypto.randomUUID because that path isn't seedable.
  const hex = [];
  for (let i = 0; i < 6; i += 1) {
    hex.push(rng.int(0, 15).toString(16).toUpperCase());
  }
  const numericSuffix = String(rng.int(0, 9999)).padStart(4, '0');
  const sampleId = `SMP-${hex.join('')}-${numericSuffix}`;

  return { registrationId, sampleId };
}

/**
 * Pick a panel for a single report using the supplied weights.
 *
 * @param {ReturnType<import('../seedrand.js').createRng>} rng
 * @param {string[]} panels
 * @param {Record<string, number>} weights - relative weights, panel slug → number
 * @returns {string}
 */
function pickPanel(rng, panels, weights) {
  return rng.weighted(panels, (p) => weights[p] ?? 1);
}

/**
 * Compose a sample date inside the trailing 18 months, then derive
 * a plausible report date 4-36 hours later.
 *
 * @param {ReturnType<import('../seedrand.js').createRng>} rng
 * @param {Date} now
 */
function randomSampleAndReportDate(rng, now) {
  const offsetMs = rng.int(0, EIGHTEEN_MONTHS_MS);
  const sampleDate = new Date(now.getTime() - offsetMs);
  const turnaroundHours = rng.int(4, 36);
  const reportDate = new Date(sampleDate.getTime() + turnaroundHours * 60 * 60 * 1000);
  return { sampleDate, reportDate };
}

/**
 * Plan the full set of report shells for one generator run.
 *
 * The function does two passes:
 *   1. Build `uniqueCount = round(count * uniqueFrac)` walk-in
 *      patients, one report each, panel picked by weight, fresh
 *      lab per patient.
 *   2. Build recurring patients until the remaining report budget
 *      is exhausted. Each recurring patient has a preferred panel
 *      and emits 2-5 reports — 70% on the preferred panel, 30%
 *      drift to another. All of a recurring patient's reports
 *      share the same lab.
 *
 * If the next recurring patient's batch would overshoot the budget
 * we stop early rather than truncate them — partial follow-up
 * histories look weirder than slightly fewer reports.
 *
 * @param {object} args
 * @param {ReturnType<import('../seedrand.js').createRng>} args.rng
 * @param {number} args.count - target total report count
 * @param {number} args.uniqueFrac - fraction (0..1) of reports that should belong to one-off walk-ins
 * @param {number} args.recurringMin - minimum reports per recurring patient (inclusive)
 * @param {number} args.recurringMax - maximum reports per recurring patient (inclusive)
 * @param {string[]} args.panels - allowed panel slugs (e.g. ['cbc','lipid','lft','thyroid'])
 * @param {Record<string, number>} [args.panelWeights] - relative weights for panel selection; defaults to {cbc:4, lipid:3, lft:2, thyroid:2}
 * @returns {Array<object>} report shells (see file header for shape)
 */
export function planReports({
  rng,
  count,
  uniqueFrac,
  recurringMin,
  recurringMax,
  panels,
  panelWeights,
}) {
  const weights = panelWeights ?? DEFAULT_PANEL_WEIGHTS;
  const now = new Date();
  const shells = [];

  // Sequence counters live outside the loops so unique + recurring
  // patients share a single P-XXXXXX namespace.
  let patientSequence = 1;
  let reportSequence = 1;

  const uniqueCount = Math.round(count * uniqueFrac);
  const recurringBudget = Math.max(0, count - uniqueCount);

  // -- Pass 1: unique walk-ins --
  for (let i = 0; i < uniqueCount; i += 1) {
    const lab = pickLab(rng);
    const patient = buildPatient({ rng, sequence: patientSequence, lab });
    patientSequence += 1;

    const panel = pickPanel(rng, panels, weights);
    const { sampleDate, reportDate } = randomSampleAndReportDate(rng, now);
    const { registrationId, sampleId } = buildIds(rng, sampleDate, reportSequence);
    reportSequence += 1;

    shells.push({
      patient,
      panel,
      sampleDate,
      reportDate,
      registrationId,
      sampleId,
    });
  }

  // -- Pass 2: recurring patients --
  let remaining = recurringBudget;
  while (remaining > 0) {
    // Cap the batch size at whatever budget is left. If the budget
    // is below the floor we still need to emit at least one report
    // so the patient isn't pointless — clamp to [1, remaining].
    const desired = rng.int(recurringMin, recurringMax);
    if (desired > remaining) {
      // The spec says: stop adding recurring patients once we'd
      // overshoot. A partial follow-up history is less realistic
      // than ending the recurring pool slightly early.
      break;
    }
    const visitCount = desired;

    const lab = pickLab(rng);
    const patient = buildPatient({ rng, sequence: patientSequence, lab });
    patientSequence += 1;

    const preferredPanel = pickPanel(rng, panels, weights);
    // Drift candidates = all panels except the preferred one.
    const driftCandidates = panels.filter((p) => p !== preferredPanel);

    // Spread the visits chronologically with a >=14 day gap. We
    // sample N base offsets, sort them, then enforce the gap by
    // pushing later visits forward if they're too close to their
    // predecessor. The "now" anchor is fixed for the whole batch.
    const baseOffsets = [];
    for (let v = 0; v < visitCount; v += 1) {
      baseOffsets.push(rng.int(0, EIGHTEEN_MONTHS_MS));
    }
    // Sort descending so visit 0 is the *oldest* — recurring
    // histories read chronologically forward in the shell array.
    baseOffsets.sort((a, b) => b - a);

    const visitDates = [];
    for (let v = 0; v < visitCount; v += 1) {
      let candidateMs = now.getTime() - baseOffsets[v];
      if (v > 0) {
        const prev = visitDates[v - 1].getTime();
        // Enforce minimum gap; if violated, push forward.
        if (candidateMs - prev < MIN_VISIT_GAP_MS) {
          candidateMs = prev + MIN_VISIT_GAP_MS;
        }
      }
      visitDates.push(new Date(candidateMs));
    }

    // Emit one shell per visit.
    for (let v = 0; v < visitCount; v += 1) {
      // 70% of follow-ups stay on the preferred panel. If there
      // are no drift candidates (single-panel run) we always pin.
      const stayOnPreferred = driftCandidates.length === 0 || rng.bool(0.7);
      const panel = stayOnPreferred ? preferredPanel : rng.pick(driftCandidates);

      const sampleDate = visitDates[v];
      const turnaroundHours = rng.int(4, 36);
      const reportDate = new Date(sampleDate.getTime() + turnaroundHours * 60 * 60 * 1000);
      const { registrationId, sampleId } = buildIds(rng, sampleDate, reportSequence);
      reportSequence += 1;

      // Each visit gets a fresh referring-doctor pick — recurring
      // patients often shuffle between specialists.
      const patientForVisit = {
        ...patient,
        referringDoctor: rng.pick(REFERRING_DOCTORS),
      };

      shells.push({
        patient: patientForVisit,
        panel,
        sampleDate,
        reportDate,
        registrationId,
        sampleId,
      });
    }

    remaining -= visitCount;
  }

  return shells;
}

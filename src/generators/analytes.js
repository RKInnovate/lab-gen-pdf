/**
 * Analyte value sampler + computed-analyte resolver.
 *
 * # Purpose
 * Takes a report shell from `planReports` (patient + panel + IDs)
 * and produces a fully populated Report whose `groupedResults`
 * array is ready to hand to the PDF template. Every primary
 * analyte gets a value drawn from a five-bucket distribution
 * (normal-heavy, with deliberate high/low/critical tails) and
 * every `computed` analyte is derived from its siblings *after*
 * the primary pass completes.
 *
 * # Why a bucketed sampler instead of a Gaussian
 * A Gaussian centered in the reference range would mostly produce
 * boring "all normal" reports, which doesn't exercise the printed
 * H/L/C flag columns the dedup-pipeline reviewers stare at. The
 * five-bucket distribution gives us a known, tunable mix:
 *   78% normal, 12% high, 5% low, 3% critical-high, 2% critical-low.
 * Aggregated over 2k reports this yields realistic-looking
 * mostly-normal patients with a sprinkling of out-of-range and
 * panic values, which is exactly the QA signal we want.
 *
 * # Flag semantics
 *   N — value inside the reference interval (or below the soft
 *       floor when rangeLow is 0 — see `rangeLow === 0` note)
 *   H — value above rangeHigh but still within physiological bounds
 *   L — value below rangeLow (skipped when rangeLow is 0)
 *   C — value outside [physMin * 0.95, physMax * 1.05] (i.e. so
 *       far out that a real lab would call it a panic value)
 *
 * # Why computed analytes are second-pass
 * The Friedewald LDL needs total_chol + hdl + triglycerides, the
 * A/G ratio needs albumin + globulin (which is *itself* computed
 * from total_protein and albumin), etc. Doing primaries first and
 * then walking computed in declaration order keeps the dependency
 * graph implicit-but-correct — every computed analyte declared in
 * `analyte-defs.json` already has its inputs sampled (or computed
 * earlier in the same pass) by the time we reach it.
 */

// Map of computed-analyte tags (declared in analyte-defs.json under
// the `computed` key) to (resultsByCode) → number functions. The
// functions read sibling values out of the in-progress results map
// and return a raw (un-rounded, un-clamped) number. Clamping and
// rounding live in the caller so the rules stay uniform.
const COMPUTED_FORMULAS = {
  /**
   * Friedewald LDL estimate. Standard clinical formula:
   *   LDL = TotalChol - HDL - (Triglycerides / 5).
   * Loses accuracy above triglycerides ~ 400 mg/dL, but for our
   * synthetic data we don't bother gating on that — the resulting
   * value still gets clamped to the analyte's physiological band.
   */
  ldl_friedewald(results) {
    return results.total_chol.value - results.hdl.value - results.triglycerides.value / 5;
  },

  /** VLDL ≈ triglycerides / 5 (standard estimate). */
  triglycerides_over_5(results) {
    return results.triglycerides.value / 5;
  },

  /** Total Cholesterol / HDL atherogenic ratio. */
  total_chol_over_hdl(results) {
    // Guard against a zero HDL — pathological, but a bad seed
    // could produce one and we don't want NaN in the PDF.
    return results.hdl.value > 0 ? results.total_chol.value / results.hdl.value : 0;
  },

  /** Indirect bilirubin = total - direct, clamped at zero. */
  tbili_minus_dbili(results) {
    return Math.max(results.tbili.value - results.dbili.value, 0);
  },

  /** Globulin = total protein - albumin, clamped at zero. */
  tp_minus_albumin(results) {
    return Math.max(results.total_protein.value - results.albumin.value, 0);
  },

  /** A/G ratio = albumin / globulin, guarded against div-by-zero. */
  albumin_over_globulin(results) {
    return results.globulin.value > 0 ? results.albumin.value / results.globulin.value : 0;
  },
};

// Bucket weights for the five-state sampler. Stable order matters
// for reproducibility across RNG calls — do not reorder without
// bumping a downstream comparison fixture.
const BUCKETS = [
  { tag: 'normal', weight: 78 },
  { tag: 'high', weight: 12 },
  { tag: 'low', weight: 5 },
  { tag: 'critical_high', weight: 3 },
  { tag: 'critical_low', weight: 2 },
];

/**
 * Resolve the active reference range for an analyte given the
 * patient's sex. Sex-specific entries take precedence; we fall
 * back to `common` when no sex-specific bracket is declared.
 *
 * @param {object} analyte - analyte definition from analyte-defs.json
 * @param {'M'|'F'} sex
 * @returns {{ low: number, high: number } | null}
 */
function resolveRange(analyte, sex) {
  const ranges = analyte.ranges ?? {};
  if (sex === 'M' && ranges.male) return ranges.male;
  if (sex === 'F' && ranges.female) return ranges.female;
  return ranges.common ?? null;
}

/**
 * Round to a fixed number of decimal places without trailing
 * floating-point garbage. `Math.round(x * 10^n) / 10^n` is
 * accurate enough for our 0-3 digit range and avoids pulling in a
 * decimal library.
 *
 * @param {number} value
 * @param {number} precision
 * @returns {number}
 */
function roundTo(value, precision) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

/**
 * Format a number for display, honouring the analyte's precision.
 * Uses `toFixed` so values like 14 print as `'14.0'` when the
 * analyte declares 1 decimal place — that matches what real lab
 * reports do and keeps column alignment tidy.
 *
 * @param {number} value
 * @param {number} precision
 * @returns {string}
 */
function formatDisplay(value, precision) {
  return value.toFixed(precision);
}

/**
 * Build the printed reference-range string.
 *
 *   both bounds:         "13.5 - 17.5"
 *   only high (low=0):   "< 200"
 *   only low:            "> 40"
 *   neither / null:      "" (empty — template handles a blank cell)
 *
 * @param {{low: number, high: number} | null} range
 * @param {number} precision
 * @returns {string}
 */
function formatRangeDisplay(range, precision) {
  if (!range) return '';
  const hasLow = range.low !== undefined && range.low !== null && range.low > 0;
  const hasHigh =
    range.high !== undefined && range.high !== null && Number.isFinite(range.high);

  if (hasLow && hasHigh) {
    return `${formatDisplay(range.low, precision)} - ${formatDisplay(range.high, precision)}`;
  }
  if (hasHigh) {
    return `< ${formatDisplay(range.high, precision)}`;
  }
  if (hasLow) {
    return `> ${formatDisplay(range.low, precision)}`;
  }
  return '';
}

/**
 * Compute the H/L/N/C flag for a value.
 *
 * Rules:
 *   - Critical first: outside [physMin * 0.95, physMax * 1.05] → 'C'
 *   - Else compare against the active reference range. Treat
 *     `rangeLow === 0` as a *soft* floor — i.e. don't emit 'L' for
 *     it, because for analytes like cholesterol the lower bound
 *     is "there isn't one", and 0 in the defs is a placeholder.
 *   - Missing rangeHigh → never 'H'.
 *
 * @param {number} value
 * @param {{low:number, high:number}|null} range
 * @param {{physMin:number, physMax:number}} phys
 * @returns {'N'|'H'|'L'|'C'}
 */
function flagFor(value, range, phys) {
  const criticalLow = phys.physMin * 0.95;
  const criticalHigh = phys.physMax * 1.05;
  if (value < criticalLow || value > criticalHigh) return 'C';

  if (!range) return 'N';

  const hasHardLow = range.low !== undefined && range.low !== null && range.low > 0;
  const hasHigh =
    range.high !== undefined && range.high !== null && Number.isFinite(range.high);

  if (hasHigh && value > range.high) return 'H';
  if (hasHardLow && value < range.low) return 'L';
  return 'N';
}

/**
 * Draw a raw (un-rounded) sample value for a primary analyte
 * according to the bucket distribution. Returns the bucket tag
 * alongside so callers can record/debug the distribution if
 * needed — we don't expose it on the result row.
 *
 * Bucket math (when both range bounds exist):
 *   normal         → uniform [low, high]
 *   high           → uniform (high, high + 0.4 * (physMax - high)]
 *   low            → uniform [physMin + 0.2 * (low - physMin), low)
 *   critical_high  → uniform (high + 0.4 * (physMax - high), physMax]
 *   critical_low   → uniform [physMin, physMin + 0.2 * (low - physMin))
 *
 * When a bound is missing (e.g. range.high === Infinity or
 * range.low is the 0 placeholder) the corresponding buckets are
 * down-weighted to zero before the pick — otherwise we'd produce
 * nonsense values like "LDL high" when the analyte has no upper
 * reference bound declared.
 *
 * @param {ReturnType<import('../seedrand.js').createRng>} rng
 * @param {object} analyte - analyte def
 * @param {{low:number,high:number}|null} range - resolved range
 * @returns {number}
 */
function sampleValue(rng, analyte, range) {
  const physMin = analyte.physMin;
  const physMax = analyte.physMax;

  const hasHardLow =
    range && range.low !== undefined && range.low !== null && range.low > 0;
  const hasHigh =
    range &&
    range.high !== undefined &&
    range.high !== null &&
    Number.isFinite(range.high);

  // Filter buckets according to which bounds the analyte declares.
  // No range at all → everything collapses to "normal" centered at
  // mid-physiological; we just draw uniformly between physMin and
  // physMax which is the right behaviour for the "no range" case.
  if (!range) {
    return rng.float(physMin, physMax);
  }

  const eligible = BUCKETS.filter((b) => {
    if ((b.tag === 'high' || b.tag === 'critical_high') && !hasHigh) return false;
    if ((b.tag === 'low' || b.tag === 'critical_low') && !hasHardLow) return false;
    return true;
  });
  const bucket = rng.weighted(eligible, (b) => b.weight);

  // Define a safe normal-band low for analytes with no hard floor.
  const normalLow = hasHardLow ? range.low : physMin;
  const normalHigh = hasHigh ? range.high : physMax;

  switch (bucket.tag) {
    case 'normal':
      return rng.float(normalLow, normalHigh);
    case 'high': {
      // High band stretches up to 40% of the way from rangeHigh
      // toward physMax. Keeps "high" values plausible (still
      // within survivable physiology).
      const upper = range.high + 0.4 * (physMax - range.high);
      return rng.float(range.high + 1e-9, upper);
    }
    case 'low': {
      // Low band sits in the upper 20% of (physMin, rangeLow).
      const lower = physMin + 0.2 * (range.low - physMin);
      return rng.float(lower, range.low - 1e-9);
    }
    case 'critical_high': {
      // Critical band is the *top* 60% of (rangeHigh, physMax).
      const lower = range.high + 0.4 * (physMax - range.high);
      return rng.float(lower + 1e-9, physMax);
    }
    case 'critical_low': {
      // Critical band is the *bottom* 20% of (physMin, rangeLow).
      const upper = physMin + 0.2 * (range.low - physMin);
      return rng.float(physMin, upper - 1e-9);
    }
    default:
      // Defensive default — unreachable in practice.
      return rng.float(normalLow, normalHigh);
  }
}

/**
 * Fill an entire report shell with sampled + computed analyte
 * values. Returns the input shell extended with `panelTitle`,
 * `panelDept`, `panelSpecimen`, and `groupedResults`.
 *
 * Group + row ordering follows the declaration order in
 * `defs[panel].groups[*].analytes`. We never reorder — the
 * template prints rows in array order and we want the same
 * row layout the analyte-defs author intended.
 *
 * The function runs two passes per panel:
 *   1. Primary pass: for each non-computed analyte, sample a
 *      value, round to declared precision, build display string,
 *      flag against range and physiological band. Cache the
 *      result in `byCode` so the second pass can read it.
 *   2. Computed pass: walk in declaration order; for each
 *      `computed` analyte, look up its formula in
 *      `COMPUTED_FORMULAS`, run it against `byCode`, clamp to
 *      [physMin, physMax], round, re-flag.
 *
 * @param {object} shell - report shell from `planReports`
 * @param {object} defs - full analyte-defs.json object
 * @param {ReturnType<import('../seedrand.js').createRng>} rng
 * @returns {object} the populated Report
 */
export function fillReport(shell, defs, rng) {
  const panelDef = defs[shell.panel];
  if (!panelDef) {
    throw new Error(`Unknown panel "${shell.panel}" — not in analyte-defs.json`);
  }

  // Flatten declaration order so we can do a clean primary pass
  // then a clean computed pass without re-walking the nested
  // group structure twice for sampling. Groups are rebuilt at the
  // end for the returned `groupedResults`.
  const flatAnalytes = [];
  for (const group of panelDef.groups) {
    for (const analyte of group.analytes) {
      flatAnalytes.push({ group, analyte });
    }
  }

  // byCode: analyte.code → AnalyteResult (mutable while we build,
  // frozen-by-convention afterward). Used by computed formulas.
  const byCode = {};

  // -- Pass 1: primaries --
  for (const { analyte } of flatAnalytes) {
    if (analyte.computed) continue;
    byCode[analyte.code] = buildResult({ analyte, sex: shell.patient.sex, rng });
  }

  // -- Pass 2: computed --
  for (const { analyte } of flatAnalytes) {
    if (!analyte.computed) continue;
    const formula = COMPUTED_FORMULAS[analyte.computed];
    if (!formula) {
      throw new Error(
        `No formula registered for computed tag "${analyte.computed}" on analyte "${analyte.code}"`
      );
    }
    let raw = formula(byCode);
    // Clamp into physiological band so a wild Friedewald never
    // emits negative LDL. Re-flag against declared range.
    raw = Math.min(Math.max(raw, analyte.physMin), analyte.physMax);
    byCode[analyte.code] = buildComputedResult({
      analyte,
      sex: shell.patient.sex,
      rawValue: raw,
    });
  }

  // -- Rebuild grouped structure for the template --
  const groupedResults = panelDef.groups.map((group) => ({
    name: group.name,
    rows: group.analytes.map((analyte) => byCode[analyte.code]),
  }));

  return {
    ...shell,
    panelTitle: panelDef.title,
    panelDept: panelDef.department,
    panelSpecimen: panelDef.specimen,
    groupedResults,
  };
}

/**
 * Build an AnalyteResult for a primary (non-computed) analyte.
 *
 * Kept as a small named helper so the two-pass loop above stays
 * readable. The shape of the returned object is the contract the
 * PDF template depends on — do not rename keys without updating
 * the template at the same time.
 *
 * @param {{analyte: object, sex: 'M'|'F', rng: object}} args
 * @returns {object} AnalyteResult
 */
function buildResult({ analyte, sex, rng }) {
  const range = resolveRange(analyte, sex);
  const raw = sampleValue(rng, analyte, range);
  const value = roundTo(raw, analyte.precision);
  const display = formatDisplay(value, analyte.precision);
  const flag = flagFor(value, range, {
    physMin: analyte.physMin,
    physMax: analyte.physMax,
  });
  return {
    code: analyte.code,
    name: analyte.name,
    value,
    display,
    unit: analyte.unit,
    method: analyte.method ?? null,
    rangeLow: range?.low ?? null,
    rangeHigh: range?.high ?? null,
    rangeDisplay: formatRangeDisplay(range, analyte.precision),
    flag,
  };
}

/**
 * Build an AnalyteResult for a computed analyte. Same shape as
 * `buildResult`, but the value is supplied externally (already
 * derived + clamped) rather than sampled.
 *
 * @param {{analyte: object, sex: 'M'|'F', rawValue: number}} args
 * @returns {object} AnalyteResult
 */
function buildComputedResult({ analyte, sex, rawValue }) {
  const range = resolveRange(analyte, sex);
  const value = roundTo(rawValue, analyte.precision);
  const display = formatDisplay(value, analyte.precision);
  const flag = flagFor(value, range, {
    physMin: analyte.physMin,
    physMax: analyte.physMax,
  });
  return {
    code: analyte.code,
    name: analyte.name,
    value,
    display,
    unit: analyte.unit,
    method: analyte.method ?? null,
    rangeLow: range?.low ?? null,
    rangeHigh: range?.high ?? null,
    rangeDisplay: formatRangeDisplay(range, analyte.precision),
    flag,
  };
}

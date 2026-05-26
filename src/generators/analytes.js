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
 *       floor when rangeLow is 0 — see `rangeLow === 0` note).
 *       For qualitative analytes: picked option ∈ normalOptions.
 *   H — value above rangeHigh but still within physiological bounds.
 *       For qualitative analytes: picked option ∉ normalOptions.
 *   L — value below rangeLow (skipped when rangeLow is 0). Not
 *       applicable to qualitative analytes.
 *   C — value outside [physMin * 0.95, physMax * 1.05] (i.e. so
 *       far out that a real lab would call it a panic value).
 *
 * # Quantitative vs qualitative
 * Analytes declare an optional `kind` field:
 *   - 'quantitative' (or absent) → numeric sampling via the five
 *     bucket distribution. `value` is a number.
 *   - 'qualitative' / 'semi-quantitative' → pick a string uniformly
 *     from `options`. `value` is a STRING. Numeric range-resolution,
 *     clamping, rounding, and bucketed sampling are all skipped.
 *
 * # Why computed analytes are second-pass
 * The Friedewald LDL needs total_chol + hdl + triglycerides, the
 * A/G ratio needs albumin + globulin (which is *itself* computed
 * from total_protein and albumin), etc. Doing primaries first and
 * then walking computed in declaration order keeps the dependency
 * graph implicit-but-correct — every computed analyte declared in
 * `analyte-defs.json` already has its inputs sampled (or computed
 * earlier in the same pass) by the time we reach it.
 *
 * # Computed-formula interface
 * Formulas receive a single `ctx` argument shaped as:
 *   { byCode, patient }
 * where `byCode` is the analyte-code → AnalyteResult map (existing
 * sibling lookups go through `ctx.byCode.<code>.value`) and
 * `patient` is the report's patient record (so renal eGFR can read
 * `patient.age` + `patient.sex` without a second arg). The context
 * object form was chosen so future patient-aware formulas can be
 * added without touching the dispatcher.
 */

// Map of computed-analyte tags (declared in analyte-defs.json under
// the `computed` key) to (ctx) → number functions. `ctx.byCode` is
// the in-progress results map; `ctx.patient` exposes patient-level
// fields (age, sex, etc.) for formulas like CKD-EPI eGFR that need
// demographic inputs. Functions return a raw (un-rounded, un-clamped)
// number — clamping and rounding live in the caller so the rules
// stay uniform across every formula.
const COMPUTED_FORMULAS = {
  // ── Lipid panel ──────────────────────────────────────────────
  /**
   * Friedewald LDL estimate. Standard clinical formula:
   *   LDL = TotalChol - HDL - (Triglycerides / 5).
   * Loses accuracy above triglycerides ~ 400 mg/dL, but for our
   * synthetic data we don't bother gating on that — the resulting
   * value still gets clamped to the analyte's physiological band.
   */
  ldl_friedewald(ctx) {
    const { byCode } = ctx;
    return byCode.total_chol.value - byCode.hdl.value - byCode.triglycerides.value / 5;
  },

  /** VLDL ≈ triglycerides / 5 (standard estimate). */
  triglycerides_over_5(ctx) {
    return ctx.byCode.triglycerides.value / 5;
  },

  /** Total Cholesterol / HDL atherogenic ratio. */
  total_chol_over_hdl(ctx) {
    // Guard against a zero HDL — pathological, but a bad seed
    // could produce one and we don't want NaN in the PDF.
    const { byCode } = ctx;
    return byCode.hdl.value > 0 ? byCode.total_chol.value / byCode.hdl.value : 0;
  },

  /** Non-HDL cholesterol = Total - HDL (atherogenic burden marker). */
  total_chol_minus_hdl(ctx) {
    const { byCode } = ctx;
    return byCode.total_chol.value - byCode.hdl.value;
  },

  /** ApoB / ApoA1 ratio — strong CV risk indicator; guard zero. */
  apo_b_over_apo_a1(ctx) {
    const { byCode } = ctx;
    return byCode.apo_a1.value > 0 ? byCode.apo_b.value / byCode.apo_a1.value : 0;
  },

  /** LDL / HDL ratio — classical atherogenic index; guard zero. */
  ldl_over_hdl(ctx) {
    const { byCode } = ctx;
    return byCode.hdl.value > 0 ? byCode.ldl.value / byCode.hdl.value : 0;
  },

  /** Triglyceride / HDL ratio — insulin-resistance correlate; guard zero. */
  triglycerides_over_hdl(ctx) {
    const { byCode } = ctx;
    return byCode.hdl.value > 0 ? byCode.triglycerides.value / byCode.hdl.value : 0;
  },

  // ── LFT panel ────────────────────────────────────────────────
  /** Indirect bilirubin = total - direct, clamped at zero. */
  tbili_minus_dbili(ctx) {
    const { byCode } = ctx;
    return Math.max(byCode.tbili.value - byCode.dbili.value, 0);
  },

  /** Globulin = total protein - albumin, clamped at zero. */
  tp_minus_albumin(ctx) {
    const { byCode } = ctx;
    return Math.max(byCode.total_protein.value - byCode.albumin.value, 0);
  },

  /** A/G ratio = albumin / globulin, guarded against div-by-zero. */
  albumin_over_globulin(ctx) {
    const { byCode } = ctx;
    return byCode.globulin.value > 0 ? byCode.albumin.value / byCode.globulin.value : 0;
  },

  // ── CBC absolute counts ──────────────────────────────────────
  /** Absolute Neutrophil Count = WBC × (Neutrophils% / 100). */
  wbc_times_neutrophils_pct(ctx) {
    const { byCode } = ctx;
    return (byCode.wbc.value * byCode.neutrophils.value) / 100;
  },

  /** Absolute Lymphocyte Count = WBC × (Lymphocytes% / 100). */
  wbc_times_lymphocytes_pct(ctx) {
    const { byCode } = ctx;
    return (byCode.wbc.value * byCode.lymphocytes.value) / 100;
  },

  /** Absolute Monocyte Count = WBC × (Monocytes% / 100). */
  wbc_times_monocytes_pct(ctx) {
    const { byCode } = ctx;
    return (byCode.wbc.value * byCode.monocytes.value) / 100;
  },

  /** Absolute Eosinophil Count = WBC × (Eosinophils% / 100). */
  wbc_times_eosinophils_pct(ctx) {
    const { byCode } = ctx;
    return (byCode.wbc.value * byCode.eosinophils.value) / 100;
  },

  /** Absolute Basophil Count = WBC × (Basophils% / 100). */
  wbc_times_basophils_pct(ctx) {
    const { byCode } = ctx;
    return (byCode.wbc.value * byCode.basophils.value) / 100;
  },

  // ── CBC ratios ───────────────────────────────────────────────
  /** Neutrophil-Lymphocyte Ratio = ANC / ALC; guard div-by-zero. */
  anc_over_alc(ctx) {
    const { byCode } = ctx;
    return byCode.alc.value > 0 ? byCode.anc.value / byCode.alc.value : 0;
  },

  /** Platelet-Lymphocyte Ratio = Platelets / ALC; guard div-by-zero. */
  platelets_over_alc(ctx) {
    const { byCode } = ctx;
    return byCode.alc.value > 0 ? byCode.platelets.value / byCode.alc.value : 0;
  },

  // ── KFT panel ────────────────────────────────────────────────
  /** Blood Urea Nitrogen = Urea / 2.14 (urea-N mass conversion). */
  urea_over_2_14(ctx) {
    return ctx.byCode.urea.value / 2.14;
  },

  /**
   * Estimated GFR via the CKD-EPI 2009 creatinine equation.
   *   eGFR = 141 × min(SCr/κ, 1)^α × max(SCr/κ, 1)^-1.209
   *        × 0.993^age × sexFactor
   * where (κ, α, sexFactor) are sex-specific constants. SCr is
   * serum creatinine in mg/dL, age in years. We read patient
   * demographics off ctx.patient — that's why the formula
   * dispatcher passes a context object rather than just byCode.
   */
  egfr_creatinine_age_sex(ctx) {
    const { byCode, patient } = ctx;
    const creat = byCode.creatinine.value;
    const age = patient.age;
    const isFemale = patient.sex === 'F';
    const kappa = isFemale ? 0.7 : 0.9;
    const alpha = isFemale ? -0.329 : -0.411;
    const sexFactor = isFemale ? 1.018 : 1.0;
    const ratio = creat / kappa;
    const minTerm = Math.pow(Math.min(ratio, 1), alpha);
    const maxTerm = Math.pow(Math.max(ratio, 1), -1.209);
    const ageTerm = Math.pow(0.993, age);
    return 141 * minTerm * maxTerm * ageTerm * sexFactor;
  },

  // ── HbA1c panel ──────────────────────────────────────────────
  /**
   * Estimated Average Glucose from HbA1c (ADAG formula):
   *   eAG (mg/dL) = 28.7 × HbA1c% − 46.7.
   */
  hba1c_to_eag(ctx) {
    return 28.7 * ctx.byCode.hba1c.value - 46.7;
  },

  // ── Iron studies ─────────────────────────────────────────────
  /** UIBC = TIBC − Serum Iron; clamped non-negative. */
  tibc_minus_iron(ctx) {
    const { byCode } = ctx;
    return Math.max(byCode.tibc.value - byCode.serum_iron.value, 0);
  },

  /** Transferrin Saturation% = (Serum Iron × 100) / TIBC; guard zero. */
  serum_iron_times_100_over_tibc(ctx) {
    const { byCode } = ctx;
    return byCode.tibc.value > 0 ? (byCode.serum_iron.value * 100) / byCode.tibc.value : 0;
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
 * Resolve the active reference range for a *quantitative* analyte
 * given the patient's sex. Sex-specific entries take precedence; we
 * fall back to `common` when no sex-specific bracket is declared.
 *
 * Qualitative / semi-quantitative analytes never enter this code
 * path — they're routed through `buildQualitativeResult` instead.
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
 * Return true when an analyte should be sampled qualitatively
 * (string-from-options) rather than numerically. Defaults to
 * quantitative when `kind` is absent.
 *
 * @param {object} analyte
 * @returns {boolean}
 */
function isQualitative(analyte) {
  return analyte.kind === 'qualitative' || analyte.kind === 'semi-quantitative';
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
 *      value (numerically or by qualitative pick depending on
 *      `kind`), round/format as appropriate, build display
 *      string, flag against range/normalOptions and physiological
 *      band. Cache the result in `byCode` so the second pass can
 *      read it.
 *   2. Computed pass: walk in declaration order; for each
 *      `computed` analyte, look up its formula in
 *      `COMPUTED_FORMULAS`, run it against `ctx = {byCode, patient}`,
 *      clamp to [physMin, physMax], round, re-flag.
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
    if (isQualitative(analyte)) {
      byCode[analyte.code] = buildQualitativeResult({ analyte, rng });
    } else {
      byCode[analyte.code] = buildResult({ analyte, sex: shell.patient.sex, rng });
    }
  }

  // -- Pass 2: computed --
  // Context object handed to every formula. `byCode` lets formulas
  // read sibling analyte values; `patient` lets demographic-aware
  // formulas (e.g. CKD-EPI eGFR) read age/sex without a second arg.
  const ctx = { byCode, patient: shell.patient };
  for (const { analyte } of flatAnalytes) {
    if (!analyte.computed) continue;
    const formula = COMPUTED_FORMULAS[analyte.computed];
    if (!formula) {
      throw new Error(
        `No formula registered for computed tag "${analyte.computed}" on analyte "${analyte.code}"`
      );
    }
    let raw = formula(ctx);
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
 * Build an AnalyteResult for a primary (non-computed), quantitative
 * analyte.
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
 * Build an AnalyteResult for a qualitative / semi-quantitative
 * analyte. Picks a string uniformly from `analyte.options`, flags
 * 'N' when the pick is in `normalOptions` and 'H' otherwise.
 *
 * The result's `value` and `display` are both the picked string;
 * we don't round or format. Numeric bounds (`rangeLow`/`rangeHigh`)
 * are null — qualitative analytes have no numeric reference
 * interval. `rangeDisplay` prefers an explicit `ranges.common.display`
 * if the analyte def supplies one, otherwise falls back to a
 * slash-joined view of `normalOptions` (e.g. "Pale Yellow / Yellow /
 * Straw") which is what most printed lab reports actually show.
 *
 * @param {{analyte: object, rng: object}} args
 * @returns {object} AnalyteResult (with `value` typed string)
 */
function buildQualitativeResult({ analyte, rng }) {
  const options = analyte.options ?? [];
  const normalOptions = analyte.normalOptions ?? [];
  const picked = rng.pick(options);
  const isNormal = normalOptions.includes(picked);
  const explicitRangeDisplay = analyte.ranges?.common?.display;
  const rangeDisplay =
    explicitRangeDisplay !== undefined && explicitRangeDisplay !== null
      ? explicitRangeDisplay
      : normalOptions.join(' / ');
  return {
    code: analyte.code,
    name: analyte.name,
    value: picked,
    display: picked,
    unit: analyte.unit ? analyte.unit : '-',
    method: analyte.method ?? null,
    rangeLow: null,
    rangeHigh: null,
    rangeDisplay,
    flag: isNormal ? 'N' : 'H',
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

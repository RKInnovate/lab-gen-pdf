# Panels

## Overview

The synthetic generator ships eight clinical panels (CBC, Lipid, LFT, Thyroid, KFT, HbA1c, Iron Studies, Urine Routine) covering roughly 110 analytes in total. Every analyte is declared in `data/analyte-defs.json` with a stable code, unit, display precision, optional method, reference range (sex-specific or `common`), and physiological bounds used by the sampler's critical-band flagging. Analytes default to numeric sampling; the optional `kind` field (`qualitative` | `semi-quantitative` | `quantitative`) lets the Urine Routine panel mix qualitative picks (e.g. "Pale Yellow"), semi-quantitative dipstick scales ("Trace", "1+", "2+"), and numeric measurements (pH, specific gravity, microalbumin) inside a single group.

This document is the cross-reference for the JSON catalogue. The "Reference Range" column reproduces the sex-aware range, and the "Computed?" column links derived analytes to the formula keys documented in section 3.

## `cbc`

- **Title** — Complete Blood Count (CBC)
- **Department** — Haematology
- **Specimen** — Whole Blood — EDTA
- **Clinical note** — A "Clinical Interpretation" paragraph that varies based on whether any row carries a non-N flag: either "Some values are outside the reference range; clinical correlation with patient history and additional investigations is recommended." or "All measured analytes are within the stated reference range; no significant haematological abnormality detected on this sample." The text is deterministic per seed.

### Erythrocyte Profile

| Code | Name | Unit | Reference Range | Computed? | Method |
| --- | --- | --- | --- | --- | --- |
| `hgb` | Haemoglobin | g/dL | M 13.5-17.5 / F 12.0-15.5 | — | Photometric |
| `rbc` | Total RBC Count | million/µL | M 4.5-5.9 / F 4.0-5.2 | — | Electrical Impedance |
| `hct` | Haematocrit (PCV) | % | M 41.0-53.0 / F 36.0-46.0 | — | Calculated |
| `mcv` | MCV | fL | 80.0-100.0 | — | Calculated |
| `mch` | MCH | pg | 27.0-33.0 | — | Calculated |
| `mchc` | MCHC | g/dL | 32.0-36.0 | — | Calculated |
| `rdw` | RDW-CV | % | 11.5-14.5 | — | Calculated |
| `rdw_sd` | RDW-SD | fL | 39.0-46.0 | — | Calculated |
| `reticulocyte_pct` | Reticulocyte % | % | 0.5-2.5 | — | Flow Cytometry |

### Leukocyte Profile

| Code | Name | Unit | Reference Range | Computed? | Method |
| --- | --- | --- | --- | --- | --- |
| `wbc` | Total WBC Count | 10³/µL | 4.5-11.0 | — | Electrical Impedance |
| `neutrophils` | Neutrophils | % | 40.0-75.0 | — | VCS Technology |
| `anc` | Absolute Neutrophil Count | 10³/µL | 1.8-7.7 | yes — `wbc_times_neutrophils_pct` | Calculated |
| `lymphocytes` | Lymphocytes | % | 20.0-45.0 | — | VCS Technology |
| `alc` | Absolute Lymphocyte Count | 10³/µL | 1.0-4.0 | yes — `wbc_times_lymphocytes_pct` | Calculated |
| `monocytes` | Monocytes | % | 2.0-10.0 | — | VCS Technology |
| `amc` | Absolute Monocyte Count | 10³/µL | 0.1-0.9 | yes — `wbc_times_monocytes_pct` | Calculated |
| `eosinophils` | Eosinophils | % | 1.0-6.0 | — | VCS Technology |
| `aec` | Absolute Eosinophil Count | 10³/µL | 0.0-0.5 | yes — `wbc_times_eosinophils_pct` | Calculated |
| `basophils` | Basophils | % | 0.0-2.0 | — | VCS Technology |
| `abc` | Absolute Basophil Count | 10³/µL | 0.0-0.2 | yes — `wbc_times_basophils_pct` | Calculated |

### Platelet Profile

| Code | Name | Unit | Reference Range | Computed? | Method |
| --- | --- | --- | --- | --- | --- |
| `platelets` | Platelet Count | 10³/µL | 150-450 | — | Electrical Impedance |
| `mpv` | MPV | fL | 7.5-11.5 | — | Calculated |
| `pdw` | Platelet Distribution Width (PDW) | fL | 9.0-17.0 | — | Calculated |
| `p_lcr` | Platelet Large Cell Ratio (P-LCR) | % | 13.0-43.0 | — | Calculated |
| `pct` | Plateletcrit (PCT) | % | 0.17-0.35 | — | Calculated |

### Acute-Phase / Ratios

| Code | Name | Unit | Reference Range | Computed? | Method |
| --- | --- | --- | --- | --- | --- |
| `esr` | Erythrocyte Sedimentation Rate (ESR) | mm/hr | M 0-15 / F 0-20 | — | Modified Westergren |
| `nlr` | Neutrophil-Lymphocyte Ratio (NLR) | ratio | 1.0-3.5 | yes — `anc_over_alc` | Calculated |
| `plr` | Platelet-Lymphocyte Ratio (PLR) | ratio | 50-200 | yes — `platelets_over_alc` | Calculated |

## `lipid`

- **Title** — Lipid Profile
- **Department** — Biochemistry
- **Specimen** — Serum — Fasting
- **Clinical note** — A "Notes" paragraph explaining that LDL is calculated by the Friedewald formula (`LDL = Total Cholesterol − HDL − Triglycerides / 5`) and warning that the calculation is unreliable when triglycerides exceed 400 mg/dL — direct LDL is recommended in that case. The disclaimer is unconditional, matching how Indian labs print it.

### Lipid Panel

| Code | Name | Unit | Reference Range | Computed? | Method |
| --- | --- | --- | --- | --- | --- |
| `total_chol` | Total Cholesterol | mg/dL | 0-200 | — | Enzymatic (CHOD-PAP) |
| `triglycerides` | Triglycerides | mg/dL | 0-150 | — | Enzymatic (GPO-PAP) |
| `hdl` | HDL Cholesterol | mg/dL | M 40-60 / F 50-60 | — | Direct Homogenous |
| `ldl` | LDL Cholesterol | mg/dL | 0-100 | yes — `ldl_friedewald` | Calculated (Friedewald) |
| `vldl` | VLDL Cholesterol | mg/dL | 5-40 | yes — `triglycerides_over_5` | Calculated |
| `non_hdl` | Non-HDL Cholesterol | mg/dL | 0-130 | yes — `total_chol_minus_hdl` | Calculated |

### Apolipoproteins

| Code | Name | Unit | Reference Range | Computed? | Method |
| --- | --- | --- | --- | --- | --- |
| `apo_a1` | Apolipoprotein A1 | mg/dL | M 110-180 / F 110-205 | — | Immunoturbidimetric |
| `apo_b` | Apolipoprotein B | mg/dL | 50-120 | — | Immunoturbidimetric |
| `lipo_a` | Lipoprotein (a) — Lp(a) | mg/dL | 0-30 | — | Immunoturbidimetric |

### Atherogenic Indices

| Code | Name | Unit | Reference Range | Computed? | Method |
| --- | --- | --- | --- | --- | --- |
| `chol_hdl_ratio` | Total Cholesterol / HDL Ratio | ratio | 0.0-5.0 | yes — `total_chol_over_hdl` | Calculated |
| `ldl_over_hdl` | LDL / HDL Ratio | ratio | 0.0-3.5 | yes — `ldl_over_hdl` | Calculated |
| `trig_over_hdl` | Triglyceride / HDL Ratio | ratio | 0.0-3.5 | yes — `triglycerides_over_hdl` | Calculated |
| `apo_b_over_a1` | ApoB / ApoA1 Ratio | ratio | M 0.0-0.9 / F 0.0-0.8 | yes — `apo_b_over_apo_a1` | Calculated |

## `lft`

- **Title** — Liver Function Test (LFT)
- **Department** — Biochemistry
- **Specimen** — Serum
- **Clinical note** — A "Specimen Handling Note" warning that haemolysed or lipaemic samples can spuriously elevate bilirubin and transaminase values; a fresh fasting specimen is advised if results don't match the clinical picture.

### Bilirubin Profile

| Code | Name | Unit | Reference Range | Computed? | Method |
| --- | --- | --- | --- | --- | --- |
| `tbili` | Bilirubin (Total) | mg/dL | 0.2-1.2 | — | Diazo Method |
| `dbili` | Bilirubin (Direct) | mg/dL | 0.0-0.3 | — | Diazo Method |
| `ibili` | Bilirubin (Indirect) | mg/dL | 0.1-0.9 | yes — `tbili_minus_dbili` | Calculated |

### Enzyme Profile

| Code | Name | Unit | Reference Range | Computed? | Method |
| --- | --- | --- | --- | --- | --- |
| `sgot` | SGOT (AST) | U/L | 5-40 | — | IFCC (UV Kinetic) |
| `sgpt` | SGPT (ALT) | U/L | 5-45 | — | IFCC (UV Kinetic) |
| `alp` | Alkaline Phosphatase | U/L | 40-130 | — | Kinetic (DGKC) |
| `ggt` | Gamma GT (GGT) | U/L | 5-55 | — | Szasz Kinetic |
| `ldh` | Lactate Dehydrogenase (LDH) | U/L | 140-280 | — | IFCC (Lactate→Pyruvate) |

### Protein Profile

| Code | Name | Unit | Reference Range | Computed? | Method |
| --- | --- | --- | --- | --- | --- |
| `total_protein` | Total Protein | g/dL | 6.0-8.3 | — | Biuret |
| `albumin` | Albumin | g/dL | 3.5-5.0 | — | BCG |
| `globulin` | Globulin | g/dL | 2.0-3.5 | yes — `tp_minus_albumin` | Calculated |
| `ag_ratio` | A/G Ratio | ratio | 1.0-2.5 | yes — `albumin_over_globulin` | Calculated |

### Coagulation

| Code | Name | Unit | Reference Range | Computed? | Method |
| --- | --- | --- | --- | --- | --- |
| `pt` | Prothrombin Time (PT) | seconds | 11.0-14.0 | — | Mechanical Clot Detection |
| `inr` | INR | ratio | 0.8-1.2 | — | Calculated |

## `thyroid`

- **Title** — Thyroid Profile (T3, T4, TSH)
- **Department** — Immunoassay
- **Specimen** — Serum
- **Clinical note** — A "Reference Range Note" stating that the printed ranges apply to non-pregnant adults; TSH and free T4 vary by trimester in pregnancy and trimester-specific ATA / Endocrine Society cutoffs should be applied. Inter-assay variation across labs is also flagged.

### Thyroid Hormones

| Code | Name | Unit | Reference Range | Computed? | Method |
| --- | --- | --- | --- | --- | --- |
| `t3` | Triiodothyronine (T3) — Total | ng/dL | 80-200 | — | CLIA |
| `t4` | Thyroxine (T4) — Total | µg/dL | 5.0-12.0 | — | CLIA |
| `tsh` | Thyroid Stimulating Hormone (TSH) | µIU/mL | 0.4-4.0 | — | CLIA (3rd generation) |
| `ft3` | Free T3 (fT3) | pg/mL | 2.3-4.2 | — | CLIA |
| `ft4` | Free T4 (fT4) | ng/dL | 0.8-1.8 | — | CLIA |
| `reverse_t3` | Reverse T3 (rT3) | ng/dL | 8.0-25.0 | — | CLIA |
| `tbg` | Thyroid Binding Globulin (TBG) | µg/mL | 16.0-24.0 | — | RIA |

### Thyroid Antibodies

| Code | Name | Unit | Reference Range | Computed? | Method |
| --- | --- | --- | --- | --- | --- |
| `anti_tpo` | Anti-Thyroid Peroxidase Antibodies (Anti-TPO) | IU/mL | 0.0-34.0 | — | CLIA |
| `anti_tg` | Anti-Thyroglobulin Antibodies (Anti-Tg) | IU/mL | 0.0-115.0 | — | CLIA |

## `kft`

- **Title** — Kidney Function Test (KFT)
- **Department** — Biochemistry
- **Specimen** — Serum + Plasma
- **Clinical note** — An "Interpretation Notes" paragraph spelling out the KDIGO eGFR staging derived from CKD-EPI 2009 (≥90 normal, 60-89 mild decrease, 30-59 stage 3, 15-29 stage 4, <15 kidney failure), reminding the reader that single-point eGFR should be repeated 3 months later for a CKD diagnosis, and warning that electrolyte values can be affected by haemolysis and sample-handling delays.

### Renal Profile

| Code | Name | Unit | Reference Range | Computed? | Method |
| --- | --- | --- | --- | --- | --- |
| `urea` | Urea | mg/dL | 15-45 | — | Urease-GLDH Kinetic |
| `bun` | Blood Urea Nitrogen (BUN) | mg/dL | 7-20 | yes — `urea_over_2_14` | Calculated |
| `creatinine` | Creatinine | mg/dL | M 0.7-1.3 / F 0.6-1.1 | — | Jaffe Kinetic |
| `uric_acid` | Uric Acid | mg/dL | M 3.4-7.0 / F 2.4-5.7 | — | Uricase |
| `egfr` | Estimated GFR (eGFR) | mL/min/1.73m² | 60-120 | yes — `egfr_creatinine_age_sex` | CKD-EPI (Calculated) |

### Electrolytes

| Code | Name | Unit | Reference Range | Computed? | Method |
| --- | --- | --- | --- | --- | --- |
| `sodium` | Sodium (Na+) | mEq/L | 135-145 | — | ISE Indirect |
| `potassium` | Potassium (K+) | mEq/L | 3.5-5.0 | — | ISE Indirect |
| `chloride` | Chloride (Cl-) | mEq/L | 98-107 | — | ISE Indirect |
| `bicarbonate` | Bicarbonate (HCO3-) | mEq/L | 22-29 | — | Enzymatic (PEPC) |
| `calcium` | Calcium (Total) | mg/dL | 8.5-10.2 | — | Arsenazo III |
| `phosphorus` | Phosphorus (Inorganic) | mg/dL | 2.5-4.5 | — | Molybdate UV |
| `magnesium` | Magnesium | mg/dL | 1.7-2.4 | — | Xylidyl Blue |

## `hba1c`

- **Title** — HbA1c & Glycaemic Profile
- **Department** — Biochemistry
- **Specimen** — Whole Blood + Serum
- **Clinical note** — A "Glycaemic Interpretation" paragraph quoting the ADA 2024 thresholds (<5.7% normal, 5.7-6.4% pre-diabetes, ≥6.5% diabetes), explaining the eAG conversion formula `eAG (mg/dL) = 28.7 × HbA1c − 46.7`, and listing confounders (haemoglobinopathies, recent transfusion, pregnancy) that can confound HbA1c.

### Glycaemic Markers

| Code | Name | Unit | Reference Range | Computed? | Method |
| --- | --- | --- | --- | --- | --- |
| `hba1c` | Glycated Haemoglobin (HbA1c) | % | 4.0-5.6 | — | HPLC |
| `e_ag` | Estimated Average Glucose (eAG) | mg/dL | 70-126 | yes — `hba1c_to_eag` | Calculated (ADAG) |
| `fbs` | Fasting Blood Sugar (FBS) | mg/dL | 70-100 | — | Hexokinase |
| `ppbs` | Post-Prandial Blood Sugar (PPBS, 2-hr) | mg/dL | 70-140 | — | Hexokinase |
| `random_glucose` | Random Blood Glucose | mg/dL | 70-140 | — | Hexokinase |
| `fructosamine` | Fructosamine | µmol/L | 200-285 | — | NBT Colorimetric |
| `microalbumin` | Microalbumin (Serum) | mg/L | 0.0-20.0 | — | Immunoturbidimetric |

## `iron`

- **Title** — Iron Studies
- **Department** — Biochemistry
- **Specimen** — Serum
- **Clinical note** — An "Iron-Profile Interpretation" paragraph contrasting iron-deficiency anaemia (low iron, raised TIBC, TSAT <16%, ferritin <30 ng/mL) with anaemia of chronic disease (low/normal iron and TIBC, raised ferritin). Ferritin is flagged as an acute-phase reactant that can mask deficiency; an inflammatory panel (ESR/CRP) is suggested when ferritin is normal but other markers suggest deficiency. A morning fasting sample is preferred because of diurnal serum-iron variation.

### Iron Profile

| Code | Name | Unit | Reference Range | Computed? | Method |
| --- | --- | --- | --- | --- | --- |
| `serum_iron` | Serum Iron | µg/dL | M 65-175 / F 50-170 | — | Ferene-S Colorimetric |
| `tibc` | Total Iron Binding Capacity (TIBC) | µg/dL | 240-450 | — | Direct Colorimetric |
| `uibc` | Unsaturated Iron Binding Capacity (UIBC) | µg/dL | 150-375 | yes — `tibc_minus_iron` | Calculated |
| `transferrin` | Transferrin | mg/dL | 200-360 | — | Immunoturbidimetric |
| `transferrin_saturation` | Transferrin Saturation | % | 20.0-50.0 | yes — `serum_iron_times_100_over_tibc` | Calculated |
| `ferritin` | Ferritin | ng/mL | M 30-400 / F 13-150 | — | CLIA |

## `urine`

- **Title** — Urine Routine & Microscopy
- **Department** — Clinical Pathology
- **Specimen** — Urine — random midstream
- **Clinical note** — A "Urine-Routine Interpretation" paragraph reminding the reader that findings should be correlated with clinical history and collection method (random midstream vs catheterised). Casts, crystals and microorganisms can appear in small quantities in healthy individuals; trace urobilinogen is physiological. Urinary microalbumin >20 mg/L is flagged as an early nephropathy marker that should prompt a quantitative spot ACR.

### Physical Examination

| Code | Name | Unit | Reference Range | Computed? | Method |
| --- | --- | --- | --- | --- | --- |
| `colour` | Colour | - | Pale Yellow / Yellow / Straw | — | Visual |
| `appearance` | Appearance | - | Clear | — | Visual |
| `specific_gravity` | Specific Gravity | - | 1.005-1.030 | — | Refractometer |
| `ph` | pH | - | 5.0-7.5 | — | Dipstick (Indicator) |
| `volume_ml` | Volume | mL | 30-150 | — | Measured |

### Chemical Examination

| Code | Name | Unit | Reference Range | Computed? | Method |
| --- | --- | --- | --- | --- | --- |
| `protein` | Protein | - | Negative | — | Dipstick |
| `glucose` | Glucose | - | Negative | — | Dipstick (Glucose Oxidase) |
| `ketones` | Ketones | - | Negative | — | Dipstick (Nitroprusside) |
| `bilirubin` | Bilirubin | - | Negative | — | Dipstick (Diazo) |
| `urobilinogen` | Urobilinogen | - | Negative / Trace | — | Dipstick (Ehrlich) |
| `nitrites` | Nitrites | - | Negative | — | Dipstick (Griess) |
| `leucocyte_esterase` | Leucocyte Esterase | - | Negative | — | Dipstick (Esterase) |
| `blood` | Blood / Haemoglobin | - | Negative | — | Dipstick (Peroxidase) |
| `urinary_microalbumin` | Urinary Microalbumin | mg/L | 0.0-20.0 | — | Immunoturbidimetric |

### Microscopic Examination

| Code | Name | Unit | Reference Range | Computed? | Method |
| --- | --- | --- | --- | --- | --- |
| `urine_rbc` | RBCs | /HPF | 0-2 | — | Microscopy |
| `urine_wbc` | Pus Cells (WBCs) | /HPF | 0-5 | — | Microscopy |
| `epithelial_cells` | Epithelial Cells | /HPF | Few / Occasional | — | Microscopy |
| `casts` | Casts | /LPF | Nil / Few hyaline | — | Microscopy |
| `crystals` | Crystals | /HPF | Nil | — | Microscopy |
| `bacteria` | Bacteria | /HPF | Nil / Few | — | Microscopy |

## Computed-formula reference

Every `computed` key referenced in `data/analyte-defs.json` resolves to a function in the `COMPUTED_FORMULAS` table in `src/generators/analytes.js`. Formulas receive `ctx = { byCode, patient }` and return a raw number; the caller clamps the result to `[physMin, physMax]` and re-runs the H/L/N/C flagger.

### `ldl_friedewald`
LDL cholesterol via the standard Friedewald estimate: `LDL = TotalChol − HDL − Triglycerides / 5`. No guards; the post-clamp keeps wild values inside the analyte's physiological band (e.g. LDL never prints negative).

### `triglycerides_over_5`
VLDL cholesterol ≈ `Triglycerides / 5` — the standard surrogate when direct VLDL isn't measured.

### `total_chol_minus_hdl`
Non-HDL cholesterol = `TotalChol − HDL`. Atherogenic burden marker.

### `total_chol_over_hdl`
Total Cholesterol / HDL ratio. Guarded: returns 0 when HDL ≤ 0 to avoid `NaN`.

### `ldl_over_hdl`
LDL / HDL ratio. Guarded against HDL ≤ 0.

### `triglycerides_over_hdl`
Triglyceride / HDL ratio (insulin-resistance correlate). Guarded against HDL ≤ 0.

### `apo_b_over_apo_a1`
ApoB / ApoA1 ratio (CV risk indicator). Guarded against ApoA1 ≤ 0.

### `tbili_minus_dbili`
Indirect bilirubin = `TotalBili − DirectBili`. Clamped non-negative via `Math.max(..., 0)`.

### `tp_minus_albumin`
Globulin = `TotalProtein − Albumin`. Clamped non-negative.

### `albumin_over_globulin`
A/G ratio = `Albumin / Globulin`. Guarded against Globulin ≤ 0 (Globulin is itself a computed analyte declared earlier in the same group, so it is already populated by the time A/G runs).

### `wbc_times_neutrophils_pct`
Absolute Neutrophil Count = `WBC × (Neutrophils% / 100)`.

### `wbc_times_lymphocytes_pct`
Absolute Lymphocyte Count = `WBC × (Lymphocytes% / 100)`.

### `wbc_times_monocytes_pct`
Absolute Monocyte Count = `WBC × (Monocytes% / 100)`.

### `wbc_times_eosinophils_pct`
Absolute Eosinophil Count = `WBC × (Eosinophils% / 100)`.

### `wbc_times_basophils_pct`
Absolute Basophil Count = `WBC × (Basophils% / 100)`.

### `anc_over_alc`
Neutrophil-Lymphocyte Ratio = `ANC / ALC`. Guarded against ALC ≤ 0. Depends on the two computed counts above, which run earlier in declaration order.

### `platelets_over_alc`
Platelet-Lymphocyte Ratio = `Platelets / ALC`. Guarded against ALC ≤ 0.

### `urea_over_2_14`
Blood Urea Nitrogen = `Urea / 2.14` (mass-to-nitrogen conversion factor).

### `egfr_creatinine_age_sex`
Estimated GFR via the CKD-EPI 2009 creatinine equation:
`eGFR = 141 × min(SCr/κ, 1)^α × max(SCr/κ, 1)^-1.209 × 0.993^age × sexFactor`,
with `(κ, α, sexFactor) = (0.7, −0.329, 1.018)` for females and `(0.9, −0.411, 1.0)` for males. Reads age and sex from `ctx.patient`. Post-clamped to `[physMin=5, physMax=180]`.

### `hba1c_to_eag`
Estimated Average Glucose from HbA1c (ADAG): `eAG (mg/dL) = 28.7 × HbA1c − 46.7`.

### `tibc_minus_iron`
Unsaturated Iron Binding Capacity = `TIBC − SerumIron`. Clamped non-negative.

### `serum_iron_times_100_over_tibc`
Transferrin Saturation% = `(SerumIron × 100) / TIBC`. Guarded against TIBC ≤ 0.

## The `kind` schema field

Analytes declare an optional `kind` of `quantitative`, `qualitative`, or `semi-quantitative`. The value drives how the sampler in `src/generators/analytes.js` produces a result row:

- **`quantitative`** (default when `kind` is absent) — numeric bucket sampling via the five-state distribution (78% normal, 12% high, 5% low, 3% critical-high, 2% critical-low) over the sex-resolved reference range. The flag is derived by comparing the rounded value against `ranges` and the physiological band (`physMin`, `physMax`).
- **`qualitative`** — sampler picks uniformly from `options`. The flag is `N` when the picked string is in `normalOptions`, otherwise `H`. There is no `L` or `C` for qualitative analytes. `value` and `display` are both the picked string; `unit` falls back to `-` when the JSON unit is empty; `rangeDisplay` prefers an explicit `ranges.common.display` if supplied, otherwise it's a slash-joined view of `normalOptions` (e.g. `Pale Yellow / Yellow / Straw`).
- **`semi-quantitative`** — sampled identically to qualitative (pick from `options`, flag `N` if in `normalOptions` else `H`). The distinction is purely semantic — it tags dipstick-style outputs (`Negative`, `Trace`, `1+`, `2+`, `3+`, `4+`) so a future enhancement can assign numeric magnitudes per "+" level for sorting or trending without breaking the current contract.

## Adding a new panel

1. **Declare the panel in `data/analyte-defs.json`.** Add a new top-level key with `title`, `department`, `specimen`, and a `groups` array. For each analyte set `code`, `name`, `unit`, `precision`, optional `method`, the `ranges` block (sex-specific or `common`), and `physMin` / `physMax`. Tag derived analytes with a `computed` key; tag non-numeric analytes with `kind` plus `options` + `normalOptions`.
2. **Register any new formula keys** in the `COMPUTED_FORMULAS` table in `src/generators/analytes.js`. The formula receives `{ byCode, patient }` and returns a raw number; the caller handles clamping and rounding.
3. **Create `src/templates/<panel>.js`.** Copy `lipid.js` — it's the shortest template — and replace the clinical-note paragraph. Keep the `buildDocDefinition(report)` export shape: layout → header → patient block → panel title → results table → notes → endorsement.
4. **Wire the template into `src/render.js`.** Add an import and a `case` in `templateFor()` that maps the panel key to your new template.
5. **Update the panel registry.** Extend `ALL_PANELS` and `DEFAULT_PANEL_WEIGHTS` in `src/generators/patients.js`, and refresh the `--panels` help text in `src/index.js` so the CLI accepts the new key.
6. **Smoke + commit.** Render a small sample, visually review one PDF per layout, then commit as `feat: add <panel> panel` (one panel per commit keeps the diff reviewable).

## Reference-range provenance

From `data/analyte-defs.json` (`_meta.notes.ranges_provenance`):

> Reference intervals are drawn from common Indian-laboratory adult reporting conventions. Where literature varies, conservative wide ranges are used: ESR upper bounds, anti-TPO cutoffs, transferrin saturation, fructosamine, and apolipoprotein cutoffs are particularly assay-dependent and should be treated as approximate.

The urine dipstick scale follows the standard semi-quantitative `{Negative, Trace, 1+, 2+, 3+, 4+}` ladder. Urobilinogen is the one exception where `Trace` is still considered normal — handled via its per-analyte `normalOptions` rather than a global rule.

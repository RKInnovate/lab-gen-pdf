#!/usr/bin/env node
/**
 * CLI entry point — `lab-pdf-gen`.
 *
 * # Purpose
 * Wire the four pipeline stages together:
 *   1. Argument parsing + validation.
 *   2. RNG seeding + analyte-catalogue load.
 *   3. Patient/report planning (`planReports`).
 *   4. Per-report value generation (`fillReport`).
 *   5. PDF rendering to disk (`renderAll`).
 *
 * # Why a hand-rolled arg parser
 * The CLI surface is tiny (six flags + help) and we don't want to
 * pull in a 200-KB `commander` / `yargs` dependency for what amounts
 * to a `for`-loop over `process.argv`. Hand-rolling also gives us
 * full control over validation error messages, which is the only
 * part of arg parsing users actually see.
 *
 * # Output style
 * Plain text, one line per step. No emojis. Progress is reported by
 * a single rate-limited callback (every 50 docs OR every 5 seconds,
 * whichever comes first) so a 2000-doc run prints ~40 progress
 * lines plus a small summary table — readable on a terminal,
 * greppable in CI logs.
 *
 * # Exit codes
 *   0 — success
 *   1 — bad CLI input or render failure
 */

import path from 'path';
import process from 'process';

import { createRng } from './seedrand.js';
import { planReports } from './generators/patients.js';
import { fillReport } from './generators/analytes.js';
import { loadDefs, createPrinter, renderAll } from './render.js';

// All known panel slugs. Used both as the default --panels value
// and as the validation whitelist when the user passes their own.
const ALL_PANELS = ['cbc', 'hba1c', 'iron', 'kft', 'lft', 'lipid', 'thyroid', 'urine'];

// Defaults. Centralised so --help and the parser stay in sync.
const DEFAULTS = Object.freeze({
  count: 2000,
  seed: 42,
  outDir: './test-sample',
  uniqueFrac: 0.7,
  recurringMin: 2,
  recurringMax: 5,
  panels: ALL_PANELS.slice(),
});

// Progress-throttle constants. The CLI prints a progress line after
// either of these conditions is met since the previous print.
const PROGRESS_EVERY_DOCS = 50;
const PROGRESS_EVERY_MS = 5_000;

/**
 * Render the usage block. Mirrors README.md flag list exactly so
 * the two don't drift.
 *
 * @returns {string} multi-line usage text, no trailing newline
 */
function helpText() {
  return [
    'Usage: lab-pdf-gen [options]',
    '',
    'Generate synthetic Indian-style lab-report PDFs into a flat output',
    'directory suitable for pointing the LabSense agent watch_dir at.',
    '',
    'Options:',
    `  --count N                 Number of PDFs to emit (default ${DEFAULTS.count})`,
    `  --seed N                  Deterministic RNG seed (default ${DEFAULTS.seed})`,
    `  --out-dir PATH            Output directory (default ${DEFAULTS.outDir})`,
    `  --mix unique=F,recurring=F`,
    `                            Override patient mix (default unique=${DEFAULTS.uniqueFrac},recurring=${(1 - DEFAULTS.uniqueFrac).toFixed(1)})`,
    `  --recurring-reports min=N,max=N`,
    `                            Reports per recurring patient (default min=${DEFAULTS.recurringMin},max=${DEFAULTS.recurringMax})`,
    `  --panels cbc,hba1c,iron,kft,lft,lipid,thyroid,urine`,
    `                            Panel filter (default all eight)`,
    '  -h, --help                Show this help and exit',
    '',
    'Example:',
    '  lab-pdf-gen --count 500 --seed 99 --out-dir ./test-sample',
  ].join('\n');
}

/**
 * Print `msg` to stderr and exit with code 1. Used for fatal CLI
 * input errors where we want a non-zero exit *and* the error message
 * visible to a CI log.
 *
 * @param {string} msg
 * @returns {never}
 */
function fail(msg) {
  process.stderr.write(`lab-pdf-gen: ${msg}\n`);
  process.exit(1);
}

/**
 * Parse the `key=value,key=value,...` mini-syntax used by --mix and
 * --recurring-reports.
 *
 * @param {string} raw - argument value, e.g. 'unique=0.7,recurring=0.3'
 * @returns {Record<string, string>}
 */
function parseKvPairs(raw) {
  const out = Object.create(null);
  for (const piece of raw.split(',')) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) {
      throw new Error(`invalid key=value pair '${piece}'`);
    }
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    out[key] = value;
  }
  return out;
}

/**
 * Parse `process.argv.slice(2)` into a flat options object. Throws
 * `Error` on syntactic problems; semantic validation happens in
 * `validateOptions` against the resolved defaults.
 *
 * @param {string[]} argv
 * @returns {object}
 */
function parseArgs(argv) {
  // Start from a copy of DEFAULTS so missing flags get their default
  // value automatically. `panels` is array-copied to avoid sharing.
  const opts = {
    count: DEFAULTS.count,
    seed: DEFAULTS.seed,
    outDir: DEFAULTS.outDir,
    uniqueFrac: DEFAULTS.uniqueFrac,
    recurringMin: DEFAULTS.recurringMin,
    recurringMax: DEFAULTS.recurringMax,
    panels: DEFAULTS.panels.slice(),
    help: false,
  };

  // Hand-rolled loop. We accept both `--flag value` and `--flag=value`
  // because users frequently expect both forms to work.
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    // Allow `--flag=value` by splitting on the first `=` only.
    let name = arg;
    let inlineValue = null;
    if (arg.startsWith('--') && arg.includes('=')) {
      const eqIdx = arg.indexOf('=');
      name = arg.slice(0, eqIdx);
      inlineValue = arg.slice(eqIdx + 1);
    }

    /**
     * Pull the next argv slot as a flag's value, supporting both
     * `--flag value` and `--flag=value` forms.
     */
    const consume = () => {
      if (inlineValue !== null) return inlineValue;
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) {
        throw new Error(`flag '${name}' requires a value`);
      }
      i += 1;
      return v;
    };

    switch (name) {
      case '-h':
      case '--help':
        opts.help = true;
        break;

      case '--count':
        opts.count = Number(consume());
        break;

      case '--seed':
        opts.seed = Number(consume());
        break;

      case '--out-dir':
        opts.outDir = consume();
        break;

      case '--mix': {
        const kv = parseKvPairs(consume());
        if (kv.unique !== undefined) {
          opts.uniqueFrac = Number(kv.unique);
        } else if (kv.recurring !== undefined) {
          // Allow expressing the mix from either side; they must sum
          // to 1.0 conceptually but we only store uniqueFrac.
          opts.uniqueFrac = 1 - Number(kv.recurring);
        } else {
          throw new Error(`--mix needs unique=<frac> or recurring=<frac>`);
        }
        break;
      }

      case '--recurring-reports': {
        const kv = parseKvPairs(consume());
        if (kv.min !== undefined) opts.recurringMin = Number(kv.min);
        if (kv.max !== undefined) opts.recurringMax = Number(kv.max);
        break;
      }

      case '--panels': {
        const list = consume()
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        opts.panels = list;
        break;
      }

      default:
        throw new Error(`unknown flag '${arg}'`);
    }
  }

  return opts;
}

/**
 * Validate the resolved options. Centralised so the parser can stay
 * focused on syntax and this function owns the semantics.
 *
 * Throws an Error with a human-readable message on the first
 * problem encountered; the caller forwards it to `fail()`.
 *
 * @param {ReturnType<typeof parseArgs>} opts
 */
function validateOptions(opts) {
  if (!Number.isFinite(opts.count) || !Number.isInteger(opts.count) || opts.count <= 0) {
    throw new Error(`--count must be a positive integer (got ${opts.count})`);
  }
  if (!Number.isFinite(opts.seed) || !Number.isInteger(opts.seed)) {
    throw new Error(`--seed must be an integer (got ${opts.seed})`);
  }
  if (
    !Number.isFinite(opts.uniqueFrac) ||
    opts.uniqueFrac < 0 ||
    opts.uniqueFrac > 1
  ) {
    throw new Error(
      `--mix unique fraction must be in [0,1] (got ${opts.uniqueFrac})`,
    );
  }
  if (
    !Number.isInteger(opts.recurringMin) ||
    !Number.isInteger(opts.recurringMax) ||
    opts.recurringMin < 1 ||
    opts.recurringMax < opts.recurringMin
  ) {
    throw new Error(
      `--recurring-reports needs integer min>=1 and max>=min (got min=${opts.recurringMin}, max=${opts.recurringMax})`,
    );
  }
  if (!Array.isArray(opts.panels) || opts.panels.length === 0) {
    throw new Error('--panels must list at least one panel');
  }
  for (const p of opts.panels) {
    if (!ALL_PANELS.includes(p)) {
      throw new Error(
        `--panels: unknown panel '${p}' (valid: ${ALL_PANELS.join(', ')})`,
      );
    }
  }
}

/**
 * Format an integer with thousands separators (so 2000 reads as
 * "2,000" in the summary). Avoids a locale dependency.
 *
 * @param {number} n
 * @returns {string}
 */
function formatInt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Render a small ASCII table from an object of `label → count`.
 * Used for the per-panel and per-lab summary blocks. Keys are
 * left-aligned, counts are right-aligned within their column.
 *
 * @param {string} title
 * @param {Record<string, number>} counts
 * @returns {string} multi-line table; no trailing newline
 */
function asciiTable(title, counts) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return `${title}:\n  (none)`;
  }
  const labelWidth = Math.max(...entries.map(([k]) => k.length), 5);
  const countWidth = Math.max(...entries.map(([, v]) => formatInt(v).length), 5);
  const lines = [`${title}:`];
  for (const [label, count] of entries) {
    lines.push(
      `  ${label.padEnd(labelWidth)}  ${formatInt(count).padStart(countWidth)}`,
    );
  }
  return lines.join('\n');
}

/**
 * Build a progress callback that prints at most every
 * `PROGRESS_EVERY_DOCS` docs OR every `PROGRESS_EVERY_MS`
 * milliseconds, whichever happens first. Always prints the final
 * batch so the user sees a clean closing line.
 *
 * @returns {(p:{done:number,total:number}) => void}
 */
function makeProgressLogger() {
  let lastPrintedDone = 0;
  let lastPrintedAt = Date.now();
  return ({ done, total }) => {
    const now = Date.now();
    const isFinal = done >= total;
    const docsSinceLast = done - lastPrintedDone;
    const elapsedSinceLast = now - lastPrintedAt;
    if (
      isFinal ||
      docsSinceLast >= PROGRESS_EVERY_DOCS ||
      elapsedSinceLast >= PROGRESS_EVERY_MS
    ) {
      process.stdout.write(`[${done}/${total}] rendered\n`);
      lastPrintedDone = done;
      lastPrintedAt = now;
    }
  };
}

/**
 * Main entry point. Returns nothing; calls `process.exit` directly
 * on fatal errors so the bash exit-code is correct.
 *
 * @returns {Promise<void>}
 */
async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${helpText()}\n\n`);
    fail(err.message);
  }

  if (opts.help) {
    process.stdout.write(`${helpText()}\n`);
    return;
  }

  try {
    validateOptions(opts);
  } catch (err) {
    fail(err.message);
  }

  // Resolve outDir against process.cwd() so relative paths behave
  // intuitively when the CLI is invoked from any directory.
  const outDir = path.resolve(process.cwd(), opts.outDir);

  // 1. RNG + reference data.
  const rng = createRng(opts.seed);
  const defs = loadDefs();
  const printer = createPrinter();

  process.stdout.write(
    `lab-pdf-gen: seed=${opts.seed} count=${opts.count} out=${outDir}\n`,
  );
  process.stdout.write(
    `lab-pdf-gen: panels=${opts.panels.join(',')} mix=unique:${opts.uniqueFrac.toFixed(2)} recurring=${opts.recurringMin}-${opts.recurringMax}\n`,
  );

  // 2. Plan the patient mix and per-report shells.
  const shells = planReports({
    rng,
    count: opts.count,
    uniqueFrac: opts.uniqueFrac,
    recurringMin: opts.recurringMin,
    recurringMax: opts.recurringMax,
    panels: opts.panels,
  });
  process.stdout.write(`lab-pdf-gen: planned ${shells.length} reports\n`);

  // 3. Fill each shell with analyte values. This is CPU-cheap
  //    (table lookups + arithmetic) so we do it synchronously
  //    before any disk I/O — keeps the render-batch logic simple.
  const reports = shells.map((s) => fillReport(s, defs, rng));

  // 4. Render to disk, with throttled progress.
  const startedAt = Date.now();
  const onProgress = makeProgressLogger();

  let stats;
  try {
    stats = await renderAll(reports, outDir, printer, onProgress);
  } catch (err) {
    fail(`render failed: ${err.message}`);
  }

  const elapsedMs = Date.now() - startedAt;
  const elapsedSec = elapsedMs / 1000;
  const throughput = elapsedSec > 0 ? stats.written / elapsedSec : 0;

  // 5. Final summary. Plain text, two ASCII tables, one stats line.
  process.stdout.write('\n');
  process.stdout.write(`Done. Wrote ${formatInt(stats.written)} PDF(s) to ${outDir}\n`);
  process.stdout.write(
    `Elapsed: ${elapsedSec.toFixed(1)}s  Throughput: ${throughput.toFixed(1)} docs/sec\n`,
  );
  process.stdout.write('\n');
  process.stdout.write(`${asciiTable('By panel', stats.byPanel)}\n`);
  process.stdout.write('\n');
  process.stdout.write(`${asciiTable('By lab', stats.byLab)}\n`);
}

// Top-level await would also work, but a `.catch` keeps the exit
// path uniform regardless of whether the failure is sync or async.
main().catch((err) => {
  process.stderr.write(`lab-pdf-gen: unexpected failure: ${err.stack ?? err}\n`);
  process.exit(1);
});

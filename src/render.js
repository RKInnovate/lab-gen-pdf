/**
 * PDF rendering pipeline — turns fully-populated `Report` objects
 * into pdfmake docDefinitions, then into on-disk `.pdf` files under
 * the configured output directory.
 *
 * # Purpose
 * This module sits between the data layer (patients.js + analytes.js
 * generate the structured Report) and the output layer (the
 * `test-sample/` folder the LabSense agent watches). It is the only
 * place in the codebase that knows about pdfmake's `PdfPrinter`
 * lifecycle, font registration, and how to dispatch a Report to the
 * correct panel-specific template.
 *
 * # Design decisions
 *
 * - **One `PdfPrinter` instance for the whole run.** PdfPrinter is
 *   safe to reuse across documents and font registration is the
 *   expensive part of construction. `createPrinter()` is called once
 *   by the CLI and then threaded into every `renderOne` call.
 *
 * - **Server-side fonts via `require.resolve`.** pdfmake ships the
 *   Roboto family inside `pdfmake/examples/fonts/`. Hard-coding a
 *   relative path breaks when this generator is consumed as a
 *   dependency (different node_modules layout) or when pdfmake
 *   reshuffles its internal directory structure. `createRequire` +
 *   `require.resolve` returns the absolute path the active pdfmake
 *   install actually uses, which is the only reliable strategy.
 *   A `pdfmake/build/`-prefixed fallback exists for the case where
 *   pdfmake moves the font directory in a future major.
 *
 * - **Streaming write, not buffer-then-write.** Each rendered PDF is
 *   piped directly into a `WriteStream` rather than buffered into a
 *   `Buffer` first. At 2000 PDFs * ~30 KB each this is not a memory
 *   crisis, but the streaming form is the idiomatic pdfmake usage
 *   and lets the OS overlap fsync work with the next document's
 *   layout pass.
 *
 * - **Batches of 8 concurrent renders.** pdfmake's layout engine is
 *   CPU-bound and single-threaded per document, so beyond a small
 *   handful of parallel docs the bottleneck is the event loop, not
 *   I/O. Empirically 8 wide gives the best throughput on a modern
 *   laptop without starving other tasks; higher concurrency also
 *   triggers known issues in pdfmake's internal font-glyph cache
 *   when many docs initialise the same printer simultaneously.
 *
 * - **Stable, OS-safe filename format.** `{lab_slug}_{panel}_
 *   {patient_id}_{YYYYMMDD-HHmmss}.pdf` matches the README contract
 *   the agent watch_dir documentation references. Any character
 *   outside `[A-Za-z0-9._-]` is replaced with `-` defensively, since
 *   patient/lab data shouldn't contain such characters but we'd
 *   rather not blow up on a stray slash if the data layer changes.
 */

import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

import PdfPrinter from 'pdfmake';

import { buildDocDefinition as buildCbc } from './templates/cbc.js';
import { buildDocDefinition as buildLipid } from './templates/lipid.js';
import { buildDocDefinition as buildLft } from './templates/lft.js';
import { buildDocDefinition as buildThyroid } from './templates/thyroid.js';

// `createRequire` gives us a CommonJS-style `require` inside an ESM
// module. We use it purely for `require.resolve`, which is the only
// reliable way to locate files inside a sibling package regardless
// of node_modules layout (hoisted, pnpm-isolated, workspaces, etc.).
const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Absolute path to the bundled analyte catalogue. Resolved once at
// module load — file is small (~10 KB) and never changes mid-run.
const DEFS_PATH = path.resolve(__dirname, '..', 'data', 'analyte-defs.json');

// Maximum concurrent renders. See the file-header note on why 8.
const RENDER_CONCURRENCY = 8;

// Filenames pdfmake's VFS uses for the bundled Roboto family. The
// names are stable across the 0.1.x / 0.2.x line and double as the
// keys we look up inside vfs_fonts.js.
const ROBOTO_FILES = {
  normal: 'Roboto-Regular.ttf',
  bold: 'Roboto-Medium.ttf',
  italics: 'Roboto-Italic.ttf',
  bolditalics: 'Roboto-MediumItalic.ttf',
};

/**
 * Resolve the four Roboto font sources pdfmake ships with itself,
 * in a shape suitable for `new PdfPrinter({ Roboto: ... })`.
 *
 * pdfmake@0.2.x no longer ships raw `.ttf` files inside the npm
 * package — Roboto is embedded as base64 strings in
 * `build/vfs_fonts.js`. PdfPrinter's font descriptors accept
 * `Buffer` values in addition to filesystem paths (pdfkit, the
 * underlying engine, registers either), so we decode the VFS once
 * at startup and hand pdfmake Buffers directly. This works
 * regardless of node_modules layout (hoisted, pnpm-isolated,
 * workspaces) because we resolve the VFS module via `require`,
 * not by guessing a relative path.
 *
 * The optional first path tries raw `examples/fonts/*.ttf` for
 * forward-compat — if a future pdfmake version ships the TTFs
 * directly again, we'll prefer the on-disk form (saves the base64
 * decode + buffer allocation on every startup).
 *
 * @returns {{normal:Buffer|string,bold:Buffer|string,
 *           italics:Buffer|string,bolditalics:Buffer|string}}
 *   File paths if raw TTFs are present, otherwise Buffers of
 *   decoded font bytes — either is a valid pdfmake font source.
 */
function resolveRobotoFonts() {
  // Optional fast path: raw TTFs (pdfmake 0.1.x / hypothetical
  // future major). Skip silently if missing; the VFS path below
  // is the documented 0.2.x location.
  try {
    return {
      normal: require.resolve(`pdfmake/examples/fonts/${ROBOTO_FILES.normal}`),
      bold: require.resolve(`pdfmake/examples/fonts/${ROBOTO_FILES.bold}`),
      italics: require.resolve(`pdfmake/examples/fonts/${ROBOTO_FILES.italics}`),
      bolditalics: require.resolve(`pdfmake/examples/fonts/${ROBOTO_FILES.bolditalics}`),
    };
  } catch {
    /* fall through to VFS */
  }

  // Documented 0.2.x path: pdfmake/build/vfs_fonts.js exports a
  // CommonJS object keyed by font filename → base64 payload.
  let vfs;
  try {
    vfs = require('pdfmake/build/vfs_fonts.js');
  } catch (err) {
    let pdfmakeVersion = 'unknown';
    try {
      pdfmakeVersion = require('pdfmake/package.json').version;
    } catch {
      /* ignore — bigger problems if pdfmake itself is missing */
    }
    throw new Error(
      `lab-pdf-gen: cannot load pdfmake's bundled Roboto fonts ` +
        `(pdfmake@${pdfmakeVersion}). Tried raw TTF resolution and ` +
        `pdfmake/build/vfs_fonts.js — both failed. Reinstall pdfmake ` +
        `or pin a known-good version. Original: ${err.message}`,
    );
  }

  const missing = Object.values(ROBOTO_FILES).filter((f) => !(f in vfs));
  if (missing.length > 0) {
    throw new Error(
      `lab-pdf-gen: pdfmake VFS is present but missing Roboto entries: ` +
        `${missing.join(', ')}. The VFS contract has shifted; pin pdfmake ` +
        `to a version that still ships Roboto in vfs_fonts.js.`,
    );
  }

  return {
    normal: Buffer.from(vfs[ROBOTO_FILES.normal], 'base64'),
    bold: Buffer.from(vfs[ROBOTO_FILES.bold], 'base64'),
    italics: Buffer.from(vfs[ROBOTO_FILES.italics], 'base64'),
    bolditalics: Buffer.from(vfs[ROBOTO_FILES.bolditalics], 'base64'),
  };
}

// Resolve fonts lazily so module import doesn't fail if pdfmake
// isn't installed yet (e.g. linters that import this file).
let cachedFontDescriptors = null;
function getFontDescriptors() {
  if (!cachedFontDescriptors) {
    cachedFontDescriptors = { Roboto: resolveRobotoFonts() };
  }
  return cachedFontDescriptors;
}

/**
 * Synchronously load the analyte catalogue used by the generators
 * and templates. The catalogue is small (~10 KB) so we do this on
 * the main thread once at CLI startup; the cost is negligible
 * compared to a single PDF render.
 *
 * @returns {object} Parsed JSON object with top-level keys
 *   `_meta`, `cbc`, `lipid`, `lft`, `thyroid`.
 */
export function loadDefs() {
  return JSON.parse(fs.readFileSync(DEFS_PATH, 'utf8'));
}

/**
 * Build a configured `PdfPrinter` instance. Call once per run and
 * thread the result into every `renderOne` / `renderAll` call —
 * font registration is the expensive part of construction.
 *
 * @returns {PdfPrinter} A pdfmake printer with the Roboto font
 *   family registered. Safe to reuse across many documents.
 */
export function createPrinter() {
  return new PdfPrinter(getFontDescriptors());
}

/**
 * Dispatch a report to its panel-specific template module.
 *
 * Static imports (vs. dynamic) so the bundler / loader has a stable
 * graph and there is no async-import cost in the render hot path.
 *
 * @param {string} panel - one of 'cbc' | 'lipid' | 'lft' | 'thyroid'
 * @returns {(report:object) => object} a `buildDocDefinition` fn
 */
function templateFor(panel) {
  switch (panel) {
    case 'cbc':
      return buildCbc;
    case 'lipid':
      return buildLipid;
    case 'lft':
      return buildLft;
    case 'thyroid':
      return buildThyroid;
    default:
      throw new Error(`lab-pdf-gen: unknown panel '${panel}'`);
  }
}

/**
 * Format a Date as `YYYYMMDD-HHmmss` in the lab's local time. We
 * deliberately use the host's local timezone rather than UTC because
 * the patient-facing report block on the PDF is also rendered in
 * local time — keeping the filename in the same timezone makes the
 * cross-referencing painless for a human inspecting the watch dir.
 *
 * @param {Date} d
 * @returns {string} `YYYYMMDD-HHmmss`
 */
function formatTimestamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

/**
 * Sanitise a filename fragment. Patient IDs / lab slugs / panel
 * names *should* already be filesystem-safe by construction, but if
 * a future data-layer change introduces a slash, colon, or other
 * meta-char we'd rather replace it than crash mid-batch.
 *
 * @param {string} part
 * @returns {string} same length, with unsafe chars replaced by '-'
 */
function safeFragment(part) {
  return String(part).replace(/[^A-Za-z0-9._-]/g, '-');
}

/**
 * Build the on-disk filename for a report, per the README contract:
 *   `{lab_slug}_{panel}_{patient_id}_{YYYYMMDD-HHmmss}.pdf`
 *
 * @param {object} report - populated report (has .patient.lab.slug,
 *   .panel, .patient.id, .sampleDate)
 * @returns {string} filename only (no directory component)
 */
function makeFilename(report) {
  const labSlug = safeFragment(report.patient.lab.slug);
  const panel = safeFragment(report.panel);
  const patientId = safeFragment(report.patient.id);
  const ts = formatTimestamp(report.sampleDate);
  return `${labSlug}_${panel}_${patientId}_${ts}.pdf`;
}

/**
 * Render a single report to disk.
 *
 * Uses the streaming form of pdfmake (`createPdfKitDocument` + pipe
 * to a WriteStream) so layout/serialisation overlaps with disk I/O.
 * Returns the absolute path the PDF was written to, suitable for
 * logging or for the agent watch-dir contract.
 *
 * @param {object} report - fully-populated report from `fillReport`
 * @param {string} outDir - directory the PDF should land in;
 *   created with `recursive: true` if missing
 * @param {PdfPrinter} printer - shared printer from `createPrinter`
 * @returns {Promise<string>} absolute path to the written `.pdf`
 *
 * @example
 *   const printer = createPrinter();
 *   const fullPath = await renderOne(report, './test-sample', printer);
 *   console.log('wrote', fullPath);
 */
export async function renderOne(report, outDir, printer) {
  const buildDocDefinition = templateFor(report.panel);
  const docDefinition = buildDocDefinition(report);
  const filename = makeFilename(report);
  const fullPath = path.resolve(outDir, filename);

  // mkdir is idempotent with `recursive: true`. Called per file so
  // the function can be invoked standalone (e.g. from a one-off
  // script) without the caller having to pre-create outDir.
  await fsPromises.mkdir(outDir, { recursive: true });

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, val) => {
      if (settled) return;
      settled = true;
      fn(val);
    };

    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    const stream = fs.createWriteStream(fullPath);

    // `finish` fires after the OS has accepted the last byte; this
    // is the correct success signal for the agent watch path.
    stream.on('finish', () => settle(resolve, fullPath));
    stream.on('error', (err) => settle(reject, err));
    pdfDoc.on('error', (err) => settle(reject, err));

    pdfDoc.pipe(stream);
    pdfDoc.end();
  });
}

/**
 * Render an array of reports concurrently, in fixed-size batches.
 *
 * The batching is deliberate: see the file header for why 8 wide is
 * the sweet spot. After each batch the optional `onProgress` hook
 * is called so the CLI can print throughput without coupling the
 * renderer to a specific output format.
 *
 * Aggregates per-panel and per-lab counts so the CLI summary can
 * show distribution without re-walking the report array.
 *
 * @param {object[]} reports - populated reports
 * @param {string} outDir - directory to write PDFs into
 * @param {PdfPrinter} printer - shared printer
 * @param {(progress:{done:number,total:number}) => void} [onProgress]
 *   called after each batch with cumulative counts
 * @returns {Promise<{
 *   written: number,
 *   byPanel: Record<string, number>,
 *   byLab: Record<string, number>,
 * }>}
 */
export async function renderAll(reports, outDir, printer, onProgress) {
  const byPanel = Object.create(null);
  const byLab = Object.create(null);
  let written = 0;

  // Ensure outDir exists once up-front so the per-call mkdir in
  // renderOne is a cheap no-op for every subsequent file.
  await fsPromises.mkdir(outDir, { recursive: true });

  for (let i = 0; i < reports.length; i += RENDER_CONCURRENCY) {
    const batch = reports.slice(i, i + RENDER_CONCURRENCY);
    // Promise.all settles on first rejection — that's the desired
    // behaviour: a bad template should fail loudly so it doesn't
    // silently corrupt 1999 of 2000 outputs.
    // eslint-disable-next-line no-await-in-loop -- batches must be sequential
    await Promise.all(batch.map((r) => renderOne(r, outDir, printer)));

    for (const r of batch) {
      byPanel[r.panel] = (byPanel[r.panel] ?? 0) + 1;
      const slug = r.patient.lab.slug;
      byLab[slug] = (byLab[slug] ?? 0) + 1;
    }
    written += batch.length;

    if (onProgress) {
      onProgress({ done: written, total: reports.length });
    }
  }

  return { written, byPanel, byLab };
}

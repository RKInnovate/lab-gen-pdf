/**
 * Layout: Multi-Column Grid Form — STUB.
 *
 * Visual goal (when implemented): patient info rendered as a 3-column
 * grid (5 fields per column, very compact). Results in a 2-column
 * table layout, with each "cell" being `Test: Value (Range) [Flag]`
 * — i.e. two analyte rows per visual row. Tiny font (8pt). Mimics the
 * dense diagnostic-chain (e.g. Dr. Lal PathLabs, Thyrocare) print
 * style optimised for fitting a full profile on one A4 page.
 *
 * This stub re-exports the corporate-clean layout so the layout
 * dispatch machinery sees a valid module under this key. The real
 * implementation will replace this file entirely.
 */
export * from './corporate-clean.js';

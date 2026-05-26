/**
 * Layout: Faxed / Photocopied Look — STUB.
 *
 * Visual goal (when implemented): mimics a photocopied or low-quality
 * fax of an otherwise normal lab report. Light gray page background
 * (e.g. #ECECEC), reduced text contrast (e.g. #444 instead of #000),
 * dotted/dashed table borders, faint horizontal "scan line" rules,
 * slightly larger character spacing, and the occasional faint smudge
 * (a half-opacity gray block in the margin). The actual content is
 * still a real synthetic report — only the rendering is degraded —
 * so we can stress-test OCR + parsing under realistic low-quality
 * input conditions without resorting to post-processing.
 *
 * Note: pdfmake does not expose general affine transforms, so we
 * achieve the photocopy aesthetic via colours, dash patterns, and
 * spacing tweaks rather than rotation/skew. Real photocopier
 * distortions can be added in a future post-processing pipeline.
 *
 * This stub re-exports the corporate-clean layout so the layout
 * dispatch machinery sees a valid module under this key. The real
 * implementation will replace this file entirely.
 */
export * from './corporate-clean.js';

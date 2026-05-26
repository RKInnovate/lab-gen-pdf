/**
 * Layout: Bilingual English + Hindi (Devanagari) — STUB.
 *
 * Visual goal (when implemented): every field label appears in
 * English followed by the same label in Devanagari (Hindi script)
 * either on a second line or in parentheses. Affects the lab name
 * tagline, the patient-info field labels, the results-table column
 * headers, the panel title, the endorsement line, and the page
 * footer disclaimer. Values themselves (numbers + units) stay in
 * English. Realistic for government / public-sector labs in
 * North-Indian states where bilingual reports are mandated.
 *
 * Note: requires Noto Sans Devanagari TTFs vendored under
 * assets/fonts/. The renderer registers the family conditionally
 * when this layout is in use; if the fonts are missing, the layout
 * falls back to Latin-only labels with a one-line warning.
 *
 * This stub re-exports the corporate-clean layout so the layout
 * dispatch machinery sees a valid module under this key. The real
 * implementation will replace this file entirely.
 */
export * from './corporate-clean.js';

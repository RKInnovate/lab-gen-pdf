/**
 * Layout registry — 8 visual layouts for the synthetic lab-report generator.
 *
 * # Purpose
 * Each Report carries a `layoutKey` string (assigned by the patient
 * planner) that names the visual layout the panel template should
 * compose with. This module is the only place where layout module
 * paths are wired up; panel templates and the renderer go through
 * `layoutFor(key)` rather than importing layouts directly, so adding
 * or removing a layout only touches this file.
 *
 * # The 8 layouts
 *   corporate-clean          — modern corporate-clinic look (default reference)
 *   old-school-bordered      — Times-serif, ALL CAPS, full black grid
 *   two-col-compact          — dot-leader rows, no big table, denser
 *   letterhead-minimal       — large letterhead, borderless results
 *   multi-col-grid           — 3-col patient grid, 2-col results, tiny font
 *   branded-modern-card      — full-width banner, sidebar meta, card per test
 *   faxed-look               — gray tint + low contrast + photocopy artefacts
 *   bilingual-en-hi          — English + Devanagari (Hindi) bilingual labels
 *
 * # Layout interface
 * Every layout module MUST export the same 10 named functions, with
 * the same signatures, so panel templates can compose them
 * interchangeably. The canonical definition lives in the docstring
 * of `./corporate-clean.js`; copy that contract verbatim into any
 * new layout you add.
 *
 * # Selection
 * `pickLayout(rng)` returns a uniformly random layoutKey from the
 * registry using the project's seeded RNG. Use it at planning time
 * (inside `generators/patients.js`) so a given Report has a stable
 * layoutKey for its entire lifetime — never re-pick at render time.
 */

import * as corporateClean from './corporate-clean.js';
import * as oldSchoolBordered from './old-school-bordered.js';
import * as twoColCompact from './two-col-compact.js';
import * as letterheadMinimal from './letterhead-minimal.js';
import * as multiColGrid from './multi-col-grid.js';
import * as brandedModernCard from './branded-modern-card.js';
import * as faxedLook from './faxed-look.js';
import * as bilingualEnHi from './bilingual-en-hi.js';

/**
 * Registry — `Object.freeze` prevents accidental mutation at runtime.
 * Order matters only for deterministic iteration in `LAYOUT_KEYS`.
 *
 * @type {Readonly<Record<string, object>>}
 */
export const LAYOUTS = Object.freeze({
  'corporate-clean': corporateClean,
  'old-school-bordered': oldSchoolBordered,
  'two-col-compact': twoColCompact,
  'letterhead-minimal': letterheadMinimal,
  'multi-col-grid': multiColGrid,
  'branded-modern-card': brandedModernCard,
  'faxed-look': faxedLook,
  'bilingual-en-hi': bilingualEnHi,
});

/**
 * Stable ordered list of layout keys. Generators and tests can pick
 * from this directly; the order is the insertion order above.
 *
 * @type {ReadonlyArray<string>}
 */
export const LAYOUT_KEYS = Object.freeze(Object.keys(LAYOUTS));

/**
 * Pick one layout key uniformly at random from the registry.
 *
 * Call this at Report-planning time and stash the result on the
 * Report shell — never re-roll at render time, otherwise the same
 * Report can render different bytes on re-run, breaking the
 * deterministic-per-seed contract.
 *
 * @param {import('../seedrand.js').Rng} rng — seeded RNG instance
 * @returns {string} a key present in LAYOUTS
 */
export function pickLayout(rng) {
  return rng.pick(LAYOUT_KEYS);
}

/**
 * Resolve a layout module by key, with a clear error when the key is
 * unknown (typo, stale layoutKey on a Report from an older registry,
 * etc.). Panel templates and the renderer use this single dispatch
 * point to avoid scattering layout-import paths through the codebase.
 *
 * @param {string} key — one of the keys in LAYOUTS
 * @returns {object} the layout module (with all 10 interface exports)
 * @throws {Error} if `key` is not a registered layout
 */
export function layoutFor(key) {
  const layout = LAYOUTS[key];
  if (!layout) {
    throw new Error(
      `lab-gen-pdf: unknown layoutKey '${key}'. ` +
        `Known: ${LAYOUT_KEYS.join(', ')}`,
    );
  }
  return layout;
}

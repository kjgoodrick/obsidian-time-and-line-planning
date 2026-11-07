# Validation

This public snapshot contains the plugin implementation from version `1.0.0-thanksgiving.11`. Personal validation narratives and data are omitted. Tests use synthetic fixtures.

## Reproduce automated checks

With Node 22+ and Python 3.9+:

```sh
npm ci
npm run package
```

Packaging runs TypeScript checking, the 223-test regression suite, the production build, and creation of a deterministic plugin-only ZIP. The DOM suites use Happy DOM and a small Obsidian API fixture; they do not execute the native Obsidian app. The optional [collaboration bridge](COLLABORATION.md) checks include explicit annotation, exact lane identity, dirty-inspector navigation, range coordinate projection and mouse/touch/keyboard range selection. Team Relay's source interoperability fixture exercises both real view types and load orders with and without grouping, including range confirmation, exact lane markers and temporary navigation outside the data-derived axis. Native acceptance and remaining timeline targets are pending.

Coverage includes:

- Five-minute create/move/resize, exact off-grid times, seconds and milliseconds, save/reopen, shared undo, and conflicting edits.
- Midnight, leap years, timezone offsets, invalid or ambiguous DST wall times, elapsed duration, and basic early-CE/BCE behavior.
- Full overflowing labels, image/emoji icons, grouped rows, short bars, side-table labels, and editable native table color decoration.
- Locked editing, dependency navigation, dirty drafts, task creation requirements, missing targets, and read-only edge navigation.
- Stable viewport and focused controls across lock toggles and metadata/configuration refreshes.
- Compact hover cards and rich custom-image edge tooltips with a 100 ms delay, no duplicate tooltip, and native dismissal conventions.
- Drag/two-click measurement with at most two nonzero units down to seconds, reverse drags, release outside the SVG, cancellation, and no schedule writes.
- Synthetic touch-derived mouse events cannot reschedule tasks.
- Temporary comment-range focus and return preserve saved settings, task data,
  collapsed lanes, original viewport and dense Sequence layout. Tests cover
  changed axes, dirty inspectors, pending scroll callbacks, exact large decimals
  and bounded grids for billion-year historical intervals.

## Prior native desktop validation

The implementation was exercised in Obsidian 1.13.7 on macOS on November 1–2, 2026. Checks covered editing, save/reopen/undo, grouped and filtered views, editable native table colors, navigation, mouse measurement, stable lock toggling, and local image icons. Native custom-image navigation tooltips were checked using synthetic pointer events, including image loading and dismissal; this does not establish every physical pointer interaction.

Desktop mobile emulation at 390×844 and 844×390 covered responsive layout, editing and draft preservation across rotation. This is Chromium emulation, not native iOS.

## iPhone Simulator Safari/WebKit

The standalone harness uses real production view/rendering/editing code with a minimal Obsidian adapter and twelve synthetic tasks. It serves only on loopback and reads no personal vault.

```sh
npm run test:webkit
# In another terminal on a Mac with Xcode and an installed iOS runtime:
npm run test:webkit:simulator
```

The November 2, 2026 iPhone 17 / iOS 26.5 run passed 16/16 checks in portrait (402×714) and 16/16 in landscape (874×338). Native Simulator interactions also covered touch panning without rescheduling, date/time inputs, onscreen keyboard typing, and an unsaved draft surviving rotation. Those saved reports and screenshots are not included in the public repository; the harness generates fresh reports under ignored `dist/webkit/`.

Landscape Safari with the keyboard open left very little viewport height. Reliable action-row access in that state was not established; dismissing the keyboard restores the form. See [the harness guide](tests/webkit/README.md) for setup and interactive checks.

## Remaining limits

The full Obsidian iOS app has not been tested. Simulator Safari does not validate native plugin loading, Bases integration, vault persistence, background/resume, sync, or physical-device performance. Those require native Obsidian testing.

Native table decoration depends on Obsidian 1.13.7 markup. Unsupported markup should lose decoration without replacing editors. Undo is session-only. The civil-time axis cannot visually distinguish the two repeated wall-clock hours at a DST fallback; explicit offsets are required for exact edits. Legacy Sequence/historical features have basic regression coverage, not the same depth of manual checks as precise scheduling.

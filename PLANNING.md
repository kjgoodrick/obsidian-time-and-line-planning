# Time & Line — planning fork

This MIT-licensed fork of [Sabidurian’s Time & Line](https://github.com/sabidurian/timeline-gantt-view) adds precise scheduling and a touch-friendly task editor to Obsidian Bases. Based on upstream commit `a554066bf9ace86fbf8042a31c36a72ecda522cb`. Upstream attribution and LICENSE are retained. This repository contains the plugin and synthetic tests; personal vaults, notes, source exports, and migration tools are excluded.

## Build and install

Use Node 22 or newer and Python 3.9 or newer. From this directory:

```sh
npm ci
npm run package
```

The lockfile pins the development dependencies. Packaging runs TypeScript checks, the regression suite, and the production build. The deterministic ZIP in `dist/` contains only the plugin, license, this guide, and hashes. Its only runtime import is Obsidian; test/build libraries are not shipped. Copy `main.js`, `manifest.json`, and `styles.css` to `.obsidian/plugins/timeline-gantt-view/` in the intended vault, then enable **Time & Line (Planning)**. This fork uses the same plugin ID as upstream, so it replaces that plugin in the vault where you install it.

## Editing and display

Each view can select its label property (including a Bases formula), three ordered extra properties, timezone, snap interval, visual tick spacing, and one-task-per-row layout. For minute-level plans, use five-minute editing with 15-minute ticks. Labels start inside every bar and continue to the right when necessary; durations stay unchanged. Additional properties appear as colored badges. Real durations remain separate from selection hit areas.

Tap/click a task or use **Find task** to inspect it. **Locked** prevents timeline changes. Unlock to edit exact start/end values, move by ±5 minutes, or add/remove predecessors with the task picker. Save applies one undoable transaction. Dependencies do not shift dates. **Undo** survives view switches and closing/reopening the Base within the current plugin session; restarting Obsidian or reloading the plugin clears it. Native table/note edits use Obsidian’s own editing history instead.

Task rows show a small arrow at the viewport edge when their start or end is offscreen. Click it to reveal that boundary without changing the row or schedule. In packed layouts, each edge shows the nearest task on that row. Click a **Blocked by** or **Blocking** name to reveal and inspect it; a task excluded by the current view opens as a note. **Close** dismisses an unchanged inspector; **Discard changes** dismisses an edited draft. Save or discard a draft before following a dependency or opening its note.

On touch devices, timeline gestures scroll; they do not reschedule bars. Exact controls and dependency pickers are the supported mobile editing path. Desktop mouse dragging supports move, resize and creation with the same scheduling/persistence rules. New-task creation prompts for the properties needed by the saved Chef/Oven filters. The view selector and Chef group controls remain accessible; group labels stay at the left edge during horizontal scrolling.

The timeline’s civil-time axis uses its configured timezone regardless of device timezone. Persisted instants include UTC offsets. Exact controls retain unchanged raw values, seconds and milliseconds. A move preserves elapsed duration; a resize intentionally changes the selected boundary. Ambiguous/nonexistent DST wall times are rejected; Advanced time format allows an explicit offset. A civil axis cannot visually distinguish the two copies of a repeated DST hour, so use the exact editor for that hour. Historical and Sequence features remain, with basic early-CE/BCE compatibility regression checks; their full legacy surface has not received the same manual testing as the precise scheduling features.

Only dependencies with both endpoints visible are drawn. Filtering an endpoint or collapsing its group hides that arrow, while its relation remains stored and inspectable. The inverse **Blocking** list is derived from predecessors across all task notes. Overlapping dependencies appear as conflicts; there is no automatic scheduling engine or invented task hierarchy.

## Task icons

The optional `icon` note property accepts an emoji or a wikilink to a local image, such as `"[[Assets/Task icons/Sauce.png]]"`. Timeline labels, hover cards, the side table, task editor, picker and dependency lists display it separately from the stored Step. Custom images travel with the vault and need no remote connection. Native Bases' editable Step column remains the original text; the icon is a separate note property.

## Colors and editable tables

Bars use muted earth tones. In **Settings → Time & Line (Planning) → Property colors**, assign a named color to an exact property value. The same mapping drives timeline/Sequence bars, badges, the side table and native Bases table cells. Native Dish and Oven Temp fields remain directly editable; they are not replaced by read-only formulas. Saved views still select which property colors the bars. Dependency arrows use muted olive for satisfied links and rust for conflicts.

Native table coloring only decorates existing cells and leaves editing to Obsidian. It is verified against Obsidian 1.13.7's table markup; a future host change could require updating the decorator. Removing the plugin removes the decoration without changing task data. Generic palette defaults ship in the plugin; personal value assignments stay in the vault's plugin settings.

## Simulator testing

Run `npm run test:webkit`, then `npm run test:webkit:simulator` in another terminal. This serves synthetic fixtures only on loopback and opens the actual timeline UI in iPhone Simulator Safari. See [tests/webkit/README.md](tests/webkit/README.md) for setup and limits. It exercises real iOS WebKit, native date inputs and touch scrolling, with a small Obsidian host adapter. It does not establish native Obsidian integration or physical-phone acceptance.

See [TESTING.md](TESTING.md) for validation and remaining native iPhone checks, and [HANDOFF.md](HANDOFF.md) for development setup.

The optional [collaboration bridge](COLLABORATION.md) exposes local record and
property-badge targets, exact lane source objects, explicit annotation selection and guarded navigation to
companion plugins. Team Relay's development consumer connects those targets to
saved-view comment controls, including whole-view and supported lane ranges.
Opening a range outside the displayed axis temporarily focuses that interval;
**Return to data** restores the original view position. Dense Sequence uses
original property values during this temporary focus. Native acceptance, shared
markers and presence remain unfinished. Navigation adds no task writes or
settings synchronization.

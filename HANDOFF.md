# Developer and agent handoff

Repository: https://github.com/kjgoodrick/obsidian-time-and-line-planning

The default branch is `main`. This is an MIT-licensed planning fork of [Time & Line](https://github.com/sabidurian/timeline-gantt-view), based on upstream commit `a554066bf9ace86fbf8042a31c36a72ecda522cb`.

## Start here

1. Read [PLANNING.md](PLANNING.md) for the fork's behavior and installation.
2. Read [TESTING.md](TESTING.md) for checks already performed and remaining limits.
3. Use Node 22+ and Python 3.9+, then run `npm ci` and `npm run package`.
4. Install `main.js`, `manifest.json`, and `styles.css` from the build into a test vault's `.obsidian/plugins/timeline-gantt-view/` folder.

The plugin ID is unchanged from upstream. The initial published version is `1.0.0-thanksgiving.11`; the suffix is historical and no personal planning notes are included.

## Code map

- `src/SabidurianView.ts`: Bases integration, entry parsing, view lifecycle, configuration and viewport refresh.
- `src/interaction/TaskInspector.ts`: exact date/time editing, task creation and dependency navigation.
- `src/model/Scheduling.ts`, `src/utils/timezone.ts`, `src/model/EditHistory.ts`: scheduling, timezone conversion, write transactions and session undo.
- `src/renderer/`: timeline rendering, row-edge navigation, native table colors and hover behavior.
- `src/model/taskIcons.ts`: emoji and vault-local image icons.
- `src/interaction/MeasureManager.ts`, `src/utils/measureDuration.ts`: drag measurement and compact durations.
- `tests/`: automated regression tests; `tests/webkit/` is the standalone iOS Safari harness.
- `src/collaboration/CollaborationBridge.ts`: optional local targeting/navigation bridge with explicit annotation selection and pre-navigation dirty-inspector checks; see [COLLABORATION.md](COLLABORATION.md) for its version, permissions boundary and unfinished integrations.

Preserve exact stored times, user edits, and viewport position across lock toggles. Dependencies never automatically shift dates. Touch panning must not move tasks. Keep native table fields editable. Honor locks in every editing path.

## Data boundary

Only plugin code, documentation, build tooling and synthetic tests belong here. Personal vaults, `.obsidian` settings, notes, images, Notion exports, audit files and one-off migration tools are intentionally excluded. The public history contains upstream history plus a sanitized snapshot of the planning implementation; private development history is not published.

Use synthetic data for new regressions. Do not copy a user's real vault into this repository. Any testing against an existing vault must preserve that user's current edits.

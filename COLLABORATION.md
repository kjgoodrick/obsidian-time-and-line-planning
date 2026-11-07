# Collaboration bridge preview

The planning fork exposes a versioned local integration bridge for
`sabidurian-timeline` and `sabidurian-sequence`. This first increment provides
record/property-badge targeting, selection, visible geometry, navigation and
lifecycle notifications. It does **not** yet provide a complete comment feature.
The Team Relay consumer, annotations, explicit touch annotation mode, typed lane
targets, ranges, shared calendar markers and presence integration remain.

## Discovery and lifetime

Listen for the workspace event `time-and-line:collaboration-ready`. A consumer
loaded later can trigger `time-and-line:collaboration-request`, passing a function
that receives the same bridge. Check `protocolVersion === 1` before using it.
The bridge is also exposed as the plugin's `collaboration` property.

`getSurfaces()` returns currently connected view surfaces. `onChange(listener)`
returns an unsubscribe function and announces registration, render/selection
changes, removal and disposal. A consumer must stop using a disposed bridge and
discover a new one after plugin reload. One consumer's callback failure cannot
interrupt other consumers or view rendering.

Each surface exposes its owner Bases view and root element so the consumer can
associate it with the correct host pane. These are local host references, not
proof of a shared saved view. `revision` changes when the rendering/selection
context changes. `current()` and each captured handle's `current()` must still
hold at the point of use. Closing either the view or bridge invalidates handles.

## Targets and geometry

The advertised capabilities are `item`, `cell`, `selection`, `geometry`, and
`reveal`. Only registered renderer objects supply handles; text labels, SVG row
order, CSS selectors and file-path attributes are not used as durable identities.

| Target | Local identity |
| --- | --- |
| Item/bar/point | `{ type: 'item', file: TFile }` |
| Property badge | `{ type: 'cell', file: TFile, property: BasesPropertyId }` |

Property IDs retain their `note.`, `file.` or `formula.` namespace even when a
different display label is shown. Ambiguous legacy badge keys produce no cell
target and cannot silently fall back to an item target. Hidden badges do not
become item targets when navigating an existing cell discussion.

`handles()` returns at most 2,048 mounted item/badge handles. `hit(node, point?)`
returns the exact registered target. Optional `{ clientX, clientY }` coordinates
disambiguate badges under the transparent task hit rectangle; they are viewport
coordinates, not timeline or persisted coordinates. `geometry(target)` returns a
current DOM rectangle only when it intersects the timeline viewport. These
methods perform no database, file or network operations. Selection returns at
most 256 local files and never changes selection.

The consumer resolves each `TFile` to its managed record ID, verifies the exact
saved-view definition and source generation, checks permissions and chooses which
authorized discussions to display. The bridge has no account, shared registry,
message storage, transport or authorization implementation.

## Navigation safety

`reveal(target)` returns `revealed`, `hidden`, `property-hidden`, `ambiguous`,
`busy`, or `unavailable`. It scrolls the existing viewport without writing task
dates, order, dependencies, locks, selection or saved view configuration. It does
not open a task inspector or a note. A collapsed group or excluded item remains
an explicit unavailable/hidden location; it does not change saved filters or
collapse settings. Empty query results cannot navigate a detached old renderer.

An open task inspector with unsaved or invalid input causes `busy` before any
scroll. The draft stays untouched; the consumer should stop Follow and let the
user save or discard it explicitly. Closing an inspector releases this guard.

## Verification and remaining work

`npm run package` passes 85 synthetic regressions, TypeScript checking, production
build and deterministic plugin-only packaging. The 13 bridge cases use the real
Timeline/Sequence views and renderers with the existing Happy DOM host adapter.
They cover item/badge identity, aliases, re-render/rename, coordinate hit testing,
viewport clipping, selection preservation, collapsed groups, dirty inspector
navigation, empty results, ambiguous properties and disposal.

These tests do not establish native Obsidian desktop/mobile acceptance, rendered
touch targets or battery behavior. No test vault or production plugin has been
updated for this bridge. The archive remains a development build at the existing
version; no new release tag or downloadable release has been published.

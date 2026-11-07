# Collaboration bridge preview

The planning fork exposes a versioned local integration bridge for
`sabidurian-timeline` and `sabidurian-sequence`. It provides record/property-badge
targeting, selection, visible geometry, guarded navigation, explicit annotation
selection and lifecycle notifications. Team Relay's development consumer connects
these to its saved-view comment controls. It does **not** yet provide the complete
timeline comment feature: shared calendar markers, presence and native
desktop/mobile acceptance remain. Lane headers now expose exact query group
objects; the consumer derives typed targets with its existing authorization.

## Discovery and lifetime

Listen for the workspace event `time-and-line:collaboration-ready`. A consumer
loaded later can trigger `time-and-line:collaboration-request`, passing a function
that receives the same bridge. Check `protocolVersion === 1` before using it.
The bridge is also exposed as the plugin's `collaboration` property. Check
`available === true` and the advertised `viewTypes`; disposal makes `available`
false. These fields and the annotation capability are additive version-one
requirements of the current Team Relay consumer; the initial bridge without them
is not sufficient for contextual timeline comments.

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

The advertised capabilities are `item`, `cell`, `selection`, `geometry`,
`reveal`, `annotation`, `groups`, and `ranges`. Only registered renderer objects supply handles; text labels, SVG row
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

`groups()` returns up to 256 mounted SVG lane headers as
`{ target: { type: 'group', group: BasesEntryGroup }, element, current }`.
`groupHit(node)` resolves a descendant to exactly one header. The renderer stores
the original query group on its layout model before any manual ordering; equal
display labels, collapsed lanes and row packing do not replace that reference.
Changed/removed query objects and repaint/unload invalidate old handles.

The consumer verifies each source object belongs to the bound query, derives
typed values from `entry.getValue(groupingProperty)`, and offers explicit choices
when a native header combines different typed values. A group key's `toString()`,
header text, row index or first record is never the comment identity. Source
membership is evidence to verify, not a permission grant.

`revealGroup(group)` scrolls only vertically to the exact mounted header. It
preserves horizontal position, lane collapse, filters and saved settings, and
honors dirty inspectors. It returns unavailable for a replacement object, even
one with identical text. The consumer refuses navigation when the same typed
value has more than one distinct header. Formula groups and unsupported metadata
remain subject to the consumer's capability and dependency-authorization gates.

## Range bridge

The optional `ranges` capability adds `rangeContext`, `beginRange`,
`rangeGeometry` and `revealRange`. A current context captures the axis descriptor,
effective timezone and supported semantic kinds. The descriptor retains full
property namespaces and configured timezone; the consumer must independently
bind it to the authorized saved-view axis ID/revision. No local bridge result is
a durable identity or permission grant.

`beginRange(kind, historicalPrecision, select, stopped)` supports mouse drag,
two clicks/taps and keyboard endpoints. Arrow keys move the endpoint, Shift uses
a larger step, Enter/Space chooses it, and Escape cancels. Touch pan/pinch keep
their default behavior; the compatibility click cannot edit a schedule.
Window blur, hidden document, axis replacement and unload clean up selection.
Descendant focus changes do not count as window blur. The callback returns a
bounded editable draft, not a committed annotation; ambiguous DST times retain
an explicit issue requiring offset confirmation. Consumer cancellation must
suppress late callbacks, while ordinary provider cleanup may precede delivery.

Coordinates reuse the server/client version-one corpus. Calendar and historical
closed endpoints cover the whole stated period. Historical years use arithmetic
Gregorian periods, including astronomical year zero, without Date limits.
Sequence stores property values; dense projection maps through occupied values
and never persists a visual index. Decimal differences are calculated before
conversion to a pixel ratio. Exact instants retain their offsets; civil-axis DST
endpoint discontinuities are flagged. Historical second-based timezone offsets
use a UTC serialization when a minute offset would change the instant.

Geometry returns viewport coordinates and a lifetime check, with an optional
exact query group for a lane band. The consumer owns markers and clipping.
`revealRange` scrolls the existing axis when it covers the interval. Otherwise it
opens a temporary **Viewing comment range** viewport, with **Return to data**
restoring the original position. Dates, order, filters, collapse, locks and saved
settings stay unchanged. A second range retains the original return point.
Ordinary data refreshes preserve focus; axis/property/timezone or host-config
replacement clears it. Dirty inspector input blocks both navigation and return.
Pending animation-frame restoration cannot undo explicit range/item navigation.

Dense Sequence temporarily displays original property values when a range cannot
be projected into its occupied positions; it restores dense layout on return.
Exact decimal targets remain unchanged. Historical domains outside JavaScript
Date and very large spans use a bounded numeric grid; focus never enumerates the
gap to the data. Focused canvases are bounded and off-axis task bars are culled.
Lane reveal validates the exact source group before changing the viewport and
preserves its collapsed state. Rebuilding the viewport invalidates previously
captured geometry and selection contexts; consumers must reacquire them.

An empty/invalid query without a live axis still returns unavailable; it cannot
navigate a detached old renderer. The companion consumer owns the range comment
form, saved decorations and persistence. Presence and shared milestones remain
unfinished.

## Navigation safety

`reveal(target)` returns `revealed`, `hidden`, `property-hidden`, `ambiguous`,
`busy`, or `unavailable`. It scrolls the existing viewport without writing task
dates, order, dependencies, locks, selection or saved view configuration. It does
not open a task inspector or a note. A collapsed group or excluded item remains
an explicit unavailable/hidden location; it does not change saved filters or
collapse settings. Empty query results cannot navigate a detached old renderer.

An open task inspector with unsaved or invalid input causes `busy` before any
scroll. `bridge.canNavigate(document)` exposes the same check before the consumer
opens another file or activates a saved view. Recheck after asynchronous work and
before each later navigation step. The draft stays untouched; the consumer should
stop Follow and let the user save or discard it explicitly. Closing an inspector
releases this guard. A disposed bridge returns false from this method.

## Explicit annotation selection

`surface.beginAnnotation(select, stopped)` enters one-shot target selection and
returns an idempotent cleanup function, or undefined when unavailable or blocked
by inspector changes. The consumer must expose an explicit entry/cancel control.
The selection callback accepts either an item/cell handle or a group handle.
Lane header selection is intercepted before its normal collapse action.
Capture listeners prevent task editing, mouse compatibility gestures, context
menus and scheduling keys. A click/tap resolves the exact current handle, removes
the listeners, calls `stopped`, then synchronously calls `select(handle)`. It does
not send a comment or mutate a task. Consumers still check current permissions
and saved-view/record identity before acting.

Touch start is not default-prevented, retaining native panning. Pointer movement
beyond eight pixels and pointer cancellation suppress the following click.
Tab remains available; Escape, window blur, document hiding, surface unload and
explicit cleanup exit the mode. Re-entering stops the previous mode. The consumer
must also cancel on permission loss, rebinding or its own unload. Physical touch,
keyboard accessibility and native host acceptance remain release gates.

## Verification and remaining work

`npm run package` passes 223 synthetic regressions, TypeScript checking, production
build and deterministic plugin-only packaging. The bridge cases use the real
Timeline/Sequence views and renderers with the existing Happy DOM host adapter.
They cover item/badge identity, aliases, re-render/rename, coordinate hit testing,
viewport clipping, selection preservation, collapsed groups, dirty inspector
navigation, empty results, ambiguous properties, explicit annotation, touch-drag
suppression, blur/visibility cleanup, exact lane identity, collapsed-lane
selection/navigation, equal labels, query replacement and disposal. Team Relay also has a source
interoperability script that bundles both plugins' real view/bridge/client/adapter
code against a synthetic Obsidian host, covering both view types and load orders,
including typed lane source capture and range selection/projection/navigation.
Range regressions additionally cover the shared coordinate corpus, exact decimal
projection, dense values, DST ambiguity, CE/BCE boundary conversion, mouse/touch/
keyboard selection, distant range focus/return, exact collapsed lanes, dense
Sequence restoration, bounded billion-year scales, stale axes, inspector drafts,
delayed viewport callbacks and no scheduling writes. Separate actual-service checks cover group
authorization and offline recovery in both saved-view types; these do not replace
the native interaction matrix.

These tests do not establish native Obsidian desktop/mobile acceptance, rendered
touch targets or battery behavior. No test vault or production plugin has been
updated for this bridge. The archive remains a development build at the existing
version; no new release tag or downloadable release has been published.

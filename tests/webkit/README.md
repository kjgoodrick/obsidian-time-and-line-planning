# Real WebKit / iPhone Simulator harness

This local page imports the production `SabidurianView`, renderers, interactions,
inspector, picker, scheduling, and undo implementation. It copies the production
`styles.css` unchanged. `host.ts` supplies the small Obsidian host surface the view
needs; it does not reproduce the timeline. Twelve synthetic cooking tasks exercise
short bars, exact minute boundaries, multi-day work, repeated labels, groups, and
multiple predecessors. No personal vault or Notion export is read or served.

## Run on this Mac

From the repository root, with the repository's dependencies already installed:

```sh
node tests/webkit/serve.mjs
```

Leave that server running. In another terminal:

```sh
node tests/webkit/launch.mjs
```

The launcher uses an already booted iPhone when available; otherwise it boots an
installed iPhone from the newest installed runtime. Set `WEBKIT_SIMULATOR_UDID`
to choose one explicitly. For an explicitly selected simulator:

```sh
WEBKIT_SIMULATOR_UDID=YOUR_SIMULATOR_UDID node tests/webkit/launch.mjs
```

The server listens only on `127.0.0.1:4177`. Set `WEBKIT_TEST_PORT` in both terminals
to change it. The launcher requires Xcode's accepted license, an installed iOS
runtime, and access to CoreSimulator. It never downloads a runtime, selects Xcode,
installs an app, or shuts down an existing device. Access to CoreSimulator depends on the permissions of the terminal or agent environment.

Open Xcode's Simulator / Device Hub to interact. The initial URL is
`http://127.0.0.1:4177/?run=1`. After the checks, the page reloads once to verify
browser persistence and returns to the original fixture. Results are written to
`dist/webkit/results.json`. Runtime errors go to `dist/webkit/events.jsonl`.
Restart the server after changing source; it builds once at startup.

## Interactive checks

- Header view selector switches Timeline, Oven, Chef, and Month fixtures.
- **Checks** shows the automated report. Reload `/?run=1` to rerun the suite.
- **◐** switches light/dark host tokens; **↺** resets all synthetic data.
- Use the production **Find task…** picker to open `Rest · Potato gratin`.
  Confirm `5:55 PM`–`6 PM`, unlock the editor, nudge five minutes, save, reopen,
  and Undo. The `datetime-local` fields invoke the real Safari native picker.
- Pan vertically and horizontally with an actual touch gesture. Confirm that
  scrolling does not reschedule tasks, including while the view is unlocked.
- Open **New task**, type a name with the software keyboard, then use the native
  **Done** control to dismiss it and reach the full form and Create action.
- Rotate using Simulator / Device Hub, then visit `/?run=1` again to rerun at the
  landscape viewport. `simctl` has no supported rotation command. Do not substitute
  resizing a desktop browser for this check.
- Check short task text and individual colored property badges in both themes,
  and verify the Hours selector remains compact.
- With a task boundary off-screen, use its circular row-edge control to reveal the
  start or end. The vertical row position and stored schedule must stay unchanged.
- In a locked inspector, open both a predecessor and a blocking task through their
  linked names. With a dirty draft, these links and Open note must retain the draft
  and explain that it needs saving or discarding first. Clean inspectors say
  **Close**; edited ones say **Discard changes**.

The harness starts locked and saves only synthetic data in Safari localStorage.
Reset restores the fixture. The full native Obsidian vault adapter is not present.

## Evidence and limits

The report records the real viewport, orientation, user agent, touch point count,
toolbar bounds, canvas size, and each assertion. The suite drives actual plugin
handlers to cover editor locking, exact times, nudges, Save/Undo, predecessor
selection, cross-group arrows, collapse/find, task creation, timezone behavior,
layout bounds, WebKit SVG text measurements, palette badges, and a real page reload.
It also checks locked predecessor/successor navigation, dirty-draft navigation
guards, Close/Discard labels, start/end edge-button hit testing and read-only
jumps, circular close-control geometry, and measured Hours text/chevron spacing.

The final November 2, 2026 iPhone 17 / iOS 26.5 run passed **16/16 checks in
portrait (402×714)** and **16/16 in landscape (874×338)**. Reports from that run are not included in this repository. New reports are generated under `dist/webkit/`.
Native interaction also confirmed that unlocked touch panning left the five-minute
Rest task at 5:55–6 PM with Undo still disabled; tapping its start field opened the
iOS date picker. Rotation preserved a staged +5-minute draft without saving it.

Automated `.click()` and dispatched touch events are synthetic. They cannot prove
trusted finger gestures or native keyboard behavior; those require the interactive
checks above. The page runs in real Simulator Safari/WebKit, not inside Obsidian.
It does not validate Obsidian plugin loading, vault writes, Bases integration,
sync, physical-device behavior, or the iOS app's WKWebView embedding and chrome.
The host's theme tokens approximate Obsidian's defaults. Screenshots therefore
include harness and Safari chrome, not the native Obsidian app.

The November 2, 2026 native keyboard check confirmed typing using an actual
on-screen key. Portrait retained a 409px visual viewport; the typed draft survived
rotation, and a native swipe revealed the full Create/Cancel row with the keyboard
still open. Tapping Cancel closed both the unsaved form and keyboard. In landscape,
Safari's address bar, keyboard accessory bar, and
software keyboard left only **62px** of visual viewport height. The host uses a
compact, scrollable modal in that case, with 44px available for the focused field.
Use the native **Done** control to restore the full form before saving. Reliable
footer access while this tiny landscape keyboard viewport remains open was not
established; Simulator drag gestures had enough inertia to overshoot the action
row. This is a standalone Safari-host limitation, not evidence about Obsidian's
native modal behavior. Host viewport telemetry in `events.jsonl` records geometry
without recording entered values.

Capture the actual simulator display without iPhone Mirroring:

```sh
xcrun simctl io YOUR_SIMULATOR_UDID screenshot dist/webkit/portrait.png
```

Copy `results.json` to a separate filename after each orientation to retain both
reports. Generated bundle, reports, and screenshots live under ignored `dist/`.
Stop the server with Ctrl+C. The launcher leaves the selected simulator running.

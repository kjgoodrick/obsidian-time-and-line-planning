import { draftRange, type RangeContext, type RangeKind, type RangeSelection, type RangeState } from './RangeProjection';
import { parseTimelineRange, timelineRangeLabel, type HistoricalPoint } from './TimelineRange';

/** Explicit annotation mode. Mouse drag, two clicks/taps, or keyboard endpoints.
 * Touch keeps native pan/pinch. No handler writes configuration or schedules. */
export function beginRangeInteraction(root: HTMLElement, read: () => RangeState | undefined, context: RangeContext,
  kind: RangeKind, precision: HistoricalPoint['precision'], select: (selection: RangeSelection) => void,
  stopped: () => void): (() => void) | undefined {
  const state = read(); if (!state || !context.current() || !context.kinds.includes(kind) || !['year', 'month', 'day'].includes(precision)) return;
  const cleanup: (() => void)[] = [], doc = root.ownerDocument;
  let live = true, first: number | undefined, cursor = (state.viewport.scrollLeft + state.viewport.clientWidth / 2), suppressClick = false;
  let pendingEnd: number | undefined, clickTimer: number | undefined;
  let gesture: { id: number; touch: boolean; x: number; y: number; position: number; dragged: boolean } | undefined;
  const pointers = new Set<number>();
  const status = doc.createElement('div'); status.className = 'sabidurian-range-selection-status';
  status.tabIndex = 0; status.setAttribute('role', 'group'); status.setAttribute('aria-label', 'Select a comment range');
  status.textContent = 'Choose two endpoints, or drag with a mouse. Arrow keys move; Enter chooses an endpoint. Escape cancels. Touch drag pans.';
  const feedback = doc.createElement('span'); feedback.setAttribute('role', 'status'); status.append(feedback); root.append(status);
  const overlay = doc.createElementNS('http://www.w3.org/2000/svg', 'g'); overlay.classList.add('sabidurian-comment-range-selection');
  overlay.setAttribute('pointer-events', 'none'); state.svg.append(overlay);
  const priorFocus = doc.activeElement as HTMLElement | null;
  const listen = (target: EventTarget, type: string, fn: EventListener) => {
    target.addEventListener(type, fn, true); cleanup.push(() => target.removeEventListener(type, fn, true));
  };
  const stop = () => {
    if (!live) return; live = false;
    if (clickTimer !== undefined) doc.defaultView?.clearTimeout(clickTimer);
    for (const dispose of cleanup) dispose(); overlay.remove(); status.remove();
    if (doc.activeElement === doc.body && priorFocus?.isConnected) priorFocus.focus({ preventScroll: true });
    try { stopped(); } catch { /* Always remove editing interception. */ }
  };
  const current = () => live && context.current();
  const local = (x: number) => {
    const box = state.svg.getBoundingClientRect();
    return Math.max(0, Math.min(state.axis.totalWidth, (x - box.left) * state.axis.totalWidth / box.width));
  };
  const paint = () => {
    overlay.replaceChildren();
    for (const x of first === undefined ? [cursor] : [first, cursor]) {
      const line = doc.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(x)); line.setAttribute('x2', String(x)); line.setAttribute('y1', '0');
      line.setAttribute('y2', String(state.svg.getAttribute('height') ?? '200'));
      overlay.append(line);
    }
    const point = state.axis.pixelToYear(cursor), preview = draftRange(point, point, state, kind, precision);
    feedback.textContent = (first === undefined ? ' Start: ' : ' End: ') + (preview.issue ?? (preview.draft ? timelineRangeLabel(parseTimelineRange(preview.draft)) : 'Enter an endpoint.'));
  };
  const choose = (position: number) => {
    if (!current() || !Number.isFinite(position)) { stop(); return; }
    if (first === undefined) { first = position; cursor = position; paint(); return; }
    const result = draftRange(state.axis.pixelToYear(first), state.axis.pixelToYear(position), state, kind, precision);
    const selection: RangeSelection = { ...result, context, current: () => context.current() };
    stop(); select(selection);
  };
  listen(root, 'pointerdown', event => {
    if (!(event.target instanceof (doc.defaultView?.Node ?? Node)) || !state.viewport.contains(event.target as Node)) return;
    const pointer = event as PointerEvent;
    if (pointer.button !== 0 && pointer.pointerType !== 'touch') return;
    event.stopImmediatePropagation(); pointers.add(pointer.pointerId);
    if (!current()) { stop(); return; }
    if (pointers.size !== 1) { gesture = undefined; suppressClick = true; return; }
    suppressClick = false;
    if (pointer.pointerType !== 'touch') event.preventDefault();
    const position = local(pointer.clientX);
    gesture = { id: pointer.pointerId, touch: pointer.pointerType === 'touch', x: pointer.clientX, y: pointer.clientY, position, dragged: false };
    cursor = position; paint();
  });
  listen(doc, 'pointermove', event => {
    const pointer = event as PointerEvent;
    if (!gesture || pointer.pointerId !== gesture.id) return;
    if (!current()) { stop(); return; }
    if (Math.hypot(pointer.clientX - gesture.x, pointer.clientY - gesture.y) > 8) gesture.dragged = true;
    if (gesture.touch) { if (gesture.dragged) suppressClick = true; return; }
    event.preventDefault(); event.stopImmediatePropagation();
    if (gesture.dragged && first === undefined) first = gesture.position;
    cursor = local(pointer.clientX); paint();
  });
  listen(doc, 'pointerup', event => {
    const pointer = event as PointerEvent; pointers.delete(pointer.pointerId);
    if (!gesture || pointer.pointerId !== gesture.id) return;
    const active = gesture; gesture = undefined;
    if (active.touch) { if (active.dragged) suppressClick = true; return; }
    event.preventDefault(); event.stopImmediatePropagation();
    if (active.dragged || Math.hypot(pointer.clientX - active.x, pointer.clientY - active.y) > 8) {
      first ??= active.position; pendingEnd = local(pointer.clientX);
      // Finish inside the compatibility click, so removing interception cannot
      // let that same gesture open/create/move a task. An outside release that
      // produces no click cancels instead of consuming an unrelated later click.
      clickTimer = doc.defaultView?.setTimeout(stop, 250);
    }
  });
  listen(doc, 'pointercancel', event => { pointers.delete((event as PointerEvent).pointerId); gesture = undefined; suppressClick = true; });
  listen(root, 'touchstart', event => { if (state.viewport.contains(event.target as Node)) event.stopImmediatePropagation(); });
  for (const type of ['mousedown', 'contextmenu']) listen(root, type, event => {
    if (state.viewport.contains(event.target as Node)) { event.preventDefault(); event.stopImmediatePropagation(); }
  });
  listen(doc, 'click', event => {
    if (pendingEnd !== undefined) {
      event.preventDefault(); event.stopImmediatePropagation();
      const end = pendingEnd; pendingEnd = undefined; choose(end); return;
    }
    if (!state.viewport.contains(event.target as Node)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (suppressClick) { suppressClick = false; return; }
    choose(local((event as MouseEvent).clientX));
  });
  listen(root, 'keydown', event => {
    const key = event as KeyboardEvent;
    if (key.key === 'Tab') return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (key.key === 'Escape') { stop(); return; }
    if (!current()) { stop(); return; }
    if (key.key === 'Enter' || key.key === ' ') { choose(cursor); return; }
    const direction = key.key === 'ArrowLeft' ? -1 : key.key === 'ArrowRight' ? 1 : 0;
    if (direction) {
      cursor = Math.max(0, Math.min(state.axis.totalWidth, cursor + direction * Math.max(1, state.viewport.clientWidth / 100) * (key.shiftKey ? 10 : 1)));
      if (cursor < state.viewport.scrollLeft || cursor > state.viewport.scrollLeft + state.viewport.clientWidth) state.viewport.scrollLeft = Math.max(0, cursor - state.viewport.clientWidth / 2);
      paint();
    }
  });
  listen(doc, 'keydown', event => { if ((event as KeyboardEvent).key === 'Escape') stop(); });
  listen(doc, 'visibilitychange', () => { if (doc.hidden) stop(); });
  if (doc.defaultView) listen(doc.defaultView, 'blur', event => { if (event.target === doc.defaultView) stop(); });
  paint(); status.focus({ preventScroll: true });
  return stop;
}

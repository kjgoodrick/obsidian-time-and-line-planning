import type { BasesEntryGroup, BasesPropertyId, BasesView, EventRef, TFile } from 'obsidian';
import { TaskInspector } from '../interaction/TaskInspector';
import { projectRange, rangeContext, rangeExtent, type RangeAxis, type RangeContext, type RangeKind, type RangeSelection, type RangeState } from './RangeProjection';
import { beginRangeInteraction } from './RangeInteraction';
import type { HistoricalPoint, TimelineRange } from './TimelineRange';
import { annotationPicker } from './AnnotationPicker';
import { presenceRange } from './RangePresence';
import { localMarkerSnapshots, type LocalMarkerSnapshot } from './LocalMarkers';
import type { SabidurianMarker } from '../settings';

declare module 'obsidian' {
  interface Workspace {
    on(name: 'time-and-line:collaboration-request', callback: (receive: unknown) => void, ctx?: unknown): EventRef;
    on(name: 'time-and-line:collaboration-ready', callback: (bridge: CollaborationBridge) => void, ctx?: unknown): EventRef;
  }
}

export interface TimelinePoint { clientX: number; clientY: number }
const validOffset = (offset: { x: number; y: number }) => offset && [offset.x, offset.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1);

/** Local host contract only. The consumer owns shared identities and permissions.
 * File paths, row positions and geometry never become durable comment IDs. */
export type TimelineTarget = { type: 'item'; file: TFile } |
  { type: 'cell'; file: TFile; property: BasesPropertyId };
export interface TimelineHandle {
  target: TimelineTarget;
  element: SVGElement;
  current(): boolean;
}
/** Source objects stay local. The consumer derives typed values and verifies
 * managed source witnesses; a label or a group key is never an authorization. */
export interface TimelineGroupHandle {
  target: { type: 'group'; group: BasesEntryGroup };
  element: SVGElement;
  band?(): { top: number; bottom: number } | undefined;
  current(): boolean;
}
export type TimelineSelectionHandle = TimelineHandle | TimelineGroupHandle;
export type TimelineReveal = 'revealed' | 'hidden' | 'property-hidden' | 'ambiguous' | 'busy' | 'unavailable';
export interface TimelineSurfacePort {
  owner: BasesView;
  root: HTMLElement;
  viewport(): HTMLElement | undefined;
  /** Rendered item/lane handles cannot outlive replacement query results. */
  targetsCurrent?(): boolean;
  handles(): TimelineHandle[];
  hit(node: Node, point?: TimelinePoint): TimelineHandle | undefined;
  selection(): TFile[];
  reveal(target: TimelineTarget): TimelineReveal;
  groups?(): TimelineGroupHandle[];
  revealGroup?(group: BasesEntryGroup): TimelineReveal;
  ranges?(): RangeState | undefined;
  /** Rebuild a temporary local axis; never modify saved view or task data. */
  focusRange?(range: TimelineRange, axis: RangeAxis): boolean;
  rangeScrolled?(): void;
  localMarkers?(): readonly SabidurianMarker[];
}

export interface TimelineRangeGeometry {
  startX: number; endX: number; top: number; bottom: number; discontinuous: boolean; current(): boolean;
}
export interface TimelineRangePresence {
  context: RangeContext; range: TimelineRange; group: BasesEntryGroup | null;
  offset: { x: number; y: number }; current(): boolean;
}

/** One lifetime per Bases view, retained across renderer replacement. */
export class TimelineSurface {
  readonly protocolVersion = 1;
  readonly capabilities = Object.freeze(['item', 'cell', 'selection', 'geometry', 'reveal', 'annotation', 'groups', 'ranges', 'range-presence', 'local-markers'] as const);
  private listeners = new Set<() => void>();
  private closed = false;
  private serial = 0;
  private stopAnnotation?: () => void;
  private stopRange?: () => void;
  private activeRange?: RangeContext;
  constructor(private port: TimelineSurfacePort) {}
  get owner(): BasesView { return this.port.owner; }
  get root(): HTMLElement { return this.port.root; }
  get revision(): number { return this.serial; }
  current(): boolean { return !this.closed && this.port.root.isConnected; }
  viewport(): HTMLElement | undefined {
    const viewport = this.current() ? this.port.viewport() : undefined;
    return viewport?.isConnected && this.root.contains(viewport) ? viewport : undefined;
  }
  private handle(value: TimelineHandle): TimelineHandle {
    const revision = this.serial;
    return Object.freeze({ ...value, current: () => this.current() && this.port.targetsCurrent?.() !== false && this.serial === revision && value.current() });
  }
  handles(): TimelineHandle[] { return this.current() && this.port.targetsCurrent?.() !== false ? this.port.handles().map(handle => this.handle(handle)) : []; }
  groups(): TimelineGroupHandle[] {
    if (!this.current() || this.port.targetsCurrent?.() === false) return [];
    const revision = this.serial, handles = this.port.groups?.() ?? [];
    return handles.length <= 256 ? handles.map(handle => ({ ...handle,
      current: () => this.current() && this.port.targetsCurrent?.() !== false && this.serial === revision && handle.current() })) : [];
  }
  groupHit(node: Node): TimelineGroupHandle | undefined {
    const matches = this.groups().filter(handle => handle.element.contains(node) && handle.current());
    return matches.length === 1 ? matches[0] : undefined;
  }
  revealGroup(group: BasesEntryGroup): TimelineReveal {
    if (!this.viewport() || this.port.targetsCurrent?.() === false) return 'unavailable';
    if (TaskInspector.hasDirty(this.root.ownerDocument)) return 'busy';
    return this.port.revealGroup?.(group) ?? 'unavailable';
  }
  hit(node: Node, point?: TimelinePoint): TimelineHandle | undefined {
    if (!this.current() || this.port.targetsCurrent?.() === false) return;
    const handle = this.port.hit(node, point); return handle ? this.handle(handle) : undefined;
  }
  selection(): TFile[] { return this.current() && this.port.targetsCurrent?.() !== false ? this.port.selection().slice(0, 256) : []; }
  geometry(target: TimelineTarget): DOMRect | undefined {
    const viewport = this.viewport(); if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    for (const handle of this.handles()) {
      const candidate = handle.target;
      if (candidate.file !== target.file || candidate.type !== target.type ||
        target.type === 'cell' && (candidate.type !== 'cell' || candidate.property !== target.property) || !handle.current()) continue;
      const rect = handle.element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.right > bounds.left && rect.left < bounds.right && rect.bottom > bounds.top && rect.top < bounds.bottom) return rect;
    }
  }
  reveal(target: TimelineTarget): TimelineReveal { return this.viewport() && this.port.targetsCurrent?.() !== false && (target?.type === 'item' || target?.type === 'cell') ? this.port.reveal(target) : 'unavailable'; }
  rangeContext(): RangeContext | undefined { return this.current() ? rangeContext(() => this.current() ? this.port.ranges?.() : undefined) : undefined; }
  localMarkers(): LocalMarkerSnapshot[] {
    return localMarkerSnapshots(() => this.port.localMarkers?.() ?? [], () => this.current());
  }
  /** Passive capture. No annotation gesture, task read, selection or saved write. */
  rangePresence(point?: TimelinePoint): TimelineRangePresence | undefined {
    try {
      if (this.port.targetsCurrent?.() === false) return;
      const context = this.rangeContext(), state = this.port.ranges?.(); if (!context || !state) return;
      const svg = state.svg.getBoundingClientRect(), view = state.viewport.getBoundingClientRect();
      const left = Math.max(svg.left, view.left), right = Math.min(svg.right, view.right), top = Math.max(svg.top, view.top), bottom = Math.min(svg.bottom, view.bottom);
      if (![left, right, top, bottom].every(Number.isFinite) || right <= left || bottom <= top) return;
      const x = point?.clientX ?? (left + right) / 2, y = point?.clientY ?? (top + bottom) / 2;
      if (![x, y].every(Number.isFinite) || x < left || x > right || y < top || y > bottom) return;
      const lanes = this.groups().filter(handle => {
        const band = handle.current() && handle.band?.(); return band && y >= band.top && y < band.bottom;
      });
      if (lanes.length > 1) return;
      const group = lanes[0]?.target.group ?? null;
      const local = (value: number) => Math.max(0, Math.min(state.axis.totalWidth, (value - svg.left) / svg.width * state.axis.totalWidth));
      const range = presenceRange(local(point ? x : left), local(point ? x : right), state); if (!range) return;
      const geometry = this.rangePresenceGeometry(range, context.axis, group ?? undefined); if (!geometry) return;
      const width = geometry.endX - geometry.startX, height = geometry.bottom - geometry.top;
      const offset = { x: width > 0 ? Math.max(0, Math.min(1, (x - geometry.startX) / width)) : 0.5, y: (y - geometry.top) / height };
      if (!validOffset(offset)) return;
      return { context, range, group, offset, current: () => context.current() && geometry.current() };
    } catch { return; }
  }
  rangePresenceGeometry(range: TimelineRange, axis: RangeAxis, group?: BasesEntryGroup): TimelineRangeGeometry | undefined {
    try {
      if (this.port.targetsCurrent?.() === false) return;
      const context = this.rangeContext(), state = this.port.ranges?.(); if (!context || !state) return;
      const projected = projectRange(range, state, axis), svg = state.svg.getBoundingClientRect(), view = state.viewport.getBoundingClientRect();
      // The axis is linear in SVG coordinates. A rotated/skewed/reflected canvas
      // cannot be represented by an axis-aligned bounding rectangle.
      const matrixValues = () => { const matrix = state.svg.getScreenCTM?.(); return matrix && [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]; };
      const matrix = matrixValues();
      if (typeof state.svg.getScreenCTM === 'function' && (!matrix || !matrix.every(Number.isFinite) || matrix[0] <= 0 || matrix[3] <= 0 || matrix[1] !== 0 || matrix[2] !== 0)) return;
      const lanes = group ? this.groups().filter(handle => handle.target.group === group && handle.current()) : [];
      if (group && lanes.length !== 1) return;
      const band = lanes[0]?.band?.(); if (group && !band) return;
      const top = band?.top ?? svg.top, bottom = band?.bottom ?? svg.bottom;
      const startX = svg.left + projected.start / state.axis.totalWidth * svg.width, endX = svg.left + projected.end / state.axis.totalWidth * svg.width;
      if (svg.width <= 0 || bottom <= top || projected.end < projected.start || projected.discontinuous && projected.end === projected.start || ![startX, endX, top, bottom].every(Number.isFinite)) return;
      const serial = this.serial;
      return { startX, endX, top, bottom, discontinuous: projected.discontinuous, current: () => {
        const now = state.svg.getBoundingClientRect(), viewport = state.viewport.getBoundingClientRect(), lane = lanes[0]?.band?.();
        return this.serial === serial && this.port.targetsCurrent?.() !== false && context.current() &&
          JSON.stringify(matrixValues()) === JSON.stringify(matrix) &&
          now.left === svg.left && now.top === svg.top && now.width === svg.width && now.height === svg.height &&
          viewport.left === view.left && viewport.top === view.top && viewport.width === view.width && viewport.height === view.height &&
          (!lanes[0] || lanes[0].current() && lane?.top === top && lane?.bottom === bottom);
      } };
    } catch { return; }
  }
  rangeGeometry(range: TimelineRange, axis: RangeAxis, group?: BasesEntryGroup): TimelineRangeGeometry | undefined {
    try {
      const context = this.rangeContext(), state = this.port.ranges?.(); if (!context || !state) return;
      const projected = projectRange(range, state, axis), svg = state.svg.getBoundingClientRect(), view = state.viewport.getBoundingClientRect();
      if (svg.width <= 0 || view.width <= 0 || view.height <= 0) return;
      const groups = group ? this.groups().filter(handle => handle.target.group === group && handle.current()) : [];
      if (group && groups.length !== 1) return;
      const band = groups[0]?.element.getBoundingClientRect();
      const top = band?.top ?? view.top + 4, bottom = band?.bottom ?? Math.min(view.bottom, top + 24);
      const startX = svg.left + projected.start / state.axis.totalWidth * svg.width, endX = svg.left + projected.end / state.axis.totalWidth * svg.width;
      if (![startX, endX, top, bottom].every(Number.isFinite)) return;
      return { startX, endX, top, bottom, discontinuous: projected.discontinuous,
        current: () => context.current() && (!groups[0] || groups[0].current()) };
    } catch { return; }
  }
  revealRange(range: TimelineRange, axis: RangeAxis, group?: BasesEntryGroup): TimelineReveal {
    return this.navigateRange(range, axis, group);
  }
  revealRangePresence(range: TimelineRange, axis: RangeAxis, offset: { x: number; y: number }, group?: BasesEntryGroup): TimelineReveal {
    if (!validOffset(offset) || this.port.targetsCurrent?.() === false) return 'unavailable';
    return this.navigateRange(range, axis, group, offset);
  }
  private navigateRange(range: TimelineRange, axis: RangeAxis, group?: BasesEntryGroup, offset?: { x: number; y: number }): TimelineReveal {
    if (TaskInspector.hasDirty(this.root.ownerDocument)) return 'busy';
    try {
      let context = this.rangeContext(), state = this.port.ranges?.(); if (!context || !state) return 'unavailable';
      // Validate semantic inputs even when dense projection has no such position.
      const extent = rangeExtent(range, state, axis);
      if (offset && (extent.end < extent.start || extent.discontinuous && extent.end === extent.start)) return 'unavailable';
      if (group) {
        const lanes = this.groups().filter(handle => handle.current() && handle.target.group === group);
        if (lanes.length !== 1) return lanes.length ? 'ambiguous' : 'unavailable';
      }
      let projected;
      try { projected = projectRange(range, state, axis); } catch { /* Dense values may not cover this interval. */ }
      if (!projected || Math.min(projected.start, projected.end) < 0 || Math.max(projected.start, projected.end) > state.axis.totalWidth) {
        if (!this.port.focusRange?.(range, axis)) return 'hidden';
        context = this.rangeContext(); state = this.port.ranges?.(); if (!context || !state) return 'unavailable';
        projected = projectRange(range, state, axis);
      }
      const geometry = offset ? this.rangePresenceGeometry(range, axis, group) : undefined;
      if (offset && !geometry) return 'unavailable';
      const start = Math.min(projected.start, projected.end);
      if (group && !offset) { const result = this.revealGroup(group); if (result !== 'revealed') return result; }
      if (!context.current() || TaskInspector.hasDirty(this.root.ownerDocument)) return 'busy';
      if (offset && geometry) {
        const view = state.viewport.getBoundingClientRect(), sx = view.width / state.viewport.clientWidth, sy = view.height / state.viewport.clientHeight;
        if (![sx, sy].every(value => Number.isFinite(value) && value > 0) || !geometry.current()) return 'unavailable';
        const x = geometry.startX + (geometry.endX - geometry.startX) * offset.x, y = geometry.top + (geometry.bottom - geometry.top) * offset.y;
        state.viewport.scrollLeft = Math.max(0, Math.min(state.viewport.scrollLeft + (x - view.left - view.width / 2) / sx, Math.max(0, state.viewport.scrollWidth - state.viewport.clientWidth)));
        state.viewport.scrollTop = Math.max(0, Math.min(state.viewport.scrollTop + (y - view.top - view.height / 2) / sy, Math.max(0, state.viewport.scrollHeight - state.viewport.clientHeight)));
      } else state.viewport.scrollLeft = Math.max(0, Math.min(start - Math.min(48, state.viewport.clientWidth / 4), Math.max(0, state.viewport.scrollWidth - state.viewport.clientWidth)));
      this.port.rangeScrolled?.();
      this.changed(); return 'revealed';
    } catch { return 'unavailable'; }
  }
  beginRange(kind: RangeKind, precision: HistoricalPoint['precision'], select: (selection: RangeSelection) => void, stopped: () => void): (() => void) | undefined {
    if (TaskInspector.hasDirty(this.root.ownerDocument)) return;
    this.stopAnnotation?.(); this.stopRange?.();
    const context = this.rangeContext(); if (!context) return;
    this.activeRange = context;
    const stop = beginRangeInteraction(this.root, () => this.current() && !TaskInspector.hasDirty(this.root.ownerDocument) ? this.port.ranges?.() : undefined,
      context, kind, precision, selection => { if (selection.current() && !TaskInspector.hasDirty(this.root.ownerDocument)) select(selection); },
      () => { this.stopRange = undefined; this.activeRange = undefined; stopped(); });
    this.stopRange = stop; if (!stop) this.activeRange = undefined; return stop;
  }
  /** Explicit one-shot selection mode. Touch keeps native pan/zoom; schedule
   * handlers never receive the gesture, compatibility mouse event or key. */
  beginAnnotation(select: (handle: TimelineSelectionHandle) => void, stopped: () => void): (() => void) | undefined {
    if (!this.current() || TaskInspector.hasDirty(this.root.ownerDocument)) return;
    this.stopAnnotation?.(); this.stopRange?.();
    const cleanup: (() => void)[] = []; let live = true, start: TimelinePoint | undefined, dragged = false;
    let picker: ReturnType<typeof annotationPicker> | undefined;
    const listen = (target: EventTarget, type: string, handler: EventListener) => {
      target.addEventListener(type, handler, true); cleanup.push(() => target.removeEventListener(type, handler, true));
    };
    const stop = () => {
      if (!live) return; live = false;
      for (const dispose of cleanup) dispose(); if (this.stopAnnotation === stop) this.stopAnnotation = undefined;
      picker?.dispose();
      try { stopped(); } catch { /* Consumers cannot retain editing interception. */ }
    };
    const choose = (handle: TimelineSelectionHandle) => {
      if (!live || !this.current() || TaskInspector.hasDirty(this.root.ownerDocument) || !handle.current()) return;
      stop(); select(handle);
    };
    this.stopAnnotation = stop;
    const viewport = this.viewport();
    picker = annotationPicker(this.root, () => [...this.handles(), ...this.groups()], choose, stop);
    cleanup.push(this.onChange(() => {
      if (!this.current() || this.viewport() !== viewport || !picker?.current()) { stop(); return; }
      picker.refresh();
    }));
    listen(this.root, 'pointerdown', event => {
      if (picker?.contains(event.target)) return;
      const pointer = event as PointerEvent; start = { clientX: pointer.clientX, clientY: pointer.clientY }; dragged = false;
      event.stopImmediatePropagation();
    });
    listen(this.root, 'pointermove', event => {
      const pointer = event as PointerEvent;
      if (start && Math.hypot(pointer.clientX - start.clientX, pointer.clientY - start.clientY) > 8) dragged = true;
    });
    listen(this.root, 'pointercancel', () => { dragged = true; });
    listen(this.root, 'touchstart', event => { if (!picker?.contains(event.target)) event.stopImmediatePropagation(); });
    for (const type of ['mousedown', 'contextmenu']) listen(this.root, type, event => {
      if (!picker?.contains(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); }
    });
    listen(this.root, 'click', event => {
      if (picker?.contains(event.target)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const pointer = event as MouseEvent;
      if (dragged || !this.current() || TaskInspector.hasDirty(this.root.ownerDocument)) return;
      const handle = event.target && (this.groupHit(event.target as Node) ?? this.hit(event.target as Node, pointer));
      if (!handle?.current()) return;
      choose(handle);
    });
    listen(this.root, 'keydown', event => {
      if ((event as KeyboardEvent).key === 'Tab') return;
      if (picker?.contains(event.target)) { picker.key(event as KeyboardEvent); event.stopImmediatePropagation(); return; }
      event.preventDefault(); event.stopImmediatePropagation();
      if ((event as KeyboardEvent).key === 'Escape') stop();
    });
    listen(this.root.ownerDocument, 'keydown', event => { if ((event as KeyboardEvent).key === 'Escape') stop(); });
    listen(this.root.ownerDocument, 'visibilitychange', () => { if (this.root.ownerDocument.hidden) stop(); });
    const window = this.root.ownerDocument.defaultView; if (window) listen(window, 'blur', event => { if (event.target === window) stop(); });
    picker.focus();
    return stop;
  }
  onChange(listener: () => void): () => void {
    if (this.closed) return () => {};
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  changed(): void {
    if (this.closed) return;
    if (this.activeRange && !this.activeRange.current()) this.stopRange?.();
    this.serial++;
    for (const listener of [...this.listeners]) { try { listener(); } catch { /* Optional consumers cannot interrupt rendering. */ } }
  }
  dispose(): void {
    if (this.closed) return;
    this.stopAnnotation?.();
    this.stopRange?.();
    this.closed = true; this.serial++;
    for (const listener of [...this.listeners]) { try { listener(); } catch { /* Closing remains possible. */ } }
    this.listeners.clear();
  }
}

/** Discoverable through workspace events in either plugin load order. */
export class CollaborationBridge {
  readonly protocolVersion = 1;
  readonly viewTypes = Object.freeze(['sabidurian-timeline', 'sabidurian-sequence'] as const);
  private surfaces = new Set<TimelineSurface>();
  private listeners = new Set<() => void>();
  private closed = false;
  get available(): boolean { return !this.closed; }
  canNavigate(document: Document): boolean { return !this.closed && !TaskInspector.hasDirty(document); }
  getSurfaces(): TimelineSurface[] { return this.closed ? [] : [...this.surfaces].filter(surface => surface.current()); }
  register(surface: TimelineSurface): () => void {
    if (this.closed) { surface.dispose(); return () => {}; }
    this.surfaces.add(surface); const stop = surface.onChange(() => this.notify()); this.notify();
    return () => { stop(); surface.dispose(); if (this.surfaces.delete(surface)) this.notify(); };
  }
  onChange(listener: () => void): () => void {
    if (this.closed) return () => {};
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  private notify(): void { for (const listener of [...this.listeners]) { try { listener(); } catch { /* Independent consumers. */ } } }
  dispose(): void {
    if (this.closed) return;
    this.closed = true; for (const surface of this.surfaces) surface.dispose();
    this.surfaces.clear(); this.notify(); this.listeners.clear();
  }
}

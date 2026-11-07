import type { BasesEntryGroup, BasesPropertyId, BasesView, EventRef, TFile } from 'obsidian';
import { TaskInspector } from '../interaction/TaskInspector';
import { projectRange, rangeContext, type RangeAxis, type RangeContext, type RangeKind, type RangeSelection, type RangeState } from './RangeProjection';
import { beginRangeInteraction } from './RangeInteraction';
import type { HistoricalPoint, TimelineRange } from './TimelineRange';

declare module 'obsidian' {
  interface Workspace {
    on(name: 'time-and-line:collaboration-request', callback: (receive: unknown) => void, ctx?: unknown): EventRef;
    on(name: 'time-and-line:collaboration-ready', callback: (bridge: CollaborationBridge) => void, ctx?: unknown): EventRef;
  }
}

export interface TimelinePoint { clientX: number; clientY: number }

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
  current(): boolean;
}
export type TimelineSelectionHandle = TimelineHandle | TimelineGroupHandle;
export type TimelineReveal = 'revealed' | 'hidden' | 'property-hidden' | 'ambiguous' | 'busy' | 'unavailable';
export interface TimelineSurfacePort {
  owner: BasesView;
  root: HTMLElement;
  viewport(): HTMLElement | undefined;
  handles(): TimelineHandle[];
  hit(node: Node, point?: TimelinePoint): TimelineHandle | undefined;
  selection(): TFile[];
  reveal(target: TimelineTarget): TimelineReveal;
  groups?(): TimelineGroupHandle[];
  revealGroup?(group: BasesEntryGroup): TimelineReveal;
  ranges?(): RangeState | undefined;
}

export interface TimelineRangeGeometry {
  startX: number; endX: number; top: number; bottom: number; discontinuous: boolean; current(): boolean;
}

/** One lifetime per Bases view, retained across renderer replacement. */
export class TimelineSurface {
  readonly protocolVersion = 1;
  readonly capabilities = Object.freeze(['item', 'cell', 'selection', 'geometry', 'reveal', 'annotation', 'groups', 'ranges'] as const);
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
    return Object.freeze({ ...value, current: () => this.current() && this.serial === revision && value.current() });
  }
  handles(): TimelineHandle[] { return this.current() ? this.port.handles().map(handle => this.handle(handle)) : []; }
  groups(): TimelineGroupHandle[] {
    if (!this.current()) return [];
    const revision = this.serial, handles = this.port.groups?.() ?? [];
    return handles.length <= 256 ? handles.map(handle => ({ ...handle,
      current: () => this.current() && this.serial === revision && handle.current() })) : [];
  }
  groupHit(node: Node): TimelineGroupHandle | undefined {
    const matches = this.groups().filter(handle => handle.element.contains(node) && handle.current());
    return matches.length === 1 ? matches[0] : undefined;
  }
  revealGroup(group: BasesEntryGroup): TimelineReveal {
    if (!this.viewport()) return 'unavailable';
    if (TaskInspector.hasDirty(this.root.ownerDocument)) return 'busy';
    return this.port.revealGroup?.(group) ?? 'unavailable';
  }
  hit(node: Node, point?: TimelinePoint): TimelineHandle | undefined {
    if (!this.current()) return;
    const handle = this.port.hit(node, point); return handle ? this.handle(handle) : undefined;
  }
  selection(): TFile[] { return this.current() ? this.port.selection().slice(0, 256) : []; }
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
  reveal(target: TimelineTarget): TimelineReveal { return this.viewport() && (target?.type === 'item' || target?.type === 'cell') ? this.port.reveal(target) : 'unavailable'; }
  rangeContext(): RangeContext | undefined { return this.current() ? rangeContext(() => this.current() ? this.port.ranges?.() : undefined) : undefined; }
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
    if (TaskInspector.hasDirty(this.root.ownerDocument)) return 'busy';
    try {
      const context = this.rangeContext(), state = this.port.ranges?.(); if (!context || !state) return 'unavailable';
      const projected = projectRange(range, state, axis), start = Math.min(projected.start, projected.end), end = Math.max(projected.start, projected.end);
      if (end < 0 || start > state.axis.totalWidth) return 'hidden';
      if (group) { const result = this.revealGroup(group); if (result !== 'revealed') return result; }
      if (!context.current() || TaskInspector.hasDirty(this.root.ownerDocument)) return 'busy';
      state.viewport.scrollLeft = Math.max(0, Math.min(start - Math.min(48, state.viewport.clientWidth / 4), Math.max(0, state.viewport.scrollWidth - state.viewport.clientWidth)));
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
    const listen = (target: EventTarget, type: string, handler: EventListener) => {
      target.addEventListener(type, handler, true); cleanup.push(() => target.removeEventListener(type, handler, true));
    };
    const stop = () => {
      if (!live) return; live = false;
      for (const dispose of cleanup) dispose(); if (this.stopAnnotation === stop) this.stopAnnotation = undefined;
      try { stopped(); } catch { /* Consumers cannot retain editing interception. */ }
    };
    this.stopAnnotation = stop;
    listen(this.root, 'pointerdown', event => {
      const pointer = event as PointerEvent; start = { clientX: pointer.clientX, clientY: pointer.clientY }; dragged = false;
      event.stopImmediatePropagation();
    });
    listen(this.root, 'pointermove', event => {
      const pointer = event as PointerEvent;
      if (start && Math.hypot(pointer.clientX - start.clientX, pointer.clientY - start.clientY) > 8) dragged = true;
    });
    listen(this.root, 'pointercancel', () => { dragged = true; });
    listen(this.root, 'touchstart', event => { event.stopImmediatePropagation(); });
    for (const type of ['mousedown', 'contextmenu']) listen(this.root, type, event => { event.preventDefault(); event.stopImmediatePropagation(); });
    listen(this.root, 'click', event => {
      event.preventDefault(); event.stopImmediatePropagation();
      const pointer = event as MouseEvent;
      if (dragged || !this.current() || TaskInspector.hasDirty(this.root.ownerDocument)) return;
      const handle = event.target && (this.groupHit(event.target as Node) ?? this.hit(event.target as Node, pointer));
      if (!handle?.current()) return;
      stop(); select(handle);
    });
    listen(this.root, 'keydown', event => {
      if ((event as KeyboardEvent).key === 'Tab') return;
      event.preventDefault(); event.stopImmediatePropagation();
      if ((event as KeyboardEvent).key === 'Escape') stop();
    });
    listen(this.root.ownerDocument, 'keydown', event => { if ((event as KeyboardEvent).key === 'Escape') stop(); });
    listen(this.root.ownerDocument, 'visibilitychange', () => { if (this.root.ownerDocument.hidden) stop(); });
    const window = this.root.ownerDocument.defaultView; if (window) listen(window, 'blur', event => { if (event.target === window) stop(); });
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

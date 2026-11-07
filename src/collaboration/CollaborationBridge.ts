import type { BasesPropertyId, BasesView, EventRef, TFile } from 'obsidian';

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
export type TimelineReveal = 'revealed' | 'hidden' | 'property-hidden' | 'ambiguous' | 'busy' | 'unavailable';
export interface TimelineSurfacePort {
  owner: BasesView;
  root: HTMLElement;
  viewport(): HTMLElement | undefined;
  handles(): TimelineHandle[];
  hit(node: Node, point?: TimelinePoint): TimelineHandle | undefined;
  selection(): TFile[];
  reveal(target: TimelineTarget): TimelineReveal;
}

/** One lifetime per Bases view, retained across renderer replacement. */
export class TimelineSurface {
  readonly protocolVersion = 1;
  readonly capabilities = Object.freeze(['item', 'cell', 'selection', 'geometry', 'reveal'] as const);
  private listeners = new Set<() => void>();
  private closed = false;
  private serial = 0;
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
  onChange(listener: () => void): () => void {
    if (this.closed) return () => {};
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  changed(): void {
    if (this.closed) return;
    this.serial++;
    for (const listener of [...this.listeners]) { try { listener(); } catch { /* Optional consumers cannot interrupt rendering. */ } }
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true; this.serial++;
    for (const listener of [...this.listeners]) { try { listener(); } catch { /* Closing remains possible. */ } }
    this.listeners.clear();
  }
}

/** Discoverable through workspace events in either plugin load order. */
export class CollaborationBridge {
  readonly protocolVersion = 1;
  private surfaces = new Set<TimelineSurface>();
  private listeners = new Set<() => void>();
  private closed = false;
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

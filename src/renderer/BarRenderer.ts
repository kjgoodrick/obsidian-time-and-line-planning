import { fullLabel, labelWidth } from '../model/labels';
import { prependTaskImage } from '../model/taskIcons';
/**
 * BarRenderer — Renders individual bars and point markers as SVG elements.
 * Handles labels, hover tooltips, click-to-open, and Obsidian page preview.
 */

import type { App, TFile } from 'obsidian';
import type { SabidurianEntry } from '../model/SabidurianEntry';
import { BAR_HEIGHT } from '../model/LayoutEngine';
import { formatSabidurianDate, formatDateRange } from '../utils/dateUtils';
import type { NumericAxis } from '../scale/NumericAxis';
import { getPropertyTone, type PropertyColors } from '../utils/colorUtils';
import type { BasesPropertyId } from 'obsidian';
import type { TimelineHandle, TimelineTarget, TimelinePoint } from '../collaboration/CollaborationBridge';

const SVG_NS = 'http://www.w3.org/2000/svg';
const POINT_RADIUS = 7;
const LABEL_PADDING = 8;
const MIN_LABEL_WIDTH = 40; // Don't render label inside bar if narrower than this

export class BarRenderer {
  private app: App;
  private svg: SVGSVGElement;
  private barGroup: SVGGElement;
  private tooltipEl: HTMLElement | null = null;
  private defsEl: SVGDefsElement | null = null;
  private targetNodes = new Map<SVGElement, TimelineHandle>();
  private propertyNodes = new Set<SVGElement>();
  private renderRevision = 0;
  private displayPropertyIds = new Map<string, BasesPropertyId | null>();

  invalidateCollaboration(): void { this.renderRevision++; this.targetNodes.clear(); this.propertyNodes.clear(); }

  collaborationHandles(): TimelineHandle[] { return this.targetNodes.size <= 2048 ? [...this.targetNodes.values()].filter(handle => handle.current()) : []; }
  collaborationHit(node: Node, point?: TimelinePoint): TimelineHandle | undefined {
    for (let current: Node | null = node, depth = 0; current && current !== this.svg && depth < 32; current = current.parentNode, depth++) {
      if (this.propertyNodes.has(current as SVGElement) && !this.targetNodes.has(current as SVGElement)) return;
      const handle = this.targetNodes.get(current as SVGElement);
      if (handle?.current()) {
        // The transparent task hit area covers badges. Inspect only this bar's
        // registered property nodes when a click supplies viewport coordinates.
        if (handle.target.type === 'item' && point && Number.isFinite(point.clientX) && Number.isFinite(point.clientY)) {
          for (const element of this.propertyNodes) {
            if (!handle.element.contains(element) || !element.isConnected) continue;
            const rect = element.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && point.clientX >= rect.left && point.clientX < rect.right && point.clientY >= rect.top && point.clientY < rect.bottom) {
              const candidate = this.targetNodes.get(element); return candidate?.current() ? candidate : undefined;
            }
          }
        }
        return handle;
      }
    }
  }
  private bindTarget(element: SVGElement, target: TimelineTarget): void {
    const revision = this.renderRevision;
    this.targetNodes.set(element, Object.freeze({ target: Object.freeze({ ...target }), element,
      current: () => this.renderRevision === revision && element.isConnected && this.svg.contains(element) }));
  }

  /** When true, tooltip shows ordinal position instead of dates. */
  sequenceMode = false;
  inspect: ((entry: SabidurianEntry) => void) | null = null;
  denseToSparse: number[] | null = null;
  propertyColors: PropertyColors = {};

  constructor(svg: SVGSVGElement, app: App, tooltipParent: HTMLElement) {
    this.app = app;
    this.svg = svg;

    this.barGroup = document.createElementNS(SVG_NS, 'g');
    this.barGroup.classList.add('sabidurian-bars-group');
    svg.appendChild(this.barGroup);

    // Shared tooltip element
    this.tooltipEl = svg.ownerDocument.body.createDiv({ cls: 'sabidurian-tooltip' });
    this.tooltipEl.style.display = 'none';
  }

  /** Optional axis reference for computing fuzzy date pixel positions. */
  private axis: NumericAxis | null = null;

  /** Property keys to display as badges on bars. Max 3. */
  private displayProps: string[] = [];
  /** Minimum bar width (px) to show badges. */
  private badgeMinWidth = 80;
  /** Whether property badges are globally enabled. */
  private badgesEnabled = true;

  /** Tag to focus on — entries without this tag are visually greyed out. */
  private focusTag: string | null = null;

  /** Set the axis for fuzzy date rendering. Call before render(). */
  setAxis(axis: NumericAxis): void {
    this.axis = axis;
  }

  /** Set date property names to exclude from tooltips. */
  setDatePropNames(startProp: string, endProp: string): void {
    this.tooltipExcludeExtra = new Set([startProp, endProp]);
  }

  /** Set the focus tag. Entries without this tag are greyed out. */
  setFocusTag(tag: string | null): void {
    this.focusTag = tag;
  }

  /** Check whether an entry's tags contain the focus tag. */
  private entryHasFocusTag(entry: SabidurianEntry): boolean {
    if (!this.focusTag) return true; // No focus tag set — everything is focused
    const needle = this.focusTag.toLowerCase();
    // Check all property values whose key looks like "tags" or "tag"
    for (const [key, val] of Object.entries(entry.properties)) {
      if (key.toLowerCase().includes('tag') && val) {
        // Tags arrive as comma-separated string, e.g. "project,work,v2"
        const tags = val.split(',').map(t => t.trim().replace(/^#/, '').toLowerCase());
        if (tags.includes(needle)) return true;
      }
    }
    return false;
  }

  /** Configure property badge display. Call before render(). */
  setDisplayProps(props: string[], minWidth: number, enabled: boolean): void {
    this.displayPropertyIds.clear();
    this.displayProps = props.filter(Boolean).slice(0, 3).map(property => {
      const id = /^(?:note|file|formula)\./.test(property) ? property : 'note.' + property;
      const key = id.replace(/^note\./, '');
      const previous = this.displayPropertyIds.get(key);
      this.displayPropertyIds.set(key, previous === undefined || previous === id ? id as BasesPropertyId : null); return key;
    });
    this.badgeMinWidth = minWidth;
    this.badgesEnabled = enabled;
  }

  render(entries: SabidurianEntry[], getRowY: (row: number) => number): void {
    this.invalidateCollaboration();
    // Clear previous bars
    while (this.barGroup.firstChild) {
      this.barGroup.removeChild(this.barGroup.firstChild);
    }

    for (const entry of entries) {
      const y = getRowY(entry.row);

      if (entry.isPoint) {
        this.renderPointMarker(entry, y);
      } else {
        this.renderBar(entry, y);
      }
    }
  }

  private renderBar(entry: SabidurianEntry, y: number): void {
    const group = document.createElementNS(SVG_NS, 'g');
    group.classList.add('sabidurian-bar-group');
    if (this.focusTag && !this.entryHasFocusTag(entry)) {
      group.classList.add('sabidurian-bar-unfocused');
    }
    group.dataset.filePath = entry.file.path;
    this.bindTarget(group, { type: 'item', file: entry.file });

    // ── Fuzzy/uncertainty extensions (rendered BEFORE main bar) ──
    if (this.axis) {
      if (entry.earliestStartYear != null && entry.earliestStartYear < entry.startYear) {
        const earlyX = this.axis.yearToPixel(entry.earliestStartYear);
        const earlyWidth = entry.x - earlyX;
        if (earlyWidth > 0) {
          const uncertainLeft = document.createElementNS(SVG_NS, 'rect');
          uncertainLeft.setAttribute('x', `${earlyX}`);
          uncertainLeft.setAttribute('y', `${y}`);
          uncertainLeft.setAttribute('width', `${earlyWidth}`);
          uncertainLeft.setAttribute('height', `${BAR_HEIGHT}`);
          uncertainLeft.setAttribute('rx', '4');
          uncertainLeft.classList.add('sabidurian-uncertain-range');
          uncertainLeft.style.fill = entry.color;
          group.appendChild(uncertainLeft);
        }
      }

      if (entry.latestEndYear != null && entry.latestEndYear > entry.endYear) {
        const barRight = entry.x + entry.width;
        const lateX = this.axis.yearToPixel(entry.latestEndYear);
        const lateWidth = lateX - barRight;
        if (lateWidth > 0) {
          const uncertainRight = document.createElementNS(SVG_NS, 'rect');
          uncertainRight.setAttribute('x', `${barRight}`);
          uncertainRight.setAttribute('y', `${y}`);
          uncertainRight.setAttribute('width', `${lateWidth}`);
          uncertainRight.setAttribute('height', `${BAR_HEIGHT}`);
          uncertainRight.setAttribute('rx', '4');
          uncertainRight.classList.add('sabidurian-uncertain-range');
          uncertainRight.style.fill = entry.color;
          group.appendChild(uncertainRight);
        }
      }
    }

    // Bar rect
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', `${entry.x}`);
    rect.setAttribute('y', `${y}`);
    rect.setAttribute('width', `${entry.width}`);
    rect.setAttribute('height', `${BAR_HEIGHT}`);
    rect.setAttribute('rx', '4');
    rect.setAttribute('ry', '4');
    rect.style.fill = entry.color;
    rect.classList.add('sabidurian-bar');
    if (entry.fuzzyOnly) {
      group.classList.add('sabidurian-bar-fuzzy-only');
    }
    group.appendChild(rect);

    // Resize grip indicators (visible on hover)
    if (entry.width > 30) {
      const gripLeft = document.createElementNS(SVG_NS, 'g');
      gripLeft.classList.add('sabidurian-resize-grip', 'sabidurian-resize-grip-left');
      for (let i = -2; i <= 2; i += 2) {
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', `${entry.x + 4 + i}`);
        line.setAttribute('x2', `${entry.x + 4 + i}`);
        line.setAttribute('y1', `${y + 6}`);
        line.setAttribute('y2', `${y + BAR_HEIGHT - 6}`);
        gripLeft.appendChild(line);
      }
      group.appendChild(gripLeft);

      const gripRight = document.createElementNS(SVG_NS, 'g');
      gripRight.classList.add('sabidurian-resize-grip', 'sabidurian-resize-grip-right');
      for (let i = -2; i <= 2; i += 2) {
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', `${entry.x + entry.width - 4 + i}`);
        line.setAttribute('x2', `${entry.x + entry.width - 4 + i}`);
        line.setAttribute('y1', `${y + 6}`);
        line.setAttribute('y2', `${y + BAR_HEIGHT - 6}`);
        gripRight.appendChild(line);
      }
      group.appendChild(gripRight);
    }

    // Attach before measuring SVG text: detached text has no layout in WebKit.
    this.barGroup.appendChild(group);
    const displayLabel = entry.displayLabel ?? fullLabel(entry.label, entry.properties, this.badgesEnabled ? this.displayProps : []);
    const text = document.createElementNS(SVG_NS, 'text');
    text.classList.add('sabidurian-bar-label', 'sabidurian-bar-label-flow');
    let labelX = entry.x + Math.min(LABEL_PADDING, entry.width / 2);
    labelX += this.renderTaskImage(group, entry, labelX, y + BAR_HEIGHT / 2);
    text.setAttribute('x', `${labelX}`);
    text.setAttribute('y', `${y + BAR_HEIGHT / 2 + 4}`);
    const props = this.badgesEnabled ? this.displayProps.filter(key => entry.properties[key] && entry.properties[key] !== 'null') : [];
    // Older/sequence callers may provide a pre-composed label without property configuration.
    text.textContent = props.length ? entry.label : (this.displayProps.length ? entry.label : displayLabel);
    group.appendChild(text);
    const measure = (el: SVGTextElement) => el.getComputedTextLength?.() || Math.max(0, labelWidth(el.textContent ?? '') - 20);
    let labelRight = labelX + measure(text);
    for (const property of props) {
      const value = entry.properties[property];
      const badge = document.createElementNS(SVG_NS, 'g');
      badge.classList.add('sabidurian-property-badge');
      badge.dataset.property = property;
      this.propertyNodes.add(badge);
      const propertyId = this.displayPropertyIds.get(property);
      if (propertyId) this.bindTarget(badge, { type: 'cell', file: entry.file, property: propertyId });
      badge.dataset.sabidurianColor = getPropertyTone(property, value, this.propertyColors) ?? 'gray';
      const bg = document.createElementNS(SVG_NS, 'rect');
      bg.setAttribute('x', `${labelRight + 7}`);
      bg.setAttribute('y', `${y + 4}`);
      bg.setAttribute('height', `${BAR_HEIGHT - 8}`);
      bg.setAttribute('rx', '4');
      const valueText = document.createElementNS(SVG_NS, 'text');
      valueText.setAttribute('x', `${labelRight + 13}`);
      valueText.setAttribute('y', `${y + BAR_HEIGHT / 2 + 4}`);
      valueText.textContent = value;
      badge.append(bg, valueText); group.appendChild(badge);
      const width = measure(valueText) + 12;
      bg.setAttribute('width', `${width}`);
      labelRight += 7 + width;
    }
    // Larger selection area is separate from the real bar and its dates.
    const hit = document.createElementNS(SVG_NS, 'rect');
    hit.setAttribute('x', `${entry.x}`); hit.setAttribute('y', `${y - 6}`);
    hit.setAttribute('width', `${Math.max(44, entry.width, labelRight - entry.x + 8)}`);
    hit.setAttribute('height', '40'); hit.setAttribute('fill', 'transparent');
    hit.classList.add('sabidurian-task-hit'); group.appendChild(hit);

    // ── Per-note lock indicator (Lucide-style SVG lock) ──
    if (entry.locked) {
      group.classList.add('sabidurian-bar-locked');

      const iconSize = 12;
      const iconX = entry.isPoint
        ? entry.x + POINT_RADIUS + 2
        : entry.x + entry.width - iconSize - 3;
      const iconY = y + 2;

      const lockG = document.createElementNS(SVG_NS, 'g');
      lockG.classList.add('sabidurian-lock-indicator');
      lockG.setAttribute('transform', `translate(${iconX}, ${iconY}) scale(${iconSize / 24})`);

      // Lucide lock path: shackle (arc) + body (rect)
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', 'M7 11V7a5 5 0 0 1 10 0v4M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '2.5');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      lockG.appendChild(path);
      group.appendChild(lockG);
    }

    // ── Ongoing event treatment: gradient fade + dashed class ──
    if (entry.isOngoing) {
      group.classList.add('sabidurian-bar-ongoing');

      // Gradient overlay on right 20% of bar
      const gradientId = `ongoing-fade-${entry.file.path.replace(/[^a-zA-Z0-9]/g, '-')}`;
      const defs = this.ensureDefs();
      const gradient = document.createElementNS(SVG_NS, 'linearGradient');
      gradient.id = gradientId;
      gradient.setAttribute('x1', '0.8');
      gradient.setAttribute('x2', '1');
      gradient.setAttribute('y1', '0');
      gradient.setAttribute('y2', '0');

      const stop1 = document.createElementNS(SVG_NS, 'stop');
      stop1.setAttribute('offset', '0%');
      stop1.setAttribute('stop-color', 'white');
      stop1.setAttribute('stop-opacity', '0');

      const stop2 = document.createElementNS(SVG_NS, 'stop');
      stop2.setAttribute('offset', '100%');
      stop2.setAttribute('stop-color', 'white');
      stop2.setAttribute('stop-opacity', '0.6');

      gradient.append(stop1, stop2);
      defs.appendChild(gradient);

      const fadeRect = document.createElementNS(SVG_NS, 'rect');
      fadeRect.setAttribute('x', `${entry.x}`);
      fadeRect.setAttribute('y', `${y}`);
      fadeRect.setAttribute('width', `${entry.width}`);
      fadeRect.setAttribute('height', `${BAR_HEIGHT}`);
      fadeRect.setAttribute('rx', '4');
      fadeRect.setAttribute('fill', `url(#${gradientId})`);
      fadeRect.classList.add('sabidurian-ongoing-fade');
      group.appendChild(fadeRect);
    }

    // Interactions
    this.addInteractions(group, entry);
    this.barGroup.appendChild(group);
  }

  /** Get or create a shared <defs> element in the SVG. */
  private ensureDefs(): SVGDefsElement {
    if (this.defsEl) return this.defsEl;
    let defs = this.svg.querySelector('defs') as SVGDefsElement | null;
    if (!defs) {
      defs = document.createElementNS(SVG_NS, 'defs');
      this.svg.insertBefore(defs, this.svg.firstChild);
    }
    this.defsEl = defs;
    return defs;
  }

  private renderPointMarker(entry: SabidurianEntry, y: number): void {
    const group = document.createElementNS(SVG_NS, 'g');
    group.classList.add('sabidurian-bar-group');
    if (this.focusTag && !this.entryHasFocusTag(entry)) {
      group.classList.add('sabidurian-bar-unfocused');
    }
    group.dataset.filePath = entry.file.path;
    this.bindTarget(group, { type: 'item', file: entry.file });

    const cx = entry.x;
    const cy = y + BAR_HEIGHT / 2;
    const r = POINT_RADIUS;

    // Diamond shape
    const diamond = document.createElementNS(SVG_NS, 'polygon');
    diamond.setAttribute('points',
      `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`);
    diamond.style.fill = entry.color;
    diamond.classList.add('sabidurian-point-marker');
    group.appendChild(diamond);

    // Label to the right
    const text = document.createElementNS(SVG_NS, 'text');
    const labelX = cx + r + 6;
    text.setAttribute('x', `${labelX + this.renderTaskImage(group, entry, labelX, cy)}`);
    text.setAttribute('y', `${cy + 4}`);
    text.classList.add('sabidurian-bar-label', 'sabidurian-bar-label-outside');
    text.textContent = entry.label;
    group.appendChild(text);

    this.addInteractions(group, entry);
    this.barGroup.appendChild(group);
  }

  private renderTaskImage(group: SVGGElement, entry: SabidurianEntry, x: number, centerY: number): number {
    if (entry.icon?.kind !== 'image') return 0;
    const image = this.svg.ownerDocument.createElementNS(SVG_NS, 'image');
    image.classList.add('sabidurian-task-image'); image.setAttribute('href', entry.icon.url);
    image.setAttribute('x', String(x)); image.setAttribute('y', String(centerY - 8));
    image.setAttribute('width', '16'); image.setAttribute('height', '16');
    image.setAttribute('aria-hidden', 'true'); group.append(image);
    return 20;
  }

  private addInteractions(group: SVGGElement, entry: SabidurianEntry): void {
    group.setAttribute('role', 'button');
    group.setAttribute('tabindex', '0');
    group.setAttribute('aria-label', `${entry.displayLabel ?? entry.label}, ${this.sequenceMode ? this.sequenceLabel(entry) : formatSabidurianDate(entry.start)}`);
    group.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); e.stopPropagation();
        if (this.inspect) this.inspect(entry); else void this.app.workspace.getLeaf(false).openFile(entry.file);
      }
    });
    // Click to inspect, with an explicit Open note action inside.
    group.addEventListener('click', (e) => {
      e.preventDefault();
      if (this.inspect) { this.hideTooltip(); this.inspect(entry); return; }
      const leaf = this.app.workspace.getLeaf(false);
      leaf.openFile(entry.file);
    });

    // Hover: show tooltip
    group.addEventListener('mouseenter', (e) => {
      this.showTooltip(entry, e);
      group.classList.add('sabidurian-bar-hover');
    });
    group.addEventListener('mouseleave', () => {
      this.hideTooltip();
      group.classList.remove('sabidurian-bar-hover');
    });
    group.addEventListener('mousemove', (e) => {
      this.moveTooltip(e);
    });

    // Trigger Obsidian page preview on hover
    group.addEventListener('mouseover', (e) => {
      if (this.inspect) return;
      this.app.workspace.trigger('hover-link', {
        event: e,
        source: 'sabidurian-timeline',
        hoverParent: group,
        targetEl: group,
        linktext: entry.file.path,
        sourcePath: entry.file.path,
      });
    });

    group.style.cursor = 'pointer';
  }

  /** Property key prefixes to exclude from tooltip (system/file metadata). */
  private static readonly TOOLTIP_EXCLUDE_BASE = new Set([
    'file name', 'file base name', 'file full name', 'file path',
    'file extension', 'folder', 'file size',
    'created time', 'modified time',
  ]);

  /** Additional property keys to exclude (configured date property names). */
  private tooltipExcludeExtra: Set<string> = new Set(['start-date', 'end-date']);

  private sequenceLabel(entry: SabidurianEntry): string {
    const d2s = this.denseToSparse, rawStart = Math.round(entry.startYear), rawEnd = Math.round(entry.endYear) - 1;
    const start = entry.sequencePosition?.start ?? (d2s ? (d2s[rawStart - 1] ?? rawStart) : rawStart);
    const end = entry.sequencePosition?.end ?? (d2s ? (d2s[rawEnd - 1] ?? rawEnd) : rawEnd);
    return end > start ? `Position ${start} → ${end}` : `Position ${start}`;
  }

  /** Build tooltip content using safe DOM methods (no innerHTML). */
  private showTooltip(entry: SabidurianEntry, e: MouseEvent): void {
    if (!this.tooltipEl) return;
    if (this.svg.closest('.sabidurian-measure-mode')) { this.hideTooltip(); return; }

    // Clear previous content
    this.tooltipEl.empty();

    const strong = this.tooltipEl.createEl('strong');
    strong.textContent = entry.displayLabel ?? entry.label;
    prependTaskImage(strong, entry.icon);

    if (this.sequenceMode) {
      this.tooltipEl.createEl('br');
      this.tooltipEl.appendText(this.sequenceLabel(entry));
    } else {
      this.tooltipEl.createEl('br');
      let dateText = formatDateRange(entry.start, entry.isPoint ? null : entry.end);
      if (entry.isOngoing) {
        dateText += ' → present (ongoing)';
      }
      this.tooltipEl.appendText(dateText);
    }

    // Fuzzy date info
    if (entry.earliestStart) {
      this.tooltipEl.createEl('br');
      const span = this.tooltipEl.createEl('span', { cls: 'sabidurian-tooltip-prop' });
      span.textContent = 'Earliest start:';
      this.tooltipEl.appendText(` ${formatSabidurianDate(entry.earliestStart)}`);
    }
    if (entry.latestEnd) {
      this.tooltipEl.createEl('br');
      const span = this.tooltipEl.createEl('span', { cls: 'sabidurian-tooltip-prop' });
      span.textContent = 'Latest end:';
      this.tooltipEl.appendText(` ${formatSabidurianDate(entry.latestEnd)}`);
    }

    this.tooltipEl.style.display = 'block';
    this.moveTooltip(e);
  }

  private moveTooltip(e: MouseEvent): void {
    if (!this.tooltipEl) return;
    // Position tooltip close to cursor — slightly right and above
    const gapX = 12;
    const gapY = 8;
    const tw = this.tooltipEl.offsetWidth || 200;
    const th = this.tooltipEl.offsetHeight || 60;
    const viewport = this.svg.ownerDocument.defaultView ?? window;
    const vw = viewport.innerWidth;
    const vh = viewport.innerHeight;
    const margin = 6;

    // Default: right of cursor, above cursor
    let x = e.clientX + gapX;
    let y = e.clientY - gapY - th;

    // Flip horizontally if it would overflow
    if (x + tw > vw - margin) x = e.clientX - tw - gapX;
    // Flip vertically if it would go above viewport
    if (y < margin) y = e.clientY + gapY;
    // Clamp bottom
    if (y + th > vh - margin) y = vh - th - margin;
    x = Math.max(margin, Math.min(x, vw - tw - margin));
    y = Math.max(margin, y);

    this.tooltipEl.style.left = `${x}px`;
    this.tooltipEl.style.top = `${y}px`;
  }

  hideTooltip(): void {
    if (!this.tooltipEl) return;
    this.tooltipEl.style.display = 'none';
  }

  destroy(): void {
    this.invalidateCollaboration();
    this.tooltipEl?.remove();
    this.tooltipEl = null;
  }
}

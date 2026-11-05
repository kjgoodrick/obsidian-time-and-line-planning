/**
 * MeasureManager — Drag a span or click two points to measure time.
 *
 * State machine: idle → awaiting-a → awaiting-b → displaying → idle
 *
 * Supports both Timeline (year-based) and Sequence (ordinal) modes.
 */

import { NumericAxis } from '../scale/NumericAxis';
import { formatMeasureDuration } from '../utils/measureDuration';

const SVG_NS = 'http://www.w3.org/2000/svg';

type MeasureState = 'idle' | 'awaiting-a' | 'awaiting-b' | 'displaying';

interface MeasurePoint {
  year: number;
  x: number;
  y: number;
}

export class MeasureManager {
  state: MeasureState = 'idle';
  private pointA: MeasurePoint | null = null;
  private pointB: MeasurePoint | null = null;
  private overlayEl: HTMLElement | null = null;
  private markerA: SVGElement | null = null;
  private markerB: SVGElement | null = null;
  private spanLine: SVGElement | null = null;
  private gesture: { start: MeasurePoint; clientX: number; clientY: number; dragging: boolean } | null = null;
  private suppressClick = false;

  /** When true, shows "N positions" instead of time units. */
  sequenceMode = false;

  constructor(
    private svg: SVGSVGElement,
    private containerEl: HTMLElement,
    private axis: NumericAxis,
    private hideTaskTooltip: () => void = () => {},
  ) {
    // Capture before task moving/resizing/creation, even when editing is unlocked.
    svg.addEventListener('mousedown', this.onMouseDown, true);
    svg.ownerDocument.addEventListener('mousemove', this.onMouseMove, true);
    svg.ownerDocument.addEventListener('mouseup', this.onMouseUp, true);
    svg.ownerDocument.defaultView?.addEventListener('blur', this.onBlur);
  }

  activate(): void {
    this.clearVisuals();
    this.suppressClick = false;
    this.hideTaskTooltip();
    this.state = 'awaiting-a';
    this.containerEl.classList.add('sabidurian-measure-mode');
  }

  deactivate(): void {
    if (this.gesture) this.suppressClick = true;
    this.gesture = null;
    this.state = 'idle';
    this.containerEl.classList.remove('sabidurian-measure-mode');
    this.containerEl.querySelector('.sabidurian-measure-btn')?.classList.remove('sabidurian-measure-active');
    this.clearVisuals();
  }

  get isActive(): boolean {
    return this.state !== 'idle';
  }

  handleClick(e: MouseEvent): boolean {
    if (this.suppressClick) { this.suppressClick = false; return true; }
    if (this.state === 'idle') return false;
    const point = this.pointAt(e);

    if (this.state === 'awaiting-a') {
      this.pointA = point;
      this.renderMarker(this.pointA, 'a');
      this.state = 'awaiting-b';
      return true;
    }

    if (this.state === 'awaiting-b') {
      this.pointB = point;
      this.renderMarker(this.pointB, 'b');
      this.renderMeasurement();
      this.state = 'displaying';
      return true;
    }

    if (this.state === 'displaying') {
      this.deactivate();
      return true;
    }

    return false;
  }

  private pointAt(e: MouseEvent): MeasurePoint {
    const rect = this.svg.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    return { year: this.axis.pixelToYear(x), x, y };
  }

  private onMouseDown = (e: MouseEvent): void => {
    this.suppressClick = false;
    if (!this.isActive || e.button !== 0) return;
    e.preventDefault(); e.stopImmediatePropagation();
    this.gesture = { start: this.pointAt(e), clientX: e.clientX, clientY: e.clientY, dragging: false };
  };

  private onMouseMove = (e: MouseEvent): void => {
    const gesture = this.gesture;
    if (!gesture) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (!gesture.dragging) {
      if (Math.hypot(e.clientX - gesture.clientX, e.clientY - gesture.clientY) < 4) return;
      gesture.dragging = true;
      if (this.state !== 'awaiting-b') {
        this.clearVisuals();
        this.pointA = gesture.start;
        this.renderMarker(this.pointA, 'a');
      }
      this.state = 'awaiting-b';
    }
    this.pointB = this.pointAt(e);
    this.renderMarker(this.pointB, 'b');
    this.renderMeasurement();
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (!this.gesture || e.button !== 0) return;
    // Also account for the final release position, including outside the SVG.
    this.onMouseMove(e);
    const dragged = this.gesture.dragging;
    this.gesture = null;
    if (dragged) { this.state = 'displaying'; this.suppressClick = true; }
    // A plain click follows the existing two-click / click-to-clear flow.
  };

  private onBlur = (): void => { if (this.gesture) this.deactivate(); };

  handleKeydown(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.state !== 'idle') {
      this.deactivate();
      return true;
    }
    return false;
  }

  private renderMarker(point: MeasurePoint, id: string): void {
    const line = (id === 'a' ? this.markerA : this.markerB) ?? this.svg.ownerDocument.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', `${point.x}`);
    line.setAttribute('x2', `${point.x}`);
    line.setAttribute('y1', '0');
    const svgHeight = this.svg.getAttribute('height') || `${this.svg.clientHeight}`;
    line.setAttribute('y2', svgHeight);
    line.classList.add('sabidurian-measure-marker');
    this.svg.appendChild(line);
    if (id === 'a') this.markerA = line;
    else this.markerB = line;
  }

  private renderMeasurement(): void {
    if (!this.pointA || !this.pointB) return;

    const [earlier, later] = this.pointA.year < this.pointB.year
      ? [this.pointA, this.pointB]
      : [this.pointB, this.pointA];

    // Span line between markers
    const midY = Math.min(earlier.y, later.y) - 16;
    const spanLine = this.spanLine ?? this.svg.ownerDocument.createElementNS(SVG_NS, 'line');
    spanLine.setAttribute('x1', `${earlier.x}`);
    spanLine.setAttribute('x2', `${later.x}`);
    spanLine.setAttribute('y1', `${midY}`);
    spanLine.setAttribute('y2', `${midY}`);
    spanLine.classList.add('sabidurian-measure-span');
    this.svg.appendChild(spanLine);
    this.spanLine = spanLine;

    // Compute duration text
    const durationText = this.sequenceMode
      ? this.computeSequenceDistance(earlier.year, later.year)
      : formatMeasureDuration(earlier.year, later.year);

    // Floating label — positioned inside the timeline scroll container
    const overlay = this.overlayEl ?? this.svg.ownerDocument.createElement('div');
    overlay.classList.add('sabidurian-measure-label');
    overlay.textContent = durationText;
    const midX = (earlier.x + later.x) / 2;
    const timelineBody = this.containerEl.querySelector('.sabidurian-timeline-body');
    // SVG coordinates include scrolling; keep the readout below the sticky header.
    const labelTop = Math.max((timelineBody?.scrollTop ?? 0) + 4, midY - 28);
    overlay.style.left = `${midX}px`;
    overlay.style.top = `${labelTop}px`;
    // Append to the scrollable timeline body so it scrolls with content
    if (timelineBody) {
      timelineBody.appendChild(overlay);
    } else {
      // Fallback: append to container itself
      this.containerEl.appendChild(overlay);
    }
    this.overlayEl = overlay;
  }

  private computeSequenceDistance(posA: number, posB: number): string {
    const diff = Math.abs(Math.round(posB) - Math.round(posA));
    return `${diff} position${diff !== 1 ? 's' : ''}`;
  }

  private clearVisuals(): void {
    this.markerA?.remove();
    this.markerB?.remove();
    this.spanLine?.remove();
    this.overlayEl?.remove();
    this.markerA = this.markerB = this.spanLine = null;
    this.overlayEl = null;
    this.pointA = this.pointB = null;
  }

  destroy(): void {
    this.deactivate();
    this.svg.removeEventListener('mousedown', this.onMouseDown, true);
    this.svg.ownerDocument.removeEventListener('mousemove', this.onMouseMove, true);
    this.svg.ownerDocument.removeEventListener('mouseup', this.onMouseUp, true);
    this.svg.ownerDocument.defaultView?.removeEventListener('blur', this.onBlur);
  }
}

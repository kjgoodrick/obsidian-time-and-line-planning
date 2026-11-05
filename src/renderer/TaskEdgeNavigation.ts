import type { SabidurianEntry } from '../model/SabidurianEntry';
import { displayTooltip, setTooltip } from 'obsidian';
import { BAR_HEIGHT } from '../model/LayoutEngine';
import { prependTaskImage } from '../model/taskIcons';

export type TaskBoundary = 'start' | 'end';

/** Read-only navigation beside each visible row, independent of SVG/bar culling. */
export class TaskEdgeNavigation {
  private layer: HTMLDivElement;
  private buttons = new Map<string, HTMLButtonElement>();
  private frame: number | null = null;
  private resize: ResizeObserver | null = null;
  private schedule = () => {
    if (this.frame === null) this.frame = requestAnimationFrame(() => { this.frame = null; this.refresh(); });
  };

  constructor(private body: HTMLElement, host: HTMLElement,
    private entries: SabidurianEntry[], private rowY: (row: number) => number,
    private jump: (entry: SabidurianEntry, boundary: TaskBoundary) => void) {
    this.layer = body.ownerDocument.createElement('div');
    this.layer.className = 'sabidurian-task-edges';
    host.append(this.layer);
    body.addEventListener('scroll', this.schedule, { passive: true });
    const Observer = body.ownerDocument.defaultView?.ResizeObserver;
    if (Observer) { this.resize = new Observer(this.schedule); this.resize.observe(body); }
    this.schedule();
  }

  refresh(): void {
    const { scrollLeft: left, scrollTop: top, clientWidth: width, clientHeight: height } = this.body;
    if (!width || !height) return;
    const right = left + width;
    this.layer.style.width = `${width}px`; this.layer.style.height = `${height}px`;
    const candidates = new Map<string, { entry: SabidurianEntry; boundary: TaskBoundary; y: number; distance: number }>();
    for (const entry of this.entries) {
      if (entry.row < 0) continue;
      const y = this.rowY(entry.row) + BAR_HEIGHT / 2 - top;
      if (y < 0 || y > height) continue;
      const end = entry.x + entry.width;
      const add = (boundary: TaskBoundary, distance: number) => {
        const key = `${entry.row}:${boundary}`;
        if (!candidates.has(key) || candidates.get(key)!.distance > distance) candidates.set(key, { entry, boundary, y, distance });
      };
      // Compare actual duration, never the label's overflowing text bounds.
      if (entry.x < left - 1) add('start', Math.max(0, left - end));
      if (!entry.isOngoing && end > right + 1) add('end', Math.max(0, entry.x - right));
    }
    const keep = new Set<string>();
    for (const { entry, boundary, y } of candidates.values()) {
      const key = `${entry.file.path}:${boundary}`; keep.add(key);
      let button = this.buttons.get(key);
      if (!button) {
        button = this.body.ownerDocument.createElement('button');
        button.type = 'button'; button.className = `sabidurian-task-edge sabidurian-task-edge-${boundary}`;
        button.dataset.filePath = entry.file.path; button.dataset.boundary = boundary;
        const icon = this.body.ownerDocument.createElement('span'); icon.setAttribute('aria-hidden', 'true'); button.append(icon);
        const label = entry.displayLabel ?? entry.label;
        setTooltip(button, label, { delay: 100 });
        if (entry.icon?.kind === 'image') {
          const target = button;
          target.addEventListener('pointerover', event => {
            // Supply rich content to the same native tooltip; do not also let
            // the delegated aria-label handler replace it with plain text.
            event.stopPropagation();
            if (event.pointerType !== 'mouse' || (event.relatedTarget instanceof target.ownerDocument.defaultView!.Node && target.contains(event.relatedTarget))) return;
            const content = target.ownerDocument.createDocumentFragment();
            const caption = target.ownerDocument.createElement('span');
            caption.textContent = label; prependTaskImage(caption, entry.icon); content.append(caption);
            displayTooltip(target, content, { delay: 100 });
          });
        }
        button.setAttribute('aria-description', `Jump to the ${boundary} of this task`);
        for (const event of ['pointerdown', 'mousedown', 'touchstart', 'keydown']) button.addEventListener(event, e => e.stopPropagation());
        button.onclick = event => { event.preventDefault(); event.stopPropagation(); this.jump(entry, boundary); };
        this.layer.append(button); this.buttons.set(key, button);
      }
      button.style.top = `${y}px`;
    }
    for (const [key, button] of this.buttons) if (!keep.has(key)) { button.remove(); this.buttons.delete(key); }
  }

  destroy(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.body.removeEventListener('scroll', this.schedule); this.resize?.disconnect();
    this.layer.remove(); this.buttons.clear();
  }
}

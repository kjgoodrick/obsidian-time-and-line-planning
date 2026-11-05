/** A named palette token, or null when this property/value has no configured color. */
export type PropertyColorResolver = (property: string, value: string) => string | null | undefined;

const CELL = '.bases-td[data-property]';
const COLOR_ATTRIBUTE = 'data-sabidurian-color';

/**
 * Decorates existing native Bases cells without replacing their editors, values,
 * focus, or event handlers. Native Bases currently exposes the property name but
 * no value attribute, so a small observer follows its virtualized cell content.
 */
export class NativeTableColors {
  private observer: MutationObserver;
  private marked = new Set<HTMLElement>();
  private stopped = false;
  private onInput = (event: Event): void => {
    const cell = this.closestCell(event.target as Node | null);
    if (cell) this.colorCell(cell);
  };

  constructor(private root: HTMLElement, private resolve: PropertyColorResolver) {
    const Observer = root.ownerDocument.defaultView!.MutationObserver;
    this.observer = new Observer(records => {
      const cells = new Set<HTMLElement>();
      for (const record of records) {
        const cell = this.closestCell(record.target);
        if (cell) cells.add(cell);
        for (const node of Array.from(record.addedNodes)) this.collectCells(node, cells);
      }
      this.prune();
      for (const cell of cells) if (this.root.contains(cell)) this.colorCell(cell);
    });
    // Our own color attributes are deliberately not observed, preventing loops.
    this.observer.observe(root, { childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['data-property'] });
    root.addEventListener('input', this.onInput, true);
    root.addEventListener('change', this.onInput, true);
    this.refresh();
  }

  /** Reapply after palette settings change; ordinary cell changes are automatic. */
  refresh(): void {
    if (this.stopped) return;
    this.prune();
    const cells = new Set<HTMLElement>();
    this.collectCells(this.root, cells);
    for (const cell of cells) this.colorCell(cell);
  }

  destroy(): void {
    if (this.stopped) return;
    this.stopped = true; this.observer.disconnect();
    this.root.removeEventListener('input', this.onInput, true);
    this.root.removeEventListener('change', this.onInput, true);
    for (const element of this.marked) element.removeAttribute(COLOR_ATTRIBUTE);
    this.marked.clear();
  }

  private closestCell(node: Node | null): HTMLElement | null {
    const element = node?.nodeType === 1 ? node as Element : node?.parentElement;
    return element?.closest<HTMLElement>(CELL) ?? null;
  }

  private collectCells(node: Node, cells: Set<HTMLElement>): void {
    if (node.nodeType !== 1) return;
    const element = node as HTMLElement;
    if (element.matches(CELL)) cells.add(element);
    for (const cell of Array.from(element.querySelectorAll<HTMLElement>(CELL))) cells.add(cell);
  }

  private colorCell(cell: HTMLElement): void {
    const property = (cell.getAttribute('data-property') ?? '').replace(/^note\./, '');
    const content = cell.querySelector<HTMLElement>(':scope > .bases-table-cell.bases-metadata-value');
    const desired = new Map<HTMLElement, string>();
    const add = (element: HTMLElement, value: string): void => {
      const color = value.trim() ? this.resolve(property, value.trim()) : null;
      // Only tokens are accepted. Colors themselves live in the scoped CSS palette.
      if (color && /^[a-z][a-z0-9-]*$/.test(color)) desired.set(element, color);
    };
    if (content) {
      const pills = content.querySelectorAll<HTMLElement>('.multi-select-pill');
      if (pills.length) {
        for (const pill of Array.from(pills)) add(pill, pill.querySelector('.multi-select-pill-content')?.textContent ?? '');
      } else {
        const editor = content.querySelector<HTMLElement>('.metadata-input-longtext');
        const input = content.querySelector<HTMLInputElement | HTMLTextAreaElement>('input:not([type="checkbox"]), textarea');
        if (editor) add(cell, editor.textContent ?? '');
        else if (input) add(cell, input.value);
      }
    }
    for (const marked of this.marked) {
      if ((marked === cell || cell.contains(marked)) && !desired.has(marked)) this.clear(marked);
    }
    for (const [element, color] of desired) {
      if (element.getAttribute(COLOR_ATTRIBUTE) !== color) element.setAttribute(COLOR_ATTRIBUTE, color);
      this.marked.add(element);
    }
  }

  private prune(): void {
    for (const element of this.marked) if (!this.root.contains(element)) this.clear(element);
  }

  private clear(element: HTMLElement): void {
    element.removeAttribute(COLOR_ATTRIBUTE); this.marked.delete(element);
  }
}

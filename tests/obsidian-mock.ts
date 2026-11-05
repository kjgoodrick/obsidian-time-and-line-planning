// Host API seam only. DOM, scheduling, rendering and event handlers are production code.
export class Modal {
  static opened: Modal[] = [];
  contentEl = document.createElement('div');
  constructor(public app: any) {}
  open() { Modal.opened.push(this); document.body.append(this.contentEl); (this as any).onOpen?.(); }
  close() { (this as any).onClose?.(); this.contentEl.remove(); }
}
export class FuzzySuggestModal<T> extends Modal {
  setPlaceholder(_: string) {}
  renderSuggestion(match: { item: T }, element: HTMLElement) { element.textContent = (this as any).getItemText(match.item); }
}
export class Notice { constructor(public message: string) {} }
export class Menu { addItem(_: any) { return this; } showAtMouseEvent(_: any) {} }
export class BasesView { constructor(_: any) {} }
export class TFile {}
export function setIcon() {}
export function setTooltip(el: HTMLElement, text: string, options?: { delay?: number }) {
  el.setAttribute('aria-label', text);
  if (options?.delay != null) el.setAttribute('data-tooltip-delay', String(options.delay));
}
export const displayedTooltips: { target: HTMLElement; content: string | DocumentFragment; options?: { delay?: number } }[] = [];
export function displayTooltip(target: HTMLElement, content: string | DocumentFragment, options?: { delay?: number }) {
  displayedTooltips.push({ target, content, options });
}

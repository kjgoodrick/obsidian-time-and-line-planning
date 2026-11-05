/** Minimal Obsidian host adapter for the real plugin view in Safari/WebKit.
 * This deliberately does not claim to reproduce Obsidian's native app shell,
 * Markdown file manager, Bases query engine, or iOS vault storage.
 */
export function installHostDom(): void {
  // Obsidian owns its modal shell. Safari's standalone host must account for the
  // keyboard's visual viewport itself without changing production form code.
  const viewport = window.visualViewport;
  let lastViewport = '';
  let previousHeight = 0;
  const fitViewport = (event?: Event) => {
    const style = document.documentElement.style;
    const height = viewport?.height ?? innerHeight;
    const centerFocusedField = event?.type === 'focusin' || Math.abs(height - previousHeight) > 1;
    previousHeight = height;
    style.setProperty('--harness-viewport-height', `${height}px`);
    style.setProperty('--harness-viewport-width', `${viewport?.width ?? innerWidth}px`);
    style.setProperty('--harness-viewport-top', `${viewport?.offsetTop ?? 0}px`);
    style.setProperty('--harness-viewport-left', `${viewport?.offsetLeft ?? 0}px`);
    document.body.classList.toggle('harness-keyboard-compact', height < 220);
    requestAnimationFrame(() => {
      const active = document.activeElement as HTMLElement | null;
      const content = active?.closest('.modal-content') as HTMLElement | null;
      // Do not fight the user's ordinary scrolling while the keyboard stays open.
      if (centerFocusedField && height < 220 && content && active?.matches('input,select,textarea')) {
        const box = content.getBoundingClientRect(); const field = active.getBoundingClientRect();
        if (field.top < box.top || field.bottom > box.bottom) content.scrollTop += field.top - box.top - (box.height - field.height) / 2;
      }
      const geometry = { width: viewport?.width ?? innerWidth, height, top: viewport?.offsetTop ?? 0,
        compact: height < 220, active: active?.tagName, inputType: (active as HTMLInputElement)?.type,
        modal: content ? { height: content.clientHeight, scrollHeight: content.scrollHeight, scrollTop: content.scrollTop } : null };
      const key = JSON.stringify(geometry);
      if (key !== lastViewport) { lastViewport = key; void fetch('/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'viewport', ...geometry, at: new Date().toISOString() }) }).catch(() => {}); }
    });
  };
  viewport?.addEventListener('resize', fitViewport);
  viewport?.addEventListener('scroll', fitViewport);
  window.addEventListener('resize', fitViewport);
  document.addEventListener('focusin', fitViewport);
  fitViewport();
  const p = HTMLElement.prototype as any;
  p.createEl = function(tag: string, options: any = {}, callback?: (el: HTMLElement) => void) {
    const el = document.createElement(tag);
    if (options.text != null) el.textContent = options.text;
    if (options.cls) el.className = options.cls;
    for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, String(value));
    for (const key of ['type', 'value', 'placeholder', 'title']) if (options[key] != null) (el as any)[key] = options[key];
    this.append(el); callback?.(el); return el;
  };
  p.createDiv = function(options: any) { return this.createEl('div', options); };
  p.createSpan = function(options: any) { return this.createEl('span', options); };
  p.addClass = function(...names: string[]) { this.classList.add(...names); };
  p.empty = function() { this.replaceChildren(); };
  p.setText = function(text: string) { this.textContent = text; };
  p.appendText = function(text: string) { this.append(document.createTextNode(text)); };
}

export class Modal {
  static opened: Modal[] = [];
  contentEl = document.createElement('div');
  modalEl = document.createElement('section');
  containerEl = document.createElement('div');
  constructor(public app: any) {
    this.containerEl.className = 'modal-container'; this.modalEl.className = 'modal';
    this.modalEl.setAttribute('role', 'dialog'); this.modalEl.setAttribute('aria-modal', 'true');
    this.contentEl.className = 'modal-content'; this.modalEl.append(this.contentEl);
    this.containerEl.append(this.modalEl);
    const close = document.createElement('button'); close.className = 'modal-close-button';
    close.textContent = '×'; close.setAttribute('aria-label', 'Close dialog'); close.onclick = () => this.close();
    this.modalEl.append(close);
    this.containerEl.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); this.close(); } });
  }
  open() { Modal.opened.push(this); document.body.append(this.containerEl); (this as any).onOpen?.(); }
  close() { (this as any).onClose?.(); this.containerEl.remove(); Modal.opened = Modal.opened.filter(item => item !== this); }
}

export class FuzzySuggestModal<T> extends Modal {
  private placeholder = '';
  setPlaceholder(value: string) { this.placeholder = value; }
  getItems(): T[] { return []; }
  getItemText(item: T): string { return String(item); }
  renderSuggestion(match: { item: T }, element: HTMLElement): void { element.textContent = this.getItemText(match.item); }
  onChooseItem(_: T): void {}
  onOpen() {
    const input = document.createElement('input'); input.type = 'search'; input.placeholder = this.placeholder;
    input.setAttribute('aria-label', 'Find a task'); input.className = 'harness-picker-search'; this.contentEl.append(input);
    const list = document.createElement('div'); list.className = 'harness-picker-list'; this.contentEl.append(list);
    const render = () => {
      list.replaceChildren();
      const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
      for (const item of this.getItems().filter(item => words.every(word => this.getItemText(item).toLowerCase().includes(word)))) {
        const button = document.createElement('button'); this.renderSuggestion({ item }, button);
        button.onclick = () => { this.onChooseItem(item); this.close(); }; list.append(button);
      }
    };
    input.oninput = render;
    input.onkeydown = event => { if (event.key === 'Enter') list.querySelector('button')?.click(); };
    render(); input.focus();
  }
}

export class Notice {
  constructor(message: string) {
    const el = document.createElement('div'); el.className = 'harness-notice'; el.setAttribute('role', 'status');
    el.textContent = message; document.body.append(el); setTimeout(() => el.remove(), 5000);
  }
}
export class Menu {
  private items: { title: string; action?: () => void; disabled?: boolean }[] = [];
  addItem(build: (item: any) => void) {
    const data: any = {}; const item: any = {
      setTitle: (value: string) => { data.title = value; return item; }, setIcon: () => item,
      setDisabled: (value: boolean) => { data.disabled = value; return item; },
      setChecked: () => item, onClick: (action: () => void) => { data.action = action; return item; },
    }; build(item); this.items.push(data); return this;
  }
  addSeparator() { return this; }
  showAtMouseEvent() {
    const modal = new Modal({}); const list = document.createElement('div'); list.className = 'harness-picker-list';
    for (const item of this.items) { const button = document.createElement('button'); button.textContent = item.title; button.disabled = Boolean(item.disabled); button.onclick = () => { modal.close(); item.action?.(); }; list.append(button); }
    modal.contentEl.append(list); modal.open();
  }
}
export class BasesView { constructor(_: any) {} }
export class TFile {}
export function setIcon(el: HTMLElement, icon: string) {
  // Only the host's icon API is substituted; all timeline SVGs are production renderers.
  el.setAttribute('aria-hidden', 'true'); el.textContent = icon === 'lock' ? '▣' : icon === 'unlock' ? '□' : icon === 'ruler' ? '↔' : '';
}

// Obsidian owns tooltip presentation; the standalone host retains its label metadata.
export function setTooltip(el: HTMLElement, text: string, options?: { delay?: number }) {
  el.setAttribute('aria-label', text);
  if (options?.delay != null) el.setAttribute('data-tooltip-delay', String(options.delay));
}
export function displayTooltip(el: HTMLElement, content: string | DocumentFragment, options?: { delay?: number }) {
  setTooltip(el, typeof content === 'string' ? content : content.textContent ?? '', options);
}

import type { TimelineSelectionHandle } from './CollaborationBridge';

let pickerId = 0;

function sameTarget(left: TimelineSelectionHandle, right: TimelineSelectionHandle): boolean {
  const a = left.target, b = right.target;
  if (a.type === 'group' || b.type === 'group') return a.type === 'group' && b.type === 'group' && a.group === b.group;
  return a.type === b.type && a.file === b.file && (a.type !== 'cell' || b.type === 'cell' && a.property === b.property);
}

function label(handle: TimelineSelectionHandle): string {
  const target = handle.target;
  if (target.type === 'group') return `Lane: ${handle.element.querySelector('text')?.textContent?.trim() || 'Untitled lane'}`;
  return target.type === 'cell' ? `Property: ${target.file.path} — ${target.property}` : `Item: ${target.file.path}`;
}

/** Native controls provide keyboard and assistive-technology target selection
 * without changing SVG scheduling semantics or relying on simulated clicks. */
export function annotationPicker(root: HTMLElement, read: () => TimelineSelectionHandle[],
  choose: (handle: TimelineSelectionHandle) => void, cancel: () => void) {
  const doc = root.ownerDocument, priorFocus = doc.activeElement as HTMLElement | null;
  const panel = doc.createElement('div'); panel.className = 'sabidurian-annotation-picker';
  panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', 'Choose a comment target');
  const name = doc.createElement('label'); name.textContent = 'Comment target';
  const select = doc.createElement('select'); select.id = `sabidurian-annotation-target-${++pickerId}`; name.htmlFor = select.id;
  const confirm = doc.createElement('button'); confirm.type = 'button'; confirm.textContent = 'Comment';
  const close = doc.createElement('button'); close.type = 'button'; close.textContent = 'Cancel';
  const status = doc.createElement('span'); status.id = `${select.id}-status`; status.setAttribute('role', 'status');
  select.setAttribute('aria-describedby', status.id);
  panel.append(name, select, confirm, close, status); root.append(panel);
  let handles: TimelineSelectionHandle[] = [], selected: TimelineSelectionHandle | undefined, marked: SVGElement | undefined;
  let live = true;
  const clearMark = () => { marked?.classList.remove('sabidurian-annotation-target'); marked = undefined; };
  const paint = () => {
    clearMark(); confirm.disabled = !selected;
    if (selected?.current()) { marked = selected.element; marked.classList.add('sabidurian-annotation-target'); }
  };
  const refresh = () => {
    if (!live) return;
    const next = read().filter(handle => handle.current() && root.contains(handle.element));
    // Preserve DOM order, including collapsed lanes and property badges nested
    // in their task. Never derive the target from an option label or its index.
    next.sort((a, b) => {
      const position = a.element.compareDocumentPosition(b.element);
      return position & 4 ? -1 : position & 2 ? 1 : 0;
    });
    const previous = selected, matches = previous ? next.filter(handle => sameTarget(previous, handle)) : [];
    selected = matches.length === 1 ? matches[0] : undefined;
    const changed = next.length !== handles.length || next.some((handle, index) =>
      handle.element !== handles[index].element || !sameTarget(handle, handles[index]) || label(handle) !== select.options[index + 1]?.textContent);
    handles = next;
    if (changed || !select.options.length) {
      const prompt = doc.createElement('option'); prompt.value = ''; prompt.textContent = 'Choose an item, property or lane';
      const options = handles.map((handle, index) => {
        const option = doc.createElement('option'); option.value = String(index); option.textContent = label(handle); return option;
      });
      select.replaceChildren(prompt, ...options);
    }
    select.value = selected ? String(handles.indexOf(selected)) : '';
    status.textContent = previous && !selected ? 'That target changed or is ambiguous. Choose again.' :
      handles.length ? 'Choose here or click the timeline. Press Enter to comment. Escape cancels.' :
        'No item, property or lane targets are currently available. Cancel to change the view.';
    paint();
  };
  const submit = () => {
    if (!live) return;
    refresh();
    if (selected?.current()) choose(selected);
  };
  select.addEventListener('change', () => {
    const value = select.value;
    selected = value !== '' && /^\d+$/.test(value) ? handles[Number(value)] : undefined;
    // Refresh before confirmation as source objects can change before a render.
    refresh();
  });
  confirm.addEventListener('click', submit);
  close.addEventListener('click', cancel);
  for (const type of ['click', 'pointerdown', 'mousedown', 'touchstart', 'contextmenu']) {
    panel.addEventListener(type, event => event.stopPropagation());
  }
  refresh();
  return {
    current: () => live && panel.isConnected && root.contains(panel),
    contains: (node: EventTarget | null) => !!node && panel.contains(node as Node),
    refresh,
    focus: () => select.focus({ preventScroll: true }),
    key: (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); cancel(); }
      else if (event.target === select && event.key === 'Enter' && !event.isComposing && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault(); submit();
      }
      // Leave native select arrows/type-ahead and button activation intact.
      // The surface stops propagation to schedule keyboard handlers.
    },
    dispose: () => {
      if (!live) return; live = false;
      const restore = panel.contains(doc.activeElement) || doc.activeElement === doc.body;
      clearMark(); panel.remove();
      if (restore && priorFocus?.isConnected && typeof priorFocus.focus === 'function') priorFocus.focus({ preventScroll: true });
    },
  };
}

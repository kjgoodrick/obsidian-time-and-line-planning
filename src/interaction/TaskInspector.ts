import { Scheduling } from '../model/Scheduling';
import { App, Modal, Notice, FuzzySuggestModal, TFile } from 'obsidian';
import { dependencyLinks } from '../model/labels';
import { iconLabel, prependTaskImage, resolveTaskIcon } from '../model/taskIcons';
import type { FuzzyMatch } from 'obsidian';
import { offsetISO, parseExactTime } from '../utils/timezone';
import { EditHistory } from '../model/EditHistory';
import { parseSabidurianDate, formatSabidurianDate } from '../utils/dateUtils';

function displayDate(value: unknown, zone: string): string {
  const parsed = parseSabidurianDate(value, zone);
  return parsed ? formatSabidurianDate(parsed) : String(value ?? '');
}

export interface TaskFields { start: string; end: string; label: string; dependencies: string; zone: string; folder?: string; locked?: string }
export class TaskPicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private files: TFile[], private fields: TaskFields, private choose: (file: TFile) => void) {
    super(app); this.setPlaceholder('Find a task by name, dish or date');
  }
  getItems(): TFile[] { return this.files; }
  getItemText(file: TFile): string {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    return [iconLabel(String(fm[this.fields.label] ?? file.basename), resolveTaskIcon(fm.icon, this.app, file.path)), fm.Dish, displayDate(fm[this.fields.start], this.fields.zone)].filter(Boolean).join(' · ');
  }
  renderSuggestion(match: FuzzyMatch<TFile>, element: HTMLElement): void {
    super.renderSuggestion(match, element);
    const fm = this.app.metadataCache.getFileCache(match.item)?.frontmatter;
    prependTaskImage(element, resolveTaskIcon(fm?.icon, this.app, match.item.path));
  }
  onChooseItem(file: TFile): void { this.choose(file); }
}

/** Uses Obsidian APIs and HTML controls supported by the iOS WKWebView. No desktop APIs. */
export class TaskInspector extends Modal {
  private static active = new Set<TaskInspector>();
  private dirty = () => false;
  static hasDirty(document: Document): boolean {
    return [...this.active].some(inspector => inspector.contentEl.ownerDocument === document && inspector.contentEl.isConnected && inspector.dirty());
  }
  constructor(app: App, private file: TFile, private fields: TaskFields,
    private history: EditHistory, private locked: boolean, private refresh: () => void,
    private unlock: () => void, private displayLabel?: string,
    private navigate?: (file: TFile) => void) { super(app); }

  onOpen(): void {
    TaskInspector.active.add(this);
    const { contentEl: el } = this; el.addClass('sabidurian-inspector');
    const fm = this.app.metadataCache.getFileCache(this.file)?.frontmatter ?? {};
    const f = this.fields;
    const scheduling = new Scheduling(5, f.zone);
    const original = { [f.start]: fm[f.start], [f.end]: fm[f.end], [f.dependencies]: fm[f.dependencies] };
    let start = String(fm[f.start] ?? ''), end = String(fm[f.end] ?? '');
    const originalStart = start, originalEnd = end;
    let deps = dependencyLinks(fm[f.dependencies]);
    const resolve = (path: string) => this.app.metadataCache.getFirstLinkpathDest(path, this.file.path);
    const dependencyKeys = (paths: string[]) => JSON.stringify([...new Set(paths.map(path =>
      resolve(path)?.path ?? path.replace(/\.md$/, '')))].sort());
    const originalDependencies = dependencyKeys(deps);
    const noteLocked = String(fm[f.locked || 'locked']) === 'true';
    const disabled = this.locked || noteLocked;
    const icon = resolveTaskIcon(fm.icon, this.app, this.file.path);
    const heading = el.createEl('h2', { text: iconLabel(this.displayLabel ?? String(fm[f.label] ?? fm.Step ?? this.file.basename), icon) });
    prependTaskImage(heading, icon);
    el.createEl('p', { text: [fm.Dish, fm['Active Chef'], fm['Oven Temp'] ? `${fm['Oven Temp']}° oven` : null].filter(Boolean).join(' · ') });
    el.createEl('p', { text: f.zone, cls: 'sabidurian-editor-zone' });
    const expectedInputs = new Map<HTMLInputElement, string>();
    const timeFields = el.createDiv({ cls: 'sabidurian-time-fields' });
    const makeTime = (label: string, value: string): HTMLInputElement => {
      const wrap = timeFields.createEl('label', { text: label });
      const input = wrap.createEl('input', { type: 'datetime-local' });
      input.step = '1';
      try { input.value = offsetISO(parseExactTime(value, f.zone), f.zone).slice(0, 19); } catch { input.value = value.slice(0, 19); }
      input.disabled = disabled; expectedInputs.set(input, input.value);
      return input;
    };
    const startInput = makeTime('Start', start), endInput = makeTime('End', end);
    const advanced = el.createEl('details', { cls: 'sabidurian-advanced-time' });
    advanced.createEl('summary', { text: 'Advanced time format' });
    const isoToggle = advanced.createEl('button', { text: 'Use ISO times with UTC offsets' });
    const error = el.createEl('p', { cls: 'sabidurian-editor-error', attr: { role: 'alert' } });
    const draftTimes = () => ({
      start: startInput.value === expectedInputs.get(startInput) ? start : offsetISO(parseExactTime(startInput.value, f.zone), f.zone),
      end: endInput.value === expectedInputs.get(endInput) ? end : offsetISO(parseExactTime(endInput.value, f.zone), f.zone),
    });
    const sameTime = (a: string, b: string) => {
      if (a === b) return true;
      try { return parseExactTime(a, f.zone) === parseExactTime(b, f.zone); } catch { return false; }
    };
    const isDirty = () => {
      try {
        const draft = draftTimes();
        return !sameTime(draft.start, originalStart) || !sameTime(draft.end, originalEnd)
          || dependencyKeys(deps) !== originalDependencies;
      } catch { return true; }
    };
    this.dirty = isDirty;
    let closeButton: HTMLButtonElement | undefined;
    const navigationMessage = 'Save or discard your changes before leaving this task.';
    const updateCloseLabel = () => {
      const dirty = isDirty(), label = dirty ? 'Discard changes' : 'Close';
      closeButton?.setText(label);
      // Obsidian's current Modal uses an x icon in a direct header button;
      // older hosts use the dedicated close class. Do not relabel other actions.
      const closeIcon = this.modalEl?.querySelector<HTMLElement>(':scope > .modal-close-button')
        ?? this.modalEl?.querySelector<SVGElement>(':scope > .modal-header-button > svg.lucide-x')?.parentElement;
      closeIcon?.setAttribute('aria-label', label); closeIcon?.setAttribute('title', label);
      if (!dirty && error.textContent === navigationMessage) error.setText('');
    };
    startInput.addEventListener('input', updateCloseLabel); endInput.addEventListener('input', updateCloseLabel);
    startInput.addEventListener('change', updateCloseLabel); endInput.addEventListener('change', updateCloseLabel);
    const showTimes = () => {
      startInput.value = startInput.type === 'text' ? start : start.slice(0, 19);
      endInput.value = endInput.type === 'text' ? end : end.slice(0, 19);
      expectedInputs.set(startInput, startInput.value); expectedInputs.set(endInput, endInput.value);
      updateCloseLabel();
    };
    isoToggle.onclick = () => {
      try {
        const draft = draftTimes(); start = draft.start; end = draft.end;
        startInput.type = endInput.type = 'text'; showTimes(); isoToggle.disabled = true; error.setText('');
      } catch (e) { error.setText(String(e)); updateCloseLabel(); }
    };
    const readInputs = () => {
      const draft = draftTimes();
      scheduling.validate(draft.start, draft.end);
      return draft;
    };
    const leaveFor = async (target: TFile, useTaskNavigation: boolean) => {
      if (isDirty()) { updateCloseLabel(); error.setText(navigationMessage); return; }
      try {
        if (useTaskNavigation && this.navigate) this.navigate(target);
        else await this.app.workspace.getLeaf(false).openFile(target);
        this.close();
      } catch (e) { error.setText(String(e)); }
    };
    const nudgeRow = el.createDiv({ cls: 'sabidurian-editor-actions' });
    for (const delta of [-5, 5]) {
      const button = nudgeRow.createEl('button', { text: `${delta > 0 ? '+' : '−'}5 min` });
      button.disabled = disabled;
      button.onclick = () => {
        try {
          const draft = readInputs();
          const moved = scheduling.nudge(draft.start, draft.end, delta); start = moved.start; end = moved.end;
          showTimes();
          error.setText('');
        } catch (e) { error.setText(String(e)); updateCloseLabel(); }
      };
    }
    el.createEl('h3', { text: 'Blocked by' });
    const list = el.createDiv();
    const taskText = (path: string) => {
      const file = resolve(path), meta = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : null;
      return [iconLabel(String(meta?.[f.label] ?? file?.basename ?? path), resolveTaskIcon(meta?.icon, this.app, file?.path ?? this.file.path)), meta?.Dish, meta?.[f.start] ? displayDate(meta[f.start], f.zone) : null].filter(Boolean).join(' · ');
    };
    const taskLink = (row: HTMLElement, path: string, target = resolve(path)) => {
      const text = taskText(path);
      if (!target) { row.createSpan({ text, attr: { title: 'Task unavailable' } }); return; }
      const link = row.createEl('button', { text, cls: 'sabidurian-dependency-link', attr: { 'aria-label': `Open ${text}` } });
      prependTaskImage(link, resolveTaskIcon(this.app.metadataCache.getFileCache(target)?.frontmatter?.icon, this.app, target.path));
      link.onclick = () => leaveFor(target, true);
    };
    const renderDeps = () => {
      list.empty();
      if (!deps.length) list.createEl('p', { text: 'None' });
      for (const path of deps) {
        const row = list.createDiv({ cls: 'sabidurian-dependency-row' });
        taskLink(row, path);
        const remove = row.createEl('button', { text: 'Remove', attr: { 'aria-label': `Remove ${taskText(path)}` } });
        remove.disabled = disabled; remove.onclick = () => { deps = deps.filter(d => d !== path); renderDeps(); updateCloseLabel(); };
      }
    }; renderDeps();
    const files = this.app.vault.getMarkdownFiles().filter(file => {
      const meta = this.app.metadataCache.getFileCache(file)?.frontmatter;
      return meta?.[f.start] != null && (!f.folder || file.path.startsWith(f.folder + '/'));
    });
    const add = el.createEl('button', { text: 'Add predecessor…' }); add.disabled = disabled;
    add.onclick = () => new TaskPicker(this.app, files.filter(file => file.path !== this.file.path && !deps.some(d => resolve(d)?.path === file.path)), f, file => {
      deps.push(file.path.replace(/\.md$/, '')); renderDeps(); updateCloseLabel();
    }).open();
    el.createEl('h3', { text: 'Blocking' });
    const blocking = files.filter(file => dependencyLinks(this.app.metadataCache.getFileCache(file)?.frontmatter?.[f.dependencies]).some(d => this.app.metadataCache.getFirstLinkpathDest(d, file.path)?.path === this.file.path));
    if (!blocking.length) el.createEl('p', { text: 'None' });
    for (const file of blocking) taskLink(el.createDiv({ cls: 'sabidurian-dependency-row' }), file.path, file);
    const actions = el.createDiv({ cls: 'sabidurian-editor-actions sabidurian-editor-footer' });
    if (this.locked && !noteLocked) {
      const edit = actions.createEl('button', { text: 'Unlock view to edit' });
      edit.onclick = () => { this.unlock(); this.close(); new TaskInspector(this.app, this.file, f, this.history, false, this.refresh, this.unlock, this.displayLabel, this.navigate).open(); };
    }
    const save = actions.createEl('button', { text: 'Save', cls: 'mod-cta' }); save.disabled = disabled;
    save.onclick = async () => {
      try {
        const draft = readInputs(); save.disabled = true;
        const patch: Record<string, any> = {};
        if (!sameTime(draft.start, originalStart)) patch[f.start] = draft.start;
        if (!sameTime(draft.end, originalEnd)) patch[f.end] = draft.end;
        if (dependencyKeys(deps) !== originalDependencies) patch[f.dependencies] = deps.map(path => `[[${path}]]`);
        await this.history.patch(this.file, patch, original);
        this.close(); this.refresh();
      } catch (e) { error.setText(String(e)); save.disabled = false; }
    };
    const open = actions.createEl('button', { text: 'Open note' }); open.onclick = () => leaveFor(this.file, false);
    closeButton = actions.createEl('button', { text: 'Close' }); closeButton.onclick = () => this.close();
    updateCloseLabel();
  }
  onClose(): void { TaskInspector.active.delete(this); this.dirty = () => false; this.contentEl.empty(); }
}

export interface NewTaskOptions {
  initialEnd?: string;
  dishes: string[];
  chefs: string[];
  ovens: string[];
  required?: string[];
}

export class NewTaskModal extends Modal {
  constructor(app: App, private zone: string, private initialStart: string,
    private create: (name: string, start: string, end: string, properties: Record<string, string>) => Promise<void>,
    private options: NewTaskOptions = { dishes: [], chefs: [], ovens: [] }) { super(app); }
  onOpen(): void {
    const el = this.contentEl; el.addClass('sabidurian-inspector');
    el.createEl('h2', { text: 'New task' });
    const name = el.createEl('label', { text: 'Step' }).createEl('input', { type: 'text', placeholder: 'What needs doing?', attr: { 'aria-label': 'Step' } });
    el.createEl('p', { text: this.zone, cls: 'sabidurian-editor-zone' });
    const times = el.createDiv({ cls: 'sabidurian-time-fields' });
    const start = times.createEl('label', { text: 'Start' }).createEl('input', { type: 'datetime-local', attr: { 'aria-label': 'Start' } }); start.value = this.initialStart.slice(0, 16);
    const end = times.createEl('label', { text: 'End' }).createEl('input', { type: 'datetime-local', attr: { 'aria-label': 'End' } }); end.value = (this.options.initialEnd ?? offsetISO(parseExactTime(this.initialStart, this.zone) + 300000, this.zone)).slice(0, 16);
    const propertiesEl = el.createDiv({ cls: 'sabidurian-time-fields' });
    const selects = new Map<string, HTMLSelectElement>();
    const required = new Set(this.options.required ?? []);
    const addSelect = (property: string, label: string, choices: string[]): void => {
      const field = propertiesEl.createEl('label', { text: required.has(property) ? `${label} (required)` : label });
      const select = field.createEl('select', { attr: { 'aria-label': property } });
      select.required = required.has(property);
      select.createEl('option', { value: '', text: 'Unassigned' });
      for (const value of new Set(choices.filter(value => value.trim()))) {
        select.createEl('option', { value, text: value });
      }
      select.value = '';
      selects.set(property, select);
    };
    addSelect('Dish', 'Dish', this.options.dishes);
    addSelect('Active Chef', 'Chef', this.options.chefs);
    addSelect('Oven Temp', 'Oven temp', this.options.ovens);
    const error = el.createEl('p', { cls: 'sabidurian-editor-error', attr: { role: 'alert' } });
    const actions = el.createDiv({ cls: 'sabidurian-editor-actions sabidurian-editor-footer' });
    const save = actions.createEl('button', { text: 'Create', cls: 'mod-cta' });
    const cancel = actions.createEl('button', { text: 'Cancel' }); cancel.onclick = () => this.close();
    save.onclick = async () => {
      try {
        const s = parseExactTime(start.value, this.zone), e = parseExactTime(end.value, this.zone);
        if (!name.value.trim() || e <= s) throw new Error('Enter a name and an end after start.');
        const properties: Record<string, string> = {};
        for (const [property, select] of selects) if (select.value) properties[property] = select.value;
        for (const property of required) {
          if (!properties[property]) {
            selects.get(property)?.focus();
            throw new Error(`Choose ${property === 'Active Chef' ? 'a chef' : property === 'Oven Temp' ? 'an oven temperature' : property.toLowerCase()} to keep this task visible in this view.`);
          }
        }
        save.disabled = true;
        await this.create(name.value.trim(), offsetISO(s, this.zone), offsetISO(e, this.zone), properties);
        this.close();
      } catch (e) { error.setText(String(e)); save.disabled = false; }
    };
  }
  onClose(): void { this.contentEl.empty(); }
}

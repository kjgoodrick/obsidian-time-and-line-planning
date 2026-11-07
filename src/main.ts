import { EditHistory } from './model/EditHistory';
import { Plugin } from 'obsidian';
import { SabidurianView } from './SabidurianView';
import { SequenceView } from './SequenceView';
import { getViewOptions } from './viewOptions';
import { getSequenceViewOptions } from './sequenceViewOptions';
import { SabidurianSettingTab, DEFAULT_SETTINGS, type SabidurianSettings } from './settings';
import { NativeTableColors } from './renderer/NativeTableColors';
import { getPropertyTone, normalizePropertyColors } from './utils/colorUtils';
import { CollaborationBridge } from './collaboration/CollaborationBridge';

const SABIDURIAN_VIEW_TYPE = 'sabidurian-timeline';
const SEQUENCE_VIEW_TYPE = 'sabidurian-sequence';

export default class SabidurianPlugin extends Plugin {
  readonly collaboration = new CollaborationBridge();
  colorSubscribers = new Set<() => void>();
  private tableColors = new Map<Document, NativeTableColors>();
  history!: EditHistory;
  settings: SabidurianSettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    await this.loadSettings();
    this.history = new EditHistory((file, mutate) => this.app.fileManager.processFrontMatter(file, mutate));
    this.registerEvent(this.app.workspace.on('time-and-line:collaboration-request', (receive: unknown) => {
      if (typeof receive === 'function') receive(this.collaboration);
    }));
    this.app.workspace.trigger('time-and-line:collaboration-ready', this.collaboration);

    // Timeline view (date-driven)
    this.registerBasesView(SABIDURIAN_VIEW_TYPE, {
      name: 'Timeline',
      icon: 'lucide-chart-gantt',
      factory: (controller, containerEl) =>
        new SabidurianView(controller, containerEl, this),
      options: getViewOptions,
    });

    // Sequence view (order-driven, no dates)
    this.registerBasesView(SEQUENCE_VIEW_TYPE, {
      name: 'Sequence',
      icon: 'lucide-chart-no-axes-gantt',
      factory: (controller, containerEl) =>
        new SequenceView(controller, containerEl, this),
      options: getSequenceViewOptions,
    });

    this.addSettingTab(new SabidurianSettingTab(this.app, this));
    const connectColors = (doc: Document) => {
      if (!this.tableColors.has(doc)) this.tableColors.set(doc, new NativeTableColors(doc.body,
        (property, value) => getPropertyTone(property, value, this.settings.propertyColors)));
    };
    connectColors(document);
    this.app.workspace.iterateAllLeaves(leaf => connectColors(leaf.view.containerEl.ownerDocument));
    this.registerEvent(this.app.workspace.on('window-open', (_win, window) => connectColors(window.document)));
    this.registerEvent(this.app.workspace.on('window-close', (_win, window) => {
      this.tableColors.get(window.document)?.destroy(); this.tableColors.delete(window.document);
    }));

    // Notify Style Settings plugin (if installed) to parse our CSS variables
    this.app.workspace.trigger('parse-style-settings');
  }

  onunload(): void {
    this.collaboration.dispose();
    for (const colors of this.tableColors.values()) colors.destroy();
    this.tableColors.clear(); this.colorSubscribers.clear();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.propertyColors = normalizePropertyColors(this.settings.propertyColors);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    for (const colors of this.tableColors.values()) colors.refresh();
    for (const update of this.colorSubscribers) update();
  }
}

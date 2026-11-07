/**
 * Sabidurian Timeline — Plugin Settings Tab
 *
 * Phase 7: Global plugin-level settings (separate from per-view Bases config).
 * F4: showBarProperties, barPropertyMinWidth
 * F5: markers array + MarkerModal
 */

import { App, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { COLOR_TONES, type PropertyColors } from './utils/colorUtils';

export interface SabidurianMarker {
  /** Device-local origin identity; never a shared discussion identity. */
  id?: string;
  label: string;
  /** Single date → vertical line. */
  date?: string;
  /** Range start → shaded band. */
  start?: string;
  /** Range end. */
  end?: string;
  /** CSS color or named color. */
  color: string;
  enabled: boolean;
}

export interface SabidurianSettings {
  /** Value colors are presentation only; the underlying properties stay editable. */
  propertyColors: PropertyColors;
  /** Day the week starts on: 0 = Sunday, 1 = Monday. */
  weekStart: number;
  /** Default frontmatter property name used for dependencies. */
  dependencyProperty: string;
  /** Maximum entries before showing a performance warning. */
  maxEntries: number;
  /** Automatically lock the timeline (prevent edits) on mobile/touch devices. */
  lockOnMobile: boolean;
  /** Show property badges on bars (when bar display props are configured). */
  showBarProperties: boolean;
  /** Minimum bar width (px) to show property badges. */
  barPropertyMinWidth: number;
  /** Frontmatter property name for per-note locking. */
  lockedProperty: string;
  /** Calendar markers (vertical lines or shaded bands). */
  markers: SabidurianMarker[];
}

export const DEFAULT_SETTINGS: SabidurianSettings = {
  propertyColors: {},
  weekStart: 1, // Monday
  dependencyProperty: 'blocked-by',
  maxEntries: 5000,
  lockOnMobile: false,
  showBarProperties: true,
  barPropertyMinWidth: 80,
  lockedProperty: 'locked',
  markers: [],
};

// ── Marker color palette (Obsidian-friendly names) ──
const MARKER_COLORS: Record<string, string> = {
  'Red': 'var(--color-red)',
  'Orange': 'var(--color-orange)',
  'Yellow': 'var(--color-yellow)',
  'Green': 'var(--color-green)',
  'Blue': 'var(--color-blue)',
  'Purple': 'var(--color-purple)',
  'Accent': 'var(--interactive-accent)',
  'Muted': 'var(--text-muted)',
};

export class SabidurianSettingTab extends PluginSettingTab {
  private plugin: Plugin & { settings: SabidurianSettings; saveSettings: () => Promise<void> };

  constructor(app: App, plugin: Plugin & { settings: SabidurianSettings; saveSettings: () => Promise<void> }) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Time & Line' });

    new Setting(containerEl)
      .setName('Week starts on')
      .setDesc('Which day of the week is treated as the first day.')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('0', 'Sunday')
          .addOption('1', 'Monday')
          .setValue(String(this.plugin.settings.weekStart))
          .onChange(async (value) => {
            this.plugin.settings.weekStart = parseInt(value, 10);
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Default dependency property')
      .setDesc('Frontmatter property name used to declare dependencies (e.g. blocked-by).')
      .addText((text) => {
        text
          .setPlaceholder('blocked-by')
          .setValue(this.plugin.settings.dependencyProperty)
          .onChange(async (value) => {
            this.plugin.settings.dependencyProperty = value.trim() || 'blocked-by';
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Max entries before warning')
      .setDesc('Show a performance warning when a Base exceeds this number of entries.')
      .addText((text) => {
        text
          .setPlaceholder('5000')
          .setValue(String(this.plugin.settings.maxEntries))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.maxEntries = num;
              await this.plugin.saveSettings();
            }
          });
      });

    new Setting(containerEl)
      .setName('Show property badges on bars')
      .setDesc('Display configured bar properties as compact badges. Properties are selected per-view in the Bases Configure panel.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.showBarProperties)
          .onChange(async (value) => {
            this.plugin.settings.showBarProperties = value;
            await this.plugin.saveSettings();
          });
      });

    containerEl.createEl('h3', { text: 'Property colors' });
    containerEl.createEl('p', { text: 'Use the same muted color for a value in timeline bars, badges and editable Bases tables.' });
    for (const [property, values] of Object.entries(this.plugin.settings.propertyColors)) {
      for (const [value, tone] of Object.entries(values)) {
        new Setting(containerEl).setName(value).setDesc(property)
          .addDropdown(dropdown => {
            for (const color of COLOR_TONES) dropdown.addOption(color, color[0].toUpperCase() + color.slice(1));
            dropdown.setValue(tone).onChange(async color => {
              values[value] = color as typeof tone; await this.plugin.saveSettings();
            });
          })
          .addExtraButton(button => button.setIcon('x').setTooltip('Remove color').onClick(async () => {
            delete values[value]; await this.plugin.saveSettings(); this.display();
          }));
      }
    }
    let newProperty = '', newValue = '';
    new Setting(containerEl).setName('Add a value color')
      .addText(text => text.setPlaceholder('Property, e.g. Dish').onChange(value => { newProperty = value.trim(); }))
      .addText(text => text.setPlaceholder('Exact property value').onChange(value => { newValue = value.trim(); }))
      .addButton(button => button.setButtonText('Add').onClick(async () => {
        if (!newProperty || !newValue) return;
        const colors = this.plugin.settings.propertyColors;
        if (!Object.prototype.hasOwnProperty.call(colors, newProperty)) Object.defineProperty(colors, newProperty, { value: {}, enumerable: true, configurable: true, writable: true });
        Object.defineProperty(colors[newProperty], newValue, { value: 'gray', enumerable: true, configurable: true, writable: true });
        await this.plugin.saveSettings(); this.display();
      }));

    new Setting(containerEl)
      .setName('Lock on mobile')
      .setDesc('Automatically lock the timeline on touch/mobile devices to prevent accidental edits.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.lockOnMobile)
          .onChange(async (value) => {
            this.plugin.settings.lockOnMobile = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Locked property name')
      .setDesc('Frontmatter property used to lock individual notes from drag/resize (e.g. locked).')
      .addText((text) => {
        text
          .setPlaceholder('locked')
          .setValue(this.plugin.settings.lockedProperty)
          .onChange(async (value) => {
            this.plugin.settings.lockedProperty = value.trim() || 'locked';
            await this.plugin.saveSettings();
          });
      });

    // ── Calendar Markers ──
    new Setting(containerEl).setName('Calendar markers').setHeading();

    const markers = this.plugin.settings.markers;
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i];
      const desc = marker.date
        ? marker.date
        : `${marker.start || '?'} → ${marker.end || '?'}`;

      const s = new Setting(containerEl);
      s.setName(marker.label || 'Untitled marker');
      s.setDesc(desc);
      s.addToggle((t) =>
        t.setValue(marker.enabled).onChange(async (v) => {
          marker.enabled = v;
          await this.plugin.saveSettings();
        }),
      );
      s.addExtraButton((btn) =>
        btn.setIcon('pencil').setTooltip('Edit').onClick(() => {
          new MarkerModal(this.app, this.plugin, marker, i).open();
        }),
      );
      s.addExtraButton((btn) =>
        btn.setIcon('trash').setTooltip('Delete').onClick(async () => {
          markers.splice(i, 1);
          await this.plugin.saveSettings();
          this.display();
        }),
      );
    }

    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText('Add marker').setCta().onClick(() => {
        new MarkerModal(this.app, this.plugin, null, -1).open();
      }),
    );
  }
}

/**
 * Modal for creating/editing a calendar marker.
 */
class MarkerModal extends Modal {
  private plugin: Plugin & { settings: SabidurianSettings; saveSettings: () => Promise<void> };
  private marker: SabidurianMarker | null;
  private index: number;
  private original: string;

  private label = '';
  private markerType: 'line' | 'band' = 'line';
  private date = '';
  private start = '';
  private end = '';
  private color = 'var(--color-blue)';

  constructor(
    app: App,
    plugin: Plugin & { settings: SabidurianSettings; saveSettings: () => Promise<void> },
    marker: SabidurianMarker | null,
    index: number,
  ) {
    super(app);
    this.plugin = plugin;
    this.marker = marker;
    this.index = index;
    this.original = JSON.stringify(marker);

    if (marker) {
      this.label = marker.label;
      this.color = marker.color;
      if (marker.date) {
        this.markerType = 'line';
        this.date = marker.date;
      } else {
        this.markerType = 'band';
        this.start = marker.start || '';
        this.end = marker.end || '';
      }
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: this.marker ? 'Edit Marker' : 'Add Marker' });

    new Setting(contentEl)
      .setName('Label')
      .addText((t) =>
        t.setValue(this.label).setPlaceholder('Sprint 5').onChange((v) => {
          this.label = v;
        }),
      );

    new Setting(contentEl)
      .setName('Type')
      .addDropdown((d) =>
        d
          .addOption('line', 'Vertical line (single date)')
          .addOption('band', 'Shaded band (date range)')
          .setValue(this.markerType)
          .onChange((v) => {
            this.markerType = v as 'line' | 'band';
            this.renderDateFields(contentEl);
          }),
      );

    // Date field container
    const dateContainer = contentEl.createDiv({ cls: 'sabidurian-marker-date-fields' });
    this.renderDateFields(contentEl);

    new Setting(contentEl)
      .setName('Color')
      .addDropdown((d) => {
        for (const [name, val] of Object.entries(MARKER_COLORS)) {
          d.addOption(val, name);
        }
        d.setValue(this.color).onChange((v) => {
          this.color = v;
        });
      });

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText('Save')
        .setCta()
        .onClick(async () => {
          const newMarker: SabidurianMarker = {
            id: this.marker?.id ?? crypto.randomUUID(),
            label: this.label || 'Untitled',
            color: this.color,
            enabled: true,
          };

          if (this.markerType === 'line') {
            newMarker.date = this.date;
          } else {
            newMarker.start = this.start;
            newMarker.end = this.end;
          }

          if (this.marker && this.index >= 0) {
            const matches = this.plugin.settings.markers.filter(value => value.id === this.marker!.id);
            if (!this.marker.id || matches.length !== 1 || JSON.stringify(matches[0]) !== this.original) {
              new Notice('This marker changed. Reopen it before saving.'); return;
            }
            this.plugin.settings.markers[this.plugin.settings.markers.indexOf(matches[0])] = newMarker;
          } else {
            this.plugin.settings.markers.push(newMarker);
          }

          await this.plugin.saveSettings();
          this.close();

          // Refresh settings tab if it's open
          const settingTab = (this.plugin.app as any).setting?.activeTab;
          if (settingTab instanceof SabidurianSettingTab) {
            settingTab.display();
          }
        }),
    );
  }

  private renderDateFields(contentEl: HTMLElement): void {
    // Remove previous date fields
    contentEl.querySelectorAll('.sabidurian-marker-date-field').forEach((el) => el.remove());

    if (this.markerType === 'line') {
      const s = new Setting(contentEl);
      s.settingEl.classList.add('sabidurian-marker-date-field');
      s.setName('Date').setDesc('e.g. 2025-07-01, -500, 1066');
      s.addText((t) =>
        t.setValue(this.date).setPlaceholder('2025-07-01').onChange((v) => {
          this.date = v;
        }),
      );
    } else {
      const s1 = new Setting(contentEl);
      s1.settingEl.classList.add('sabidurian-marker-date-field');
      s1.setName('Start date');
      s1.addText((t) =>
        t.setValue(this.start).setPlaceholder('2025-07-01').onChange((v) => {
          this.start = v;
        }),
      );

      const s2 = new Setting(contentEl);
      s2.settingEl.classList.add('sabidurian-marker-date-field');
      s2.setName('End date');
      s2.addText((t) =>
        t.setValue(this.end).setPlaceholder('2025-07-14').onChange((v) => {
          this.end = v;
        }),
      );
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

import { Setting } from 'obsidian';
import type { PluginUpdater } from './PluginUpdater';

export function renderPluginUpdates(updates: HTMLElement, updater: PluginUpdater): () => void {
  return updater.subscribe(state => {
        updates.empty();
        updates.createEl('h3', {text: 'Plugin updates'});
        new Setting(updates).setName('Automatic update checks')
          .setDesc('Check this planning fork’s GitHub releases daily. Installation is always your choice.')
          .addToggle(toggle => toggle.setValue(state.automatic).setDisabled(state.busy)
            .onChange(value => updater.setAutomatic(value)));
        new Setting(updates).setName(`Installed version: ${state.currentVersion}`)
          .setDesc(state.error || state.message)
          .addButton(button => button.setButtonText('Check for updates')
            .setDisabled(state.busy || !!state.installedVersion).onClick(() => updater.check()));
        if (state.release && !state.installedVersion) {
          new Setting(updates).setName(`Version ${state.release.version}${state.release.prerelease ? ' (preview)' : ''}`)
            .setDesc('Verifies downloads and preserves your settings. Restart Obsidian after installation.')
            .addButton(button => button.setButtonText(`Update to ${state.release!.version}`).setCta()
              .setDisabled(state.busy).onClick(() => updater.install()));
          updates.createEl('a', {text: 'Release notes', href: state.release.url});
        }
      });
}

import type { App } from 'obsidian';

export type TaskIcon = { kind: 'emoji'; value: string } | { kind: 'image'; url: string };

/** Emoji or a vault-local image link. Remote URLs are never loaded as icons. */
export function resolveTaskIcon(value: unknown, app: App, sourcePath: string): TaskIcon | undefined {
  if (typeof value !== 'string' || !value.trim()) return;
  const text = value.trim();
  const link = text.match(/^!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/);
  if (link) {
    if (!/\.(png|jpe?g|gif|webp|avif)$/i.test(link[1]) || /(?:^[a-z]+:|^\/\/)/i.test(link[1])) return;
    const file = app.metadataCache.getFirstLinkpathDest(link[1], sourcePath);
    if (file) return { kind: 'image', url: app.vault.getResourcePath(file) };
    return;
  }
  if (text.length <= 32 && /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(text) && !/[<>:/]/.test(text))
    return { kind: 'emoji', value: text };
}

/** Do not repeat an emoji already embedded in the task's title. */
export function iconLabel(label: string, icon?: TaskIcon): string {
  return icon?.kind === 'emoji' && !label.trimStart().startsWith(icon.value) ? `${icon.value} ${label}` : label;
}

/** Image icons are decorative; the adjacent task label remains accessible. */
export function prependTaskImage(element: HTMLElement, icon?: TaskIcon): void {
  if (icon?.kind !== 'image') return;
  const image = element.ownerDocument.createElement('img');
  image.className = 'sabidurian-task-icon'; image.src = icon.url;
  image.alt = ''; image.draggable = false;
  element.prepend(image);
}

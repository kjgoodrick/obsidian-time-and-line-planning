/** Muted, theme-aware colors shared by bars and editable property values. */
export const COLOR_TONES = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;
export type ColorTone = typeof COLOR_TONES[number];
export type PropertyColors = Record<string, Record<string, ColorTone>>;

/** Settings files may outlive old plugin versions or be edited by hand. */
export function normalizePropertyColors(value: unknown): PropertyColors {
  const result: PropertyColors = Object.create(null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [property, entries] of Object.entries(value)) {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
    const values: Record<string, ColorTone> = Object.create(null);
    for (const [name, tone] of Object.entries(entries)) {
      if (COLOR_TONES.includes(tone as ColorTone)) values[name] = tone as ColorTone;
    }
    result[property] = values;
  }
  return result;
}

export function getPropertyTone(property: string, value: string, colors: PropertyColors = {}): ColorTone | undefined {
  const tone = colors?.[property.replace(/^note\./, '')]?.[value.trim()];
  return COLOR_TONES.includes(tone) ? tone : undefined;
}

export function getColorForValue(value: string | null | undefined, property = '', colors: PropertyColors = {}): string {
  const trimmed = value?.trim() ?? '';
  const tone = getPropertyTone(property, trimmed, colors);
  if (tone) return `var(--sabidurian-tone-${tone})`;
  // Preserve upstream support for explicitly supplied hex colors.
  if (/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) return '#' + trimmed.replace(/^#/, '');
  if (!trimmed) return 'var(--sabidurian-tone-gray)';
  let hash = 0;
  for (const char of trimmed.toLowerCase()) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return `var(--sabidurian-tone-${COLOR_TONES[Math.abs(hash) % COLOR_TONES.length]})`;
}

export function getHoverFilter(): string { return 'brightness(1.08)'; }
export function resetColorCache(): void { /* Mapping is stateless and stable across sessions. */ }

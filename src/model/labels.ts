export function fullLabel(label: string, properties: Record<string, string>, order: string[]): string {
  return [label, ...order.map(key => properties[key]).filter(value => value && value !== 'null')].join(' · ');
}
export function labelWidth(text: string): number { return Array.from(text).length * 8 + 20; }
export function dependencyLinks(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return [...new Set(value.flatMap(dependencyLinks))];
  const text = String(value);
  const matches = [...text.matchAll(/\[\[([^\]]+)\]\]/g)];
  return [...new Set(matches.length ? matches.map(m => m[1].split('|')[0].split('#')[0]) : [text.trim()].filter(Boolean))];
}

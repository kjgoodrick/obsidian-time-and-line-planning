import type { BasesViewConfig } from 'obsidian';
import { NumericAxis } from '../scale/NumericAxis';
import { axisToWallMs, instantToWallMs, offsetISO, wallMsToAxis, wallToInstant } from '../utils/timezone';
import { parseTimelineRange, validateTimelineTimeZone, type HistoricalPoint, type TimelineRange } from './TimelineRange';

export type RangeKind = TimelineRange['kind'];
type Property = { source: 'note' | 'file' | 'formula'; name: string };
export interface RangeAxis {
  version: 1; renderer: 'sabidurian-timeline' | 'sabidurian-sequence';
  start_property: Property; end_property: Property | null; time_zone: string | null;
}
export interface RangeState {
  axis: NumericAxis; config: BasesViewConfig; renderer: RangeAxis['renderer'];
  svg: SVGSVGElement; viewport: HTMLElement; timeZone?: string; denseValues?: readonly number[] | null;
}
export interface RangeContext {
  axis: RangeAxis; effectiveTimeZone: string | null; kinds: readonly RangeKind[]; current(): boolean;
}
export interface RangeDraft { draft?: Record<string, unknown>; issue?: string }
export interface RangeSelection extends RangeDraft { context: RangeContext; current(): boolean }
export interface ProjectedRange { start: number; end: number; discontinuous: boolean }

const leap = (year: number) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
const monthDays = (year: number, month: number) => month === 2 ? leap(year) ? 29 : 28 : [4, 6, 9, 11].includes(month) ? 30 : 31;
const scale = BigInt(1_000_000_000);
function decimal(value: string): bigint {
  if (!/^-?[0-9]{1,21}(?:\.[0-9]{1,9})?$/.test(value)) throw new Error('Sequence precision is unavailable.');
  const [whole, fraction = ''] = (value.startsWith('-') ? value.slice(1) : value).split('.');
  const absolute = BigInt(whole) * scale + BigInt(fraction.padEnd(9, '0'));
  return value.startsWith('-') ? -absolute : absolute;
}
function numberDecimal(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e21) throw new Error('Sequence coordinate is unavailable.');
  return value.toFixed(9);
}
function property(value: unknown): Property | null {
  if (typeof value !== 'string' || !value || value.length > 264 || /[\u0000-\u001f\ud800-\udfff]/u.test(value)) return null;
  const match = value.match(/^(note|file|formula)\.(.+)$/);
  const name = match ? match[2] : value;
  return name.length <= 256 ? { source: match ? match[1] as Property['source'] : 'note', name } : null;
}
export function axisDescriptor(state: Pick<RangeState, 'config' | 'renderer'>): RangeAxis | undefined {
  const sequence = state.renderer === 'sabidurian-sequence';
  const start = property(state.config.get(sequence ? 'orderProp' : 'startDateProp'));
  const rawEnd = state.config.get(sequence ? 'orderEndProp' : 'endDateProp');
  const end = rawEnd == null || rawEnd === '' ? null : property(rawEnd);
  if (!start || rawEnd != null && rawEnd !== '' && !end) return;
  const rawZone = sequence ? null : state.config.get('timeZone') || null;
  try {
    const time_zone = rawZone === null ? null : validateTimelineTimeZone(rawZone);
    return { version: 1, renderer: state.renderer, start_property: start, end_property: end, time_zone };
  } catch { return; }
}
/** Fixed ordered keys; caller JSON property order is irrelevant. */
export function axisKey(axis: RangeAxis): string {
  const prop = (value: Property | null) => value ? [value.source, value.name] : null;
  return JSON.stringify([axis.version, axis.renderer, prop(axis.start_property), prop(axis.end_property), axis.time_zone]);
}
export function rangeContext(read: () => RangeState | undefined): RangeContext | undefined {
  const state = read(); if (!state || !state.svg.isConnected || !state.viewport.contains(state.svg)) return;
  const axis = axisDescriptor(state); if (!axis) return;
  const effectiveTimeZone = axis.renderer === 'sabidurian-sequence' ? null : state.timeZone ?? axis.time_zone;
  try { if (axis.renderer !== 'sabidurian-sequence') validateTimelineTimeZone(effectiveTimeZone); } catch { return; }
  const key = axisKey(axis), bounds = [state.axis.viewStart, state.axis.viewEnd, state.axis.totalWidth];
  if (!bounds.every(Number.isFinite) || bounds[1] <= bounds[0] || bounds[2] <= 0) return;
  Object.freeze(axis.start_property); if (axis.end_property) Object.freeze(axis.end_property); Object.freeze(axis);
  const kinds: readonly RangeKind[] = Object.freeze(axis.renderer === 'sabidurian-sequence' ? ['ordinal'] : ['calendar', 'instant', 'historical']);
  return { axis, effectiveTimeZone, kinds, current: () => {
    const now = read(), descriptor = now && axisDescriptor(now);
    return !!now && now.svg === state.svg && now.svg.isConnected && now.viewport === state.viewport && now.viewport.contains(now.svg) &&
      now.axis === state.axis && now.axis.viewStart === bounds[0] && now.axis.viewEnd === bounds[1] && now.axis.totalWidth === bounds[2] &&
      now.denseValues === state.denseValues && (now.timeZone ?? descriptor?.time_zone ?? null) === (state.timeZone ?? axis.time_zone ?? null) &&
      !!descriptor && axisKey(descriptor) === key;
  } };
}

/** Gregorian period boundaries, including negative/large years, without Date. */
function civil(year: number, month = 1, day = 1): number {
  let ordinal = day - 1;
  for (let i = 1; i < month; i++) ordinal += monthDays(year, i);
  return year + ordinal / (leap(year) ? 366 : 365);
}
function historicalPeriod(point: HistoricalPoint): [number, number] {
  if (point.precision === 'year') return [point.year, point.year + 1];
  const start = civil(point.year, point.month, 'day' in point ? point.day : 1);
  return [start, point.precision === 'month' ? civil(point.year, point.month + 1) : civil(point.year, point.month, point.day + 1)];
}
function calendarPeriod(value: string): [number, number] {
  const [year, month, day] = value.split('-').map(Number);
  return [civil(year, month, day), civil(year, month, day + 1)];
}
/** Exact decimal differences before converting a dimensionless pixel ratio. */
export function ordinalPixel(value: string, state: Pick<RangeState, 'axis' | 'denseValues'>): number {
  const target = decimal(value), dense = state.denseValues;
  if (dense) {
    if (!dense.length || dense.length > 20_000) throw new Error('Sequence value is outside the dense view.');
    let low = 0, high = dense.length - 1;
    const at = (index: number) => decimal(numberDecimal(dense[index]));
    if (target < at(low) || target > at(high)) throw new Error('Sequence value is outside the dense view.');
    while (low < high) { const middle = Math.floor((low + high) / 2); if (at(middle) < target) low = middle + 1; else high = middle; }
    if (at(low) === target) return state.axis.yearToPixel(low + 1);
    const before = at(low - 1), after = at(low);
    if (after <= before) throw new Error('Sequence mapping is ambiguous.');
    return state.axis.yearToPixel(low + Number(target - before) / Number(after - before));
  }
  const start = decimal(numberDecimal(state.axis.viewStart)), end = decimal(numberDecimal(state.axis.viewEnd));
  if (end <= start) throw new Error('Sequence precision is unavailable.');
  return Number(target - start) / Number(end - start) * state.axis.totalWidth;
}
function checkedRange(input: unknown, state: RangeState, expected: RangeAxis): TimelineRange {
  const range = parseTimelineRange(input), descriptor = axisDescriptor(state);
  if (!descriptor || axisKey(descriptor) !== axisKey(expected) || (state.renderer === 'sabidurian-sequence') !== (range.kind === 'ordinal')) throw new Error('The timeline axis changed.');
  const zone = state.timeZone ?? descriptor.time_zone;
  if ('time_zone' in range && descriptor.time_zone !== null && range.time_zone !== descriptor.time_zone) throw new Error('The range uses a different timezone.');
  if (range.kind === 'calendar' && range.time_zone !== zone) throw new Error('The calendar range uses a different timezone.');
  return range;
}
/** Semantic axis coordinates for choosing a temporary viewport. Ordinal values
 * here only choose representable outer bounds; projection retains exact decimals. */
export function rangeExtent(input: unknown, state: RangeState, expected: RangeAxis): ProjectedRange {
  const range = checkedRange(input, state, expected);
  if (range.kind === 'ordinal') return { start: Number(range.start), end: Number(range.end), discontinuous: false };
  let start: number, end: number, discontinuous = false;
  if (range.kind === 'instant') {
    const zone = state.timeZone ?? axisDescriptor(state)?.time_zone;
    validateTimelineTimeZone(zone);
    const a = Date.parse(range.start), b = Date.parse(range.end), wallA = instantToWallMs(a, zone!), wallB = instantToWallMs(b, zone!);
    start = wallMsToAxis(wallA); end = wallMsToAxis(wallB);
    // A civil axis folds/repeats time at DST. Return endpoint geometry and an
    // explicit discontinuity, never pretend its width is elapsed UTC duration.
    discontinuous = wallB - wallA !== b - a;
  } else {
    const a = range.kind === 'historical' ? historicalPeriod(range.start) : calendarPeriod(range.start);
    const b = range.kind === 'historical' ? historicalPeriod(range.end) : calendarPeriod(range.end);
    start = a[range.start_inclusive ? 0 : 1]; end = b[range.end_inclusive ? 1 : 0];
  }
  return { start, end, discontinuous };
}
export function projectRange(input: unknown, state: RangeState, expected: RangeAxis): ProjectedRange {
  const range = checkedRange(input, state, expected);
  if (range.kind === 'ordinal') return { start: ordinalPixel(range.start, state), end: ordinalPixel(range.end, state), discontinuous: false };
  const extent = rangeExtent(range, state, expected);
  const output = { start: state.axis.yearToPixel(extent.start), end: state.axis.yearToPixel(extent.end), discontinuous: extent.discontinuous };
  if (![output.start, output.end].every(Number.isFinite)) throw new Error('Range geometry is unavailable.');
  return output;
}

function historicalAt(value: number, precision: HistoricalPoint['precision']): HistoricalPoint {
  const year = Math.floor(value);
  if (precision === 'year') return { precision, year };
  let days = Math.max(0, Math.min((leap(year) ? 366 : 365) - 1, Math.floor((value - year) * (leap(year) ? 366 : 365) + 1e-7))), month = 1;
  while (month < 12 && days >= monthDays(year, month)) { days -= monthDays(year, month); month++; }
  return precision === 'month' ? { precision, year, month } : { precision, year, month, day: days + 1 };
}
export function draftRange(start: number, end: number, state: RangeState, kind: RangeKind, precision: HistoricalPoint['precision'] = 'day'): RangeDraft {
  const bounds = { version: 1, kind, start_inclusive: true, end_inclusive: true };
  if (end < start) [start, end] = [end, start];
  try {
    let draft: Record<string, unknown>;
    if (kind === 'ordinal') {
      const ordinal = (value: number) => {
        if (!state.denseValues) return numberDecimal(value);
        const index = Math.round(value) - 1;
        if (index < 0 || index >= state.denseValues.length) throw new Error('Select an occupied Sequence position or enter exact values.');
        return numberDecimal(state.denseValues[index]);
      };
      draft = { ...bounds, start: ordinal(start), end: ordinal(end), unit: 'property-value' };
    } else if (kind === 'historical') draft = { ...bounds, start: historicalAt(start, precision), end: historicalAt(end, precision), calendar: 'proleptic-gregorian', year_numbering: 'astronomical' };
    else {
      const zone = validateTimelineTimeZone(state.timeZone ?? axisDescriptor(state)?.time_zone);
      const format = (value: number) => {
        const point = historicalAt(value, 'day') as Extract<HistoricalPoint, { precision: 'day' }>;
        if (point.year < 1 || point.year > 9999) throw new Error('Use historical dates for this interval.');
        return `${String(point.year).padStart(4, '0')}-${String(point.month).padStart(2, '0')}-${String(point.day).padStart(2, '0')}`;
      };
      if (kind === 'calendar') draft = { ...bounds, start: format(start), end: format(end), time_zone: zone };
      else {
        let issue: string | undefined;
        const exact = (value: number) => {
          format(value);
          const wall = axisToWallMs(value);
          try { return offsetISO(wallToInstant(wall, zone), zone); }
          catch (error) { issue = error instanceof Error ? error.message : 'Enter an explicit UTC offset.'; return new Date(wall).toISOString().slice(0, -1); }
        };
        draft = { ...bounds, start: exact(start), end: exact(end), time_zone: zone };
        if (issue) return { draft, issue };
      }
    }
    return { draft: parseTimelineRange(draft) as unknown as Record<string, unknown> };
  } catch (error) { return { issue: error instanceof Error ? error.message : 'Enter a valid interval.' }; }
}

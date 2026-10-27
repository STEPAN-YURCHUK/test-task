import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDate, formatRelative, formatSize } from './format';

describe('formatSize', () => {
  it.each([
    [0, '0 Б'],
    [1023, '1023 Б'],
    [1024, '1.0 КБ'],
    [1536, '1.5 КБ'],
    [1024 * 1024 - 1, '1.0 МБ'],
    [1048525, '1.0 МБ'],
    [1048524, '1023.9 КБ'],
    [1024 * 1024, '1.0 МБ'],
    [5.5 * 1024 * 1024, '5.5 МБ'],
  ])('%i → %s', (bytes, expected) => {
    expect(formatSize(bytes)).toBe(expected);
  });
});

describe('formatDate', () => {
  it('формат dd.mm.yy в HH:MM', () => {
    expect(formatDate('2026-10-26T15:04:00')).toBe('26.10.26 в 15:04');
  });
});

describe('formatRelative', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-26T12:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['2026-10-26T11:59:30', 'только что'],
    ['2026-10-26T11:59:00', '1 мин назад'],
    ['2026-10-26T11:01:00', '59 мин назад'],
    ['2026-10-26T11:00:00', '1 ч назад'],
    ['2026-10-25T12:00:01', '23 ч назад'],
    ['2026-10-25T12:00:00', '25.10.26 в 12:00'],
  ])('%s → %s', (iso, expected) => {
    expect(formatRelative(iso)).toBe(expected);
  });
});

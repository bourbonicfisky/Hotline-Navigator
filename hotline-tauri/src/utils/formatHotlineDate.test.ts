import { expect, it } from 'vitest';
import { formatHotlineDate } from './formatHotlineDate';

it.each(['en-US', 'en-GB', 'de-DE', undefined])('uses the date order and clock of %s', (locale) => {
  const value = '2026-07-15T13:30:00Z';
  expect(formatHotlineDate(value, locale)).toBe(new Intl.DateTimeFormat(locale, {
    dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(value)));
});
it('does not reinterpret legacy cached dates or fail on invalid dates', () => {
  expect(formatHotlineDate('7/15/2026 1:30 PM', 'en-GB')).toBe('7/15/2026 1:30 PM');
  expect(formatHotlineDate('2026-99-99T13:30:00Z')).toBe('2026-99-99T13:30:00Z');
});

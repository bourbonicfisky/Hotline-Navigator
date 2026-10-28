/** Format protocol timestamps using the system locale, clock, and time zone. */
export function formatHotlineDate(value: string, locales?: Intl.LocalesArgument): string {
  // Preserve legacy cached display strings instead of ambiguously parsing them.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locales, { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

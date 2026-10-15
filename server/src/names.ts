/** "ravi  patel" → "Ravi Patel". Capitalises the first letter of each part of a name and leaves the other letters as typed (so "McDonald" survives). */
export function titleCase(s: string): string {
  return s.trim().replace(/\s+/g, ' ').replace(/(^|[\s'’-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
}
/** Splits a full name into first word and the rest (for accounts made before first/last names were kept apart). */
export function splitName(full: string): { first: string; last: string } {
  const t = full.trim().replace(/\s+/g, ' ');
  const i = t.indexOf(' ');
  return i < 0 ? { first: t, last: '' } : { first: t.slice(0, i), last: t.slice(i + 1) };
}

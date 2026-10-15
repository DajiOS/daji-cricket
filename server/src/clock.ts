// All "now" reads go through here so tests can freeze and move time.
let fixed: number | null = null;

export const now = (): number => (fixed ?? Date.now());
export function setNow(ms: number): void {
  fixed = ms;
}
export function advance(ms: number): number {
  fixed = (fixed ?? Date.now()) + ms;
  return fixed;
}
export function resetClock(): void {
  fixed = null;
}
/** Wed 14 Oct 2026 10:00 IST — the reference instant used by tests and the demo seed. */
export const T0 = Date.UTC(2026, 9, 14, 4, 30, 0);

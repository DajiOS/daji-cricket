import { HOUR, istDate, istMidnight } from './time.ts';

// The website's design changes by itself through the day, to suit the light at the ground: the bright daytime designs in the
// morning, warmer ones in the afternoon, the stadium looks as the floodlights come on, and the floodlit night designs after
// dark (India time). Inside each part of the day the design moves on by one every day, so a regular visitor sees all ten.
// The owner can switch this off and keep one design instead (Settings, Website). Festival days still come first, and a
// visitor who picked a design on the theme button keeps it. Which designs take part comes from the quarter's design pack
// (packs.ts); the bands below are the first pack's.

/** The ten designer themes of the first pack, as the website names them. */
export const DESIGNS = ['noir', 'pavilion', 'whites', 'pinkball', 'monsoon', 'maroon', 'carbon', 'champagne', 'stadium', 'willow'] as const;

export interface Band { from: number; name: string; designs: readonly string[] }
/** Parts of the day (India time, from this hour until the next part) and the designs shown in each. */
export const DESIGN_BANDS: Band[] = [
  { from: 6, name: 'Morning', designs: ['whites', 'champagne', 'pavilion'] },
  { from: 11, name: 'Afternoon', designs: ['willow', 'monsoon', 'maroon'] },
  { from: 17, name: 'Evening', designs: ['stadium', 'carbon'] },
  { from: 20, name: 'Night', designs: ['noir', 'pinkball'] },
];

const dayNumber = (date: string): number => Math.round(istMidnight(date) / (24 * HOUR));

/** The design for a moment: the part of the day picks the group, the date picks the design in it. */
export function rotatingDesign(ms: number, bands: readonly Band[] = DESIGN_BANDS): { design: string; band: string; until: number } {
  const date = istDate(ms), hour = Math.floor((ms - istMidnight(date)) / HOUR);
  // before 6 am still counts as the night that began the evening before
  let i = bands.length - 1;
  for (let k = bands.length - 1; k >= 0; k--) if (hour >= bands[k]!.from) { i = k; break; }
  const band = bands[i]!, night = hour < bands[0]!.from;
  const day = dayNumber(date) - (night ? 1 : 0);
  const next = i + 1 < bands.length ? istMidnight(date) + bands[i + 1]!.from * HOUR : istMidnight(date) + (night ? 0 : 24 * HOUR) + bands[0]!.from * HOUR;
  return { design: band.designs[((day % band.designs.length) + band.designs.length) % band.designs.length]!, band: band.name, until: next };
}

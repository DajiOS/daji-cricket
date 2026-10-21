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

/** How often the design changes: in every part of the day (four times a day), once a day, or once a week. */
export const DESIGN_PACES = ['daypart', 'daily', 'weekly'] as const;
export type DesignPace = (typeof DESIGN_PACES)[number];

/** The design for a moment: the part of the day picks the group, the date picks the design in it. Daily and weekly go through all
 *  the pack's designs in turn, changing at 6 am (on Mondays for weekly). */
export function rotatingDesign(ms: number, bands: readonly Band[] = DESIGN_BANDS, pace: DesignPace = 'daypart'): { design: string; band: string; until: number } {
  const date = istDate(ms), hour = Math.floor((ms - istMidnight(date)) / HOUR);
  if (pace !== 'daypart') {
    const all = bands.flatMap((b) => [...b.designs]), start = bands[0]!.from;
    const day = dayNumber(date) - (hour < start ? 1 : 0); // the day begins at 6 am
    const dayStart = istMidnight(date) + (hour < start ? -24 * HOUR : 0) + start * HOUR;
    if (pace === 'daily') return { design: all[((day % all.length) + all.length) % all.length]!, band: 'Today', until: dayStart + 24 * HOUR };
    // day 0 (1 January 1970) was a Thursday, so Monday is day 4 of each run of seven
    const sinceMonday = (((day - 4) % 7) + 7) % 7, week = Math.floor((day - 4) / 7);
    return { design: all[((week % all.length) + all.length) % all.length]!, band: 'This week', until: dayStart + (7 - sinceMonday) * 24 * HOUR };
  }
  // before 6 am still counts as the night that began the evening before
  let i = bands.length - 1;
  for (let k = bands.length - 1; k >= 0; k--) if (hour >= bands[k]!.from) { i = k; break; }
  const band = bands[i]!, night = hour < bands[0]!.from;
  const day = dayNumber(date) - (night ? 1 : 0);
  const next = i + 1 < bands.length ? istMidnight(date) + bands[i + 1]!.from * HOUR : istMidnight(date) + (night ? 0 : 24 * HOUR) + bands[0]!.from * HOUR;
  return { design: band.designs[((day % band.designs.length) + band.designs.length) % band.designs.length]!, band: band.name, until: next };
}

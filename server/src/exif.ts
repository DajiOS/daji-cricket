// A small reader for the camera details inside a JPEG: when the photo was taken, and with what camera.
// Only what the task check needs. It never trusts a length it has not bounds-checked.

export interface ExifInfo {
  /** Epoch ms of the shot, read from DateTimeOriginal (falling back to DateTimeDigitized, then DateTime). Null when the photo has none. */
  takenAt: number | null;
  /** True when the time carried its own UTC offset; otherwise the clock of the phone is taken to be India time. */
  hadOffset: boolean;
  make: string | null;
  model: string | null;
}

const IST_MIN = 330;

function ascii(b: Buffer, start: number, len: number): string | null {
  if (start < 0 || len <= 0 || start + len > b.length) return null;
  return b.toString('latin1', start, start + len).replace(/\0.*$/s, '').trim();
}

/** "2026:10:15 13:05:09" + optional "+05:30" → epoch ms. */
export function parseExifTime(text: string | null, offset: string | null): { ms: number; hadOffset: boolean } | null {
  if (!text) return null;
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59 || y < 2000) return null;
  let offMin = IST_MIN, hadOffset = false;
  const o = offset ? /^([+-])(\d{2}):(\d{2})$/.exec(offset) : null;
  if (o) { offMin = (o[1] === '-' ? -1 : 1) * (Number(o[2]) * 60 + Number(o[3])); hadOffset = true; }
  return { ms: Date.UTC(y, mo - 1, d, h, mi, s) - offMin * 60_000, hadOffset };
}

export function readExif(b: Buffer): ExifInfo {
  const none: ExifInfo = { takenAt: null, hadOffset: false, make: null, model: null };
  if (b.length < 12 || b[0] !== 0xff || b[1] !== 0xd8) return none;
  // find the APP1 segment that starts with "Exif\0\0"
  let p = 2, tiff = -1;
  while (p + 4 <= b.length && b[p] === 0xff) {
    const marker = b[p + 1]!;
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end: no more headers
    const len = b.readUInt16BE(p + 2);
    if (len < 2) break;
    if (marker === 0xe1 && p + 10 <= b.length && b.toString('latin1', p + 4, p + 10) === 'Exif\0\0') { tiff = p + 10; break; }
    p += 2 + len;
  }
  if (tiff < 0 || tiff + 8 > b.length) return none;
  const order = b.toString('latin1', tiff, tiff + 2);
  if (order !== 'II' && order !== 'MM') return none;
  const le = order === 'II';
  const u16 = (o: number) => (o >= 0 && o + 2 <= b.length ? (le ? b.readUInt16LE(o) : b.readUInt16BE(o)) : 0);
  const u32 = (o: number) => (o >= 0 && o + 4 <= b.length ? (le ? b.readUInt32LE(o) : b.readUInt32BE(o)) : 0);
  if (u16(tiff + 2) !== 42) return none;

  type Entry = { type: number; count: number; valueAt: number };
  /** Reads one directory into a tag → entry map. */
  const ifd = (off: number): Map<number, Entry> => {
    const out = new Map<number, Entry>();
    const at = tiff + off;
    if (off <= 0 || at + 2 > b.length) return out;
    const n = Math.min(u16(at), 200);
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      if (e + 12 > b.length) break;
      const type = u16(e + 2), count = u32(e + 4);
      const size = ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 } as Record<number, number>)[type] ?? 1;
      const valueAt = size * count <= 4 ? e + 8 : tiff + u32(e + 8);
      out.set(u16(e), { type, count, valueAt });
    }
    return out;
  };
  const text = (m: Map<number, Entry>, tag: number): string | null => { const e = m.get(tag); return e && e.type === 2 ? ascii(b, e.valueAt, e.count) : null; };

  const root = ifd(u32(tiff + 4));
  const sub = root.get(0x8769) ? ifd(u32(root.get(0x8769)!.valueAt)) : new Map<number, Entry>();
  const t = parseExifTime(text(sub, 0x9003), text(sub, 0x9011)) ?? parseExifTime(text(sub, 0x9004), text(sub, 0x9012)) ?? parseExifTime(text(root, 0x0132), text(sub, 0x9010));
  return { takenAt: t ? t.ms : null, hadOffset: t ? t.hadOffset : false, make: text(root, 0x010f), model: text(root, 0x0110) };
}

import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

// Just enough ZIP to read and write .xlsx files without a dependency.
// Reading is defensive: the bytes come from an upload, so sizes and counts are capped (zip bombs).

export class ZipError extends Error {}

export interface ZipLimits { maxEntries: number; maxEntryBytes: number; maxTotalBytes: number }
const DEFAULT_LIMITS: ZipLimits = { maxEntries: 2000, maxEntryBytes: 80 * 1024 * 1024, maxTotalBytes: 200 * 1024 * 1024 };

interface CentralEntry { name: string; method: number; crc: number; compSize: number; size: number; offset: number; flags: number }

export class ZipReader {
  private readonly entries = new Map<string, CentralEntry>();
  private total = 0;
  private readonly buf: Buffer;
  private readonly limits: ZipLimits;
  constructor(buf: Buffer, limits: ZipLimits = DEFAULT_LIMITS) {
    this.buf = buf;
    this.limits = limits;
    this.readDirectory();
  }

  private readDirectory(): void {
    const b = this.buf;
    if (b.length < 22) throw new ZipError('Not a zip file');
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65_535); i--) {
      if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new ZipError('Not a zip file (no end-of-archive record)');
    const count = b.readUInt16LE(eocd + 10);
    const cdSize = b.readUInt32LE(eocd + 12);
    const cdOffset = b.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipError('ZIP64 archives are not supported');
    if (count > this.limits.maxEntries) throw new ZipError('The archive has too many files');
    if (cdOffset + cdSize > b.length) throw new ZipError('The archive directory is damaged');
    let p = cdOffset;
    for (let i = 0; i < count; i++) {
      if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) throw new ZipError('The archive directory is damaged');
      const flags = b.readUInt16LE(p + 8);
      const method = b.readUInt16LE(p + 10);
      const crc = b.readUInt32LE(p + 16);
      const compSize = b.readUInt32LE(p + 20);
      const size = b.readUInt32LE(p + 24);
      const nameLen = b.readUInt16LE(p + 28);
      const extraLen = b.readUInt16LE(p + 30);
      const commentLen = b.readUInt16LE(p + 32);
      const offset = b.readUInt32LE(p + 42);
      const name = b.toString((flags & 0x800) ? 'utf8' : 'latin1', p + 46, p + 46 + nameLen);
      this.entries.set(name, { name, method, crc, compSize, size, offset, flags });
      p += 46 + nameLen + extraLen + commentLen;
    }
  }

  names(): string[] { return [...this.entries.keys()]; }
  has(name: string): boolean { return this.entries.has(name); }

  read(name: string): Buffer {
    const e = this.entries.get(name);
    if (!e) throw new ZipError(`Missing ${name} in the archive`);
    if (e.flags & 1) throw new ZipError('The file is password protected');
    if (e.size > this.limits.maxEntryBytes) throw new ZipError(`${name} is too large to read safely`);
    this.total += e.size;
    if (this.total > this.limits.maxTotalBytes) throw new ZipError('The archive expands to too much data');
    const b = this.buf;
    if (e.offset + 30 > b.length || b.readUInt32LE(e.offset) !== 0x04034b50) throw new ZipError('The archive is damaged');
    const nameLen = b.readUInt16LE(e.offset + 26);
    const extraLen = b.readUInt16LE(e.offset + 28);
    const start = e.offset + 30 + nameLen + extraLen;
    const raw = b.subarray(start, start + e.compSize);
    if (raw.length !== e.compSize) throw new ZipError('The archive is cut off');
    let out: Buffer;
    if (e.method === 0) out = Buffer.from(raw);
    else if (e.method === 8) {
      try { out = inflateRawSync(raw, { maxOutputLength: Math.min(e.size + 1024, this.limits.maxEntryBytes) }); }
      catch { throw new ZipError(`${name} could not be unpacked`); }
    } else throw new ZipError(`Unsupported compression in ${name}`);
    if (out.length !== e.size) throw new ZipError(`${name} has the wrong size`);
    if (crc32(out) !== e.crc) throw new ZipError(`${name} is damaged (checksum mismatch)`);
    return out;
  }

  text(name: string): string { return this.read(name).toString('utf8').replace(/^﻿/, ''); }
}

export interface ZipFile { name: string; data: Buffer | string }

export function writeZip(files: ZipFile[], when: Date = new Date()): Buffer {
  const dosTime = (when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | (when.getUTCSeconds() >> 1);
  const dosDate = ((Math.max(when.getUTCFullYear(), 1980) - 1980) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate();
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = typeof f.data === 'string' ? Buffer.from(f.data, 'utf8') : f.data;
    const deflated = deflateRawSync(data, { level: 6 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x800, 8);
    c.writeUInt16LE(useDeflate ? 8 : 0, 10);
    c.writeUInt16LE(dosTime, 12);
    c.writeUInt16LE(dosDate, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cd, end]);
}

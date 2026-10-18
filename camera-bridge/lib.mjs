// Pure helpers for the camera bridge (kept apart so they can be tested without a camera).

/** The Dahua RTSP address for one channel of an NVR/XVR. subtype 1 is the small "sub stream", which is what we want for live view. */
export function rtspUrl({ host, port = 554, user, password, subtype = 1 }, channel) {
  const u = encodeURIComponent(user);
  const p = encodeURIComponent(password);
  return `rtsp://${u}:${p}@${host}:${port}/cam/realmonitor?channel=${Number(channel)}&subtype=${Number(subtype)}`;
}

/** Hide the password when an address is printed in a log. */
export const redact = (s) => String(s).replace(/(rtsp:\/\/[^:\/]+:)[^@]*@/g, '$1***@');

/** Cuts a stream of bytes from ffmpeg (one JPEG after another) into whole pictures. */
export class FrameSplitter {
  constructor(onFrame, maxBytes = 2 * 1024 * 1024) {
    this.buf = Buffer.alloc(0);
    this.onFrame = onFrame;
    this.maxBytes = maxBytes;
  }
  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      const start = this.buf.indexOf(Buffer.from([0xff, 0xd8]));
      if (start < 0) { this.buf = Buffer.alloc(0); return; }
      const end = this.buf.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
      if (end < 0) {
        this.buf = start > 0 ? this.buf.subarray(start) : this.buf;
        if (this.buf.length > this.maxBytes) this.buf = Buffer.alloc(0); // junk: start again
        return;
      }
      this.onFrame(this.buf.subarray(start, end + 2));
      this.buf = this.buf.subarray(end + 2);
    }
  }
}

/** Decides whether to send a picture now. With nobody watching, one picture every `idleMs` keeps the camera shown as online. */
export function makeGate({ watchingMs, idleMs }) {
  let last = 0;
  let watchers = 0;
  return {
    setWatchers(n) { watchers = n; },
    allow(now) {
      const gap = watchers > 0 ? watchingMs : idleMs;
      if (now - last < gap) return false;
      last = now;
      return true;
    },
  };
}

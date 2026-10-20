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

/** Every address to try on the network this PC is on, from its own address and netmask. Networks bigger than 256 addresses are cut to the
 *  PC's own /24, which is how almost every router at a ground is set up. Leaves out the network and broadcast addresses and the PC itself. */
export function subnetHosts(ip, netmask) {
  const n = (s) => s.split('.').reduce((a, o) => ((a << 8) | (Number(o) & 255)) >>> 0, 0);
  const s = (v) => [24, 16, 8, 0].map((b) => (v >>> b) & 255).join('.');
  let mask = n(netmask);
  if (((~mask) >>> 0) > 255) mask = 0xffffff00;
  const me = n(ip), net = (me & mask) >>> 0, size = ((~mask) >>> 0) + 1;
  const out = [];
  for (let i = 1; i < size - 1; i++) { const a = (net + i) >>> 0; if (a !== me) out.push(s(a)); }
  return out;
}

/** Ports that give a recorder away: 554 is RTSP (the bridge needs it), 37777 is Dahua's own port, 80 is the web page. */
export const RECORDER_PORTS = [554, 37777, 80];

/** Reads one scan result: what the device probably is and whether the bridge can use it. */
export function describeHost(open) {
  const has = (p) => open.includes(p);
  if (has(554) && has(37777)) return { likely: 'Dahua recorder or camera (RTSP and Dahua ports open)', usable: true };
  if (has(554)) return { likely: 'RTSP camera or recorder (not Dahua, or the Dahua port is closed)', usable: true };
  if (has(37777)) return { likely: 'Dahua device with RTSP switched off: turn RTSP on in its web page (Network, Port)', usable: false };
  return { likely: 'Something with a web page only (a router, printer or similar)', usable: false };
}

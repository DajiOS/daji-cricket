import { connect as tlsConnect } from 'node:tls';
import { connect as tcpConnect, type Socket } from 'node:net';
import type { Config } from './config.ts';
import type { Provider } from './notifications.ts';

// Sends email through Gmail's SMTP server with an App Password (Google Account > Security > 2-Step Verification > App passwords).
// A small client of our own so the server keeps zero dependencies: implicit TLS on port 465, AUTH LOGIN, one message per connection.
// Gmail's ordinary password does not work for this, and the App Password is never logged or shown; it lives only in GMAIL_APP_PASSWORD.

const CRLF = '\r\n';

/** Reads a whole SMTP reply (one or more lines; the last line has a space after the code). */
function reader(sock: Socket) {
  let buf = '';
  const waiters: ((r: { code: number; text: string }) => void)[] = [];
  const fail: ((e: Error) => void)[] = [];
  const pump = () => {
    for (;;) {
      const lines = buf.split(CRLF);
      if (lines.length < 2) return;
      // a reply is complete when a line looks like "250 text" (code then space)
      const last = lines.findIndex((l) => /^\d{3} /.test(l) || /^\d{3}$/.test(l));
      if (last < 0) return;
      const reply = lines.slice(0, last + 1);
      buf = lines.slice(last + 1).join(CRLF);
      const w = waiters.shift();
      if (w) w({ code: Number(reply[last]!.slice(0, 3)), text: reply.join('\n') });
    }
  };
  sock.on('data', (d) => { buf += d.toString('latin1'); pump(); });
  const die = (e: Error) => { for (const f of fail.splice(0)) f(e); waiters.length = 0; };
  sock.on('error', die);
  sock.on('close', () => die(new Error('The mail server closed the connection')));
  return (): Promise<{ code: number; text: string }> => new Promise((res, rej) => { waiters.push(res); fail.push(rej); pump(); });
}

export interface MailOptions { host: string; port: number; tls: boolean; user: string; pass: string; timeoutMs?: number }
export interface Mail { fromName: string; to: string; subject: string; text: string }

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');
/** Header text that may hold any language: =?UTF-8?B?...?= */
const encodeHeader = (s: string): string => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const cleanAddr = (a: string): string => a.replace(/[\r\n<>]/g, '').trim();

export function buildMessage(from: string, m: Mail, at = new Date()): string {
  const body = b64(m.text).replace(/(.{76})/g, '$1' + CRLF);
  return [
    `From: ${encodeHeader(m.fromName.replace(/[\r\n"]/g, ''))} <${cleanAddr(from)}>`,
    `To: <${cleanAddr(m.to)}>`,
    `Subject: ${encodeHeader(m.subject.replace(/[\r\n]/g, ' '))}`,
    `Date: ${at.toUTCString().replace('GMT', '+0000')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '', body, '',
  ].join(CRLF);
}

async function session(o: MailOptions, steps: (read: () => Promise<{ code: number; text: string }>, write: (s: string) => void) => Promise<void>): Promise<void> {
  const sock: Socket = o.tls ? tlsConnect({ host: o.host, port: o.port, servername: o.host }) : tcpConnect({ host: o.host, port: o.port });
  sock.setTimeout(o.timeoutMs ?? 15_000, () => sock.destroy(new Error('The mail server did not answer in time')));
  const read = reader(sock);
  const write = (s: string) => sock.write(s, 'latin1');
  try { await steps(read, write); } finally { sock.destroy(); }
}

async function expect(read: () => Promise<{ code: number; text: string }>, codes: number[], what: string): Promise<string> {
  const r = await read();
  if (!codes.includes(r.code)) throw new Error(`${what}: ${r.text.split('\n')[0]!.slice(0, 120)}`);
  return r.text;
}

async function login(read: () => Promise<{ code: number; text: string }>, write: (s: string) => void, o: MailOptions): Promise<void> {
  await expect(read, [220], 'Greeting');
  write(`EHLO dajicricket.com${CRLF}`); await expect(read, [250], 'EHLO');
  write(`AUTH LOGIN${CRLF}`); await expect(read, [334], 'AUTH');
  write(b64(o.user) + CRLF); await expect(read, [334], 'AUTH user');
  write(b64(o.pass) + CRLF);
  const r = await read();
  if (r.code !== 235) throw new Error(r.code === 535 ? 'Gmail refused the sign-in. Use an App Password (not the normal Gmail password) and check the address.' : `AUTH: ${r.text.split('\n')[0]!.slice(0, 120)}`);
}

/** Sends one message. Resolves when Gmail accepted it for delivery. */
export async function sendMail(o: MailOptions, m: Mail): Promise<void> {
  await session(o, async (read, write) => {
    await login(read, write, o);
    write(`MAIL FROM:<${cleanAddr(o.user)}>${CRLF}`); await expect(read, [250], 'MAIL FROM');
    write(`RCPT TO:<${cleanAddr(m.to)}>${CRLF}`); await expect(read, [250, 251], 'The recipient address was refused');
    write(`DATA${CRLF}`); await expect(read, [354], 'DATA');
    const msg = buildMessage(o.user, m).replace(/^\./gm, '..'); // dot-stuffing
    write(msg + CRLF + '.' + CRLF); await expect(read, [250], 'Message not accepted');
    write(`QUIT${CRLF}`);
  });
}

/** Signs in and signs out again, sending nothing. For the Test button on the Services page. */
export async function checkLogin(o: MailOptions): Promise<void> {
  await session(o, async (read, write) => { await login(read, write, o); write(`QUIT${CRLF}`); });
}

export const mailOptions = (cfg: Config): MailOptions => ({ host: cfg.email.host, port: cfg.email.port, tls: cfg.email.tls, user: cfg.email.user, pass: cfg.email.appPassword });

/** The email channel for notifications. Null (messages stay queued) until GMAIL_APP_PASSWORD is set. */
export function gmailProvider(cfg: Config): Provider | null {
  if (!cfg.email.user || !cfg.email.appPassword) return null;
  const o = mailOptions(cfg);
  return async (m) => {
    if (!m.to) return { ok: false, error: 'no email address' };
    try { await sendMail(o, { fromName: cfg.email.fromName, to: m.to, subject: m.subject ?? 'Daji Cricket Ground', text: m.body }); return { ok: true }; }
    catch (e) { console.error(JSON.stringify({ level: 'error', where: 'gmail', error: String((e as Error).message).slice(0, 200) })); return { ok: false, error: String((e as Error).message).slice(0, 200) }; }
  };
}

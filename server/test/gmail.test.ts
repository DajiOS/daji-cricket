import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:net';
import { sendMail, checkLogin, buildMessage } from '../src/gmail.ts';

/** A tiny pretend Gmail: speaks just enough SMTP, remembers what it was sent. */
function fakeSmtp(goodPass = 'abcdabcdabcdabcd'): Promise<{ server: Server; port: number; got: { from: string; to: string; data: string }[]; logins: string[] }> {
  const got: { from: string; to: string; data: string }[] = [], logins: string[] = [];
  return new Promise((resolve) => {
    const server = createServer((s) => {
      let mode: 'cmd' | 'user' | 'pass' | 'data' = 'cmd', buf = '', cur = { from: '', to: '', data: '' }, user = '';
      s.write('220 smtp.fake ESMTP\r\n');
      s.on('data', (d) => {
        buf += d.toString('latin1');
        for (;;) {
          if (mode === 'data') { const end = buf.indexOf('\r\n.\r\n'); if (end < 0) return; cur.data = buf.slice(0, end); buf = buf.slice(end + 5); got.push(cur); cur = { from: '', to: '', data: '' }; mode = 'cmd'; s.write('250 2.0.0 OK queued\r\n'); continue; }
          const i = buf.indexOf('\r\n'); if (i < 0) return;
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          if (mode === 'user') { user = Buffer.from(line, 'base64').toString(); mode = 'pass'; s.write('334 UGFzc3dvcmQ6\r\n'); }
          else if (mode === 'pass') { const pw = Buffer.from(line, 'base64').toString(); if (pw === goodPass) { logins.push(user); s.write('235 2.7.0 Accepted\r\n'); } else s.write('535-5.7.8 Username and Password not accepted\r\n535 5.7.8 Learn more\r\n'); mode = 'cmd'; }
          else if (/^EHLO/i.test(line)) s.write('250-smtp.fake\r\n250 AUTH LOGIN\r\n');
          else if (/^AUTH LOGIN/i.test(line)) { mode = 'user'; s.write('334 VXNlcm5hbWU6\r\n'); }
          else if (/^MAIL FROM:/i.test(line)) { cur.from = line.slice(10); s.write('250 OK\r\n'); }
          else if (/^RCPT TO:/i.test(line)) { cur.to = line.slice(8); if (cur.to.includes('bad@')) s.write('550 5.1.1 No such user\r\n'); else s.write('250 OK\r\n'); }
          else if (/^DATA/i.test(line)) { mode = 'data'; s.write('354 go ahead\r\n'); }
          else if (/^QUIT/i.test(line)) { s.end('221 bye\r\n'); return; }
          else s.write('500 what?\r\n');
        }
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as any).port, got, logins }));
  });
}
const opts = (port: number, pass = 'abcdabcdabcdabcd') => ({ host: '127.0.0.1', port, tls: false, user: 'dajicricket@gmail.com', pass, timeoutMs: 3000 });

test('a booking email goes out through the mail server, with a readable subject and body in any language', async () => {
  const f = await fakeSmtp();
  try {
    await sendMail(opts(f.port), { fromName: 'Daji Cricket Ground', to: 'player@example.com', subject: 'Booked: Sat 14 Nov ₹1,800', text: 'Hello Hemanshu,\n.a line that starts with a dot\nધન્યવાદ' });
    assert.equal(f.logins[0], 'dajicricket@gmail.com');
    assert.equal(f.got.length, 1);
    assert.equal(f.got[0]!.from, '<dajicricket@gmail.com>'); assert.equal(f.got[0]!.to, '<player@example.com>');
    const data = f.got[0]!.data;
    assert.match(data, /^From: Daji Cricket Ground <dajicricket@gmail.com>/m);
    assert.match(data, /^Subject: =\?UTF-8\?B\?/m);
    const body = Buffer.from(data.split('\r\n\r\n')[1]!.replace(/\r\n/g, ''), 'base64').toString('utf8');
    assert.equal(body, 'Hello Hemanshu,\n.a line that starts with a dot\nધન્યવાદ');
  } finally { f.server.close(); }
});

test('a wrong App Password and a refused recipient give plain explanations', async () => {
  const f = await fakeSmtp();
  try {
    await assert.rejects(checkLogin(opts(f.port, 'wrong')), /App Password/);
    await checkLogin(opts(f.port)); // right one: signs in, sends nothing
    assert.equal(f.got.length, 0);
    await assert.rejects(sendMail(opts(f.port), { fromName: 'X', to: 'bad@example.com', subject: 's', text: 't' }), /recipient address was refused/);
  } finally { f.server.close(); }
});

test('header injection through a subject or address is neutralised', () => {
  const m = buildMessage('dajicricket@gmail.com', { fromName: 'Daji\r\nBcc: x@y.z', to: 'a@b.c\r\nBcc: x@y.z', subject: 'Hi\r\nBcc: x@y.z', text: 'x' });
  assert.equal(/^Bcc:/m.test(m), false);
});

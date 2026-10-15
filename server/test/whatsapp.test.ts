import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';
import { whatsappOtpSender, msg91OtpSender, waNumber } from '../src/whatsapp.ts';
import { setOtpSender, setOtpSmsSender, sendOtpCode } from '../src/notifications.ts';

const cfgWith = (env: Record<string, string>) => loadConfig({ PUBLIC_URL: 'http://localhost:4000', ...env } as NodeJS.ProcessEnv);
afterEach(() => { setOtpSender(null); setOtpSmsSender(null); });

test('a 10-digit number gets 91 in front', () => {
  assert.equal(waNumber('9876543210'), '919876543210');
  assert.equal(waNumber('+91 98765 43210'), '919876543210');
});

test('no WhatsApp keys means no sender', () => {
  assert.equal(whatsappOtpSender(cfgWith({})), null);
});

test('the code goes out as an authentication template with the code in the body and the copy button', async () => {
  const seen: any[] = [];
  const send = whatsappOtpSender(cfgWith({ WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_ID: '12345' }), async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200, text: async () => '{}' }; })!;
  assert.equal(await send('9876543210', '123456'), true);
  assert.equal(seen[0].url, 'https://graph.facebook.com/v21.0/12345/messages');
  assert.equal(seen[0].init.headers.authorization, 'Bearer tok');
  const b = JSON.parse(seen[0].init.body);
  assert.equal(b.to, '919876543210'); assert.equal(b.template.name, 'daji_otp'); assert.equal(b.template.language.code, 'en');
  assert.equal(b.template.components[0].parameters[0].text, '123456');
  assert.equal(b.template.components[1].sub_type, 'url'); assert.equal(b.template.components[1].parameters[0].text, '123456');
});

test('a refused message counts as not delivered', async () => {
  const send = whatsappOtpSender(cfgWith({ WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_ID: '1' }), async () => ({ ok: false, status: 400, text: async () => 'bad template' }))!;
  const quiet = console.error; console.error = () => {};
  try { assert.equal(await send('9876543210', '111111'), false); } finally { console.error = quiet; }
});

test('sendOtpCode uses WhatsApp when it is set up', async () => {
  const got: string[] = [];
  setOtpSender(async (p, c) => { got.push(p + ':' + c); return true; });
  assert.equal(await sendOtpCode('9876543210', '654321'), true);
  assert.deepEqual(got, ['9876543210:654321']);
});

test('MSG91 gets the template, the number and our own code', async () => {
  const seen: any[] = [];
  const send = msg91OtpSender(cfgWith({ MSG91_AUTH_KEY: 'k1', MSG91_TEMPLATE_ID: 'tpl9' }), async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200, text: async () => '{"type":"success","message":"abc"}' }; })!;
  assert.equal(await send('9876543210', '482913'), true);
  const u = new URL(seen[0].url);
  assert.equal(u.origin + u.pathname, 'https://control.msg91.com/api/v5/otp');
  assert.equal(u.searchParams.get('template_id'), 'tpl9'); assert.equal(u.searchParams.get('mobile'), '919876543210'); assert.equal(u.searchParams.get('otp'), '482913');
  assert.equal(seen[0].init.headers.authkey, 'k1');
});

test('MSG91 answering type "error" counts as not delivered, and no keys means no sender', async () => {
  assert.equal(msg91OtpSender(cfgWith({})), null);
  const quiet = console.error; console.error = () => {};
  try {
    const send = msg91OtpSender(cfgWith({ MSG91_AUTH_KEY: 'k', MSG91_TEMPLATE_ID: 't' }), async () => ({ ok: true, status: 200, text: async () => '{"type":"error","message":"Template not found"}' }))!;
    assert.equal(await send('9876543210', '1'), false);
  } finally { console.error = quiet; }
});

test('WhatsApp is tried first and a text message backs it up when it fails', async () => {
  const log: string[] = [];
  setOtpSender(async () => { log.push('wa'); return false; });
  setOtpSmsSender(async () => { log.push('sms'); return true; });
  assert.equal(await sendOtpCode('9876543210', '123456'), true);
  assert.deepEqual(log, ['wa', 'sms']);
  log.length = 0;
  setOtpSender(async () => { log.push('wa'); return true; });
  assert.equal(await sendOtpCode('9876543210', '123456'), true);
  assert.deepEqual(log, ['wa']);
});

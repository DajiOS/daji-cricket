import type { Config } from './config.ts';
import type { OtpSender, AlertSender } from './notifications.ts';

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** The number WhatsApp wants: country code first, digits only. A 10-digit Indian number gets 91 in front. */
export const waNumber = (phone: string): string => { const d = phone.replace(/\D/g, ''); return d.length === 10 ? `91${d}` : d; };

/**
 * Sends a sign-in code with a WhatsApp "authentication" template through Meta's Cloud API.
 * The template (default name daji_otp, category Authentication) must be approved in Meta Business Manager first;
 * it carries the code in its body and in its Copy code button.
 */
export function whatsappOtpSender(cfg: Config, fetchImpl: Fetch = fetch as unknown as Fetch): OtpSender | null {
  const w = cfg.whatsapp;
  if (!w.token || !w.phoneId) return null;
  return async (phone, code) => {
    const res = await fetchImpl(`${w.apiUrl}/${encodeURIComponent(w.phoneId)}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${w.token}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: waNumber(phone),
        type: 'template',
        template: {
          name: w.otpTemplate,
          language: { code: w.lang },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: code }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
          ],
        },
      }),
    });
    if (!res.ok) console.error(JSON.stringify({ level: 'error', where: 'whatsapp-otp', status: res.status, body: (await res.text()).slice(0, 300) }));
    return res.ok;
  };
}

/**
 * Sends a sign-in code as a text message through MSG91's OTP API (v5). Needs an OTP template approved on DLT and added in MSG91;
 * its ##OTP## variable receives our code. Used when WhatsApp is not set up, or when a WhatsApp send fails.
 */
export function msg91OtpSender(cfg: Config, fetchImpl: Fetch = fetch as unknown as Fetch): OtpSender | null {
  const m = cfg.msg91;
  if (!m.authKey || !m.templateId) return null;
  return async (phone, code) => {
    const q = new URLSearchParams({ template_id: m.templateId, mobile: waNumber(phone), otp: code });
    const res = await fetchImpl(`${m.apiUrl}/otp?${q}`, { method: 'POST', headers: { authkey: m.authKey, 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10_000) });
    const text = await res.text();
    let type = '';
    try { type = String((JSON.parse(text) as { type?: string }).type ?? ''); } catch { /* not JSON */ }
    const ok = res.ok && type !== 'error';
    if (!ok) console.error(JSON.stringify({ level: 'error', where: 'msg91-otp', status: res.status, body: text.slice(0, 300) }));
    return ok;
  };
}

/**
 * Tells the ground's contact person about a new enquiry, with a WhatsApp "utility" template through Meta's Cloud API.
 * The template (default name daji_enquiry_alert, category Utility, three text variables: name, phone, message) must be approved in Meta Business Manager first.
 */
export function whatsappAlertSender(cfg: Config, fetchImpl: Fetch = fetch as unknown as Fetch): AlertSender | null {
  const w = cfg.whatsapp;
  if (!w.token || !w.phoneId) return null;
  return async (phone, vars) => {
    const res = await fetchImpl(`${w.apiUrl}/${encodeURIComponent(w.phoneId)}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${w.token}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: waNumber(phone), type: 'template',
        template: { name: w.alertTemplate, language: { code: w.lang }, components: [{ type: 'body', parameters: vars.map((text) => ({ type: 'text', text: text.replace(/[\r\n\t]+/g, ' ').slice(0, 300) || '-' })) }] },
      }),
    });
    if (!res.ok) console.error(JSON.stringify({ level: 'error', where: 'whatsapp-alert', status: res.status, body: (await res.text()).slice(0, 300) }));
    return res.ok;
  };
}

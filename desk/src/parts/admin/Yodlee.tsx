// The software owner's Yodlee keys. Secret values are never shown again once saved; leaving a secret box blank keeps what is stored.
import { useEffect, useState } from 'react';
import { useApi, put, post } from '../../lib';
import { Loading, ErrorBox, Chip, Field, useToast } from '../../ui';
import { Panel, errText } from './common';

const TEXT: [string, string, string][] = [
  ['apiUrl', 'Yodlee API address', 'For example https://sandbox.api.yodlee.com/ysl (testing) or the address Yodlee gave you for live.'],
  ['fastLinkUrl', 'FastLink address', 'The bank sign-in page address from Yodlee, for example https://fl4.sandbox.yodlee.com/authenticate/<your-name>/fastlink/'],
  ['clientId', 'Client ID', 'From the Yodlee dashboard, next to the secret. Used with the secret below to sign in.'],
  ['adminLoginName', 'Admin login name', 'The Yodlee admin user used to add each business as a user. Default: daji.'],
  ['configName', 'FastLink configuration name', 'The name you published in Yodlee\'s Configuration Tool (aggregation, India, INR). Blank uses Aggregation.'],
  ['userLogin', 'Sandbox test user', 'Sandbox only, for example sbMem… as Yodlee gave you. Leave blank for Development and Live.'],
  ['issuer', 'Issuer ID', 'Only for the private-key way of signing in. Leave blank when you use a client ID and secret.'],
  ['keyId', 'Key ID', 'Optional, private-key way only. The id of the public key you uploaded to Yodlee.'],
];

export function YodleeSettings() {
  const [data, error, reload] = useApi<any>('/api/admin/yodlee');
  const [form, setForm] = useState<Record<string, string>>({});
  const [pem, setPem] = useState(''); const [sec, setSec] = useState(''); const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const toast = useToast();
  useEffect(() => { if (data) setForm(data.fields); }, [data]);
  if (error) return <ErrorBox msg={error} />;
  if (!data) return <Loading />;
  const save = async (extra: Record<string, unknown> = {}, ok = 'Saved') => {
    setBusy(true);
    try { await put('/api/admin/yodlee', { ...form, ...(pem.trim() ? { privateKeyPem: pem } : {}), ...(sec.trim() ? { secret: sec.trim() } : {}), ...extra }); setPem(''); setSec(''); setTest(null); toast(ok); reload(); }
    catch (e) { toast(errText(e)); } finally { setBusy(false); }
  };
  const runTest = async () => { setBusy(true); try { setTest(await post('/api/admin/yodlee/test')); } catch (e) { setTest({ ok: false, message: errText(e) }); } finally { setBusy(false); } };
  const subscribe = async () => { setBusy(true); try { const r = await post<any>('/api/admin/yodlee/subscribe'); toast(r.message); } catch (e) { toast(errText(e)); } finally { setBusy(false); } };
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast('Copied'); } catch { toast('Select the address and copy it'); } };
  return (
    <div className="stack">
      <Panel title="Yodlee bank feed" note="Lets each business connect its bank and bring in new transactions by itself. Keys saved here win over the server file; they are never shown again and never leave the server."
        actions={<Chip tone={data.configured ? 'good' : 'mute'}>{data.configured ? 'Ready' : 'Not set up'}</Chip>}>
        {!data.encrypted && <p className="hint" style={{ marginTop: 0 }}>FIELD_KEY is not set on the server, so saved keys are stored without extra encryption. Set it in the server file to encrypt them.</p>}
        <div className="form-grid">
          {TEXT.map(([k, label, hint]) => (
            <Field key={k} label={label} hint={data.fromServerSettings.includes(k) ? `${hint} Currently from the server file; type here to override.` : hint} full={k === 'apiUrl' || k === 'fastLinkUrl'}>
              <input className="inp" value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} autoComplete="off" />
            </Field>
          ))}
          <Field label={`Client secret ${data.secretsSet.secret ? '(saved, leave blank to keep)' : '(not set)'}`} hint="The secret from the Yodlee dashboard. With the client ID it signs in at Yodlee. Use this OR the private key below." full>
            <input className="inp" type="password" value={sec} onChange={(e) => setSec(e.target.value)} placeholder={data.secretsSet.secret ? '••••••••  (hidden)' : ''} autoComplete="new-password" />
          </Field>
          <Field label={`Private key ${data.secretsSet.privateKeyPem ? '(saved, leave blank to keep)' : '(not set)'}`} hint="Only if Yodlee gave you a key pair instead of a secret. Paste the whole key, from -----BEGIN to -----END. It signs a short-lived token for each request." full>
            <textarea className="inp" rows={5} value={pem} onChange={(e) => setPem(e.target.value)} placeholder={data.secretsSet.privateKeyPem ? '••••••••  (hidden)' : '-----BEGIN PRIVATE KEY-----'} spellCheck={false} autoComplete="off" />
          </Field>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn primary" disabled={busy} onClick={() => save()}>Save</button>
          <button className="btn" disabled={busy} onClick={runTest}>Test the keys</button>
          {data.secretsSet.secret && <button className="btn ghost" disabled={busy} onClick={() => save({ clear: ['secret'] }, 'Secret removed')}>Remove saved secret</button>}
          {data.secretsSet.privateKeyPem && <button className="btn ghost" disabled={busy} onClick={() => save({ clear: ['privateKeyPem'] }, 'Key removed')}>Remove saved key</button>}
        </div>
        {test && <p className={test.ok ? 'gold' : 'err'} style={{ marginBottom: 0 }}>{test.message}</p>}
      </Panel>
      <Panel title="Webhook (automatic updates)" note="Yodlee calls this address when a bank has new data, so transactions arrive within minutes instead of waiting for the daily pull.">
        {data.webhookUrl ? (
          <>
            <p className="hint" style={{ marginTop: 0 }}>Press Turn on instant updates and Yodlee is told to call this address for REFRESH, DATA_UPDATES and AUTO_REFRESH_UPDATES. It contains a secret, so keep it private. Yodlee enables webhooks only after the contract is signed.</p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input className="inp" readOnly value={data.webhookUrl} style={{ flex: '1 1 320px' }} onFocus={(e) => e.currentTarget.select()} aria-label="Webhook address" />
              <button className="btn sm" onClick={() => copy(data.webhookUrl)}>Copy</button>
              <button className="btn sm ghost" disabled={busy} onClick={() => save({ generateWebhookSecret: true }, 'New address made. Turn on instant updates again.')}>Make a new one</button>
              <button className="btn sm primary" disabled={busy} onClick={subscribe}>Turn on instant updates</button>
            </div>
          </>
        ) : <button className="btn primary" disabled={busy} onClick={() => save({ generateWebhookSecret: true }, 'Webhook address made')}>Make the webhook address</button>}
      </Panel>
    </div>
  );
}

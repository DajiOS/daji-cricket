// Account Aggregator keys (Setu; Finvu is not built yet). Secrets are saved encrypted and never shown again.
import { useState } from 'react';
import { put, useApi } from '../../lib';
import { ErrorBox, Field, Loading, useToast } from '../../ui';
import { Panel, errText } from './common';

export function AggregatorSettings() {
  const [d, e, reload] = useApi<any>('/api/admin/aa');
  const [f, setF] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const toast = useToast();
  if (e) return <ErrorBox msg={e} />;
  if (!d) return <Loading h={120} />;
  const bind = (k: string) => ({ value: f[k] ?? (d.text[k] ?? ''), onChange: (ev: any) => setF({ ...f, [k]: ev.target.value }) });
  const save = async (extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try { await put('/api/admin/aa', { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)), ...extra }); setF({}); toast('Saved'); reload(); } catch (x) { toast(errText(x)); } finally { setBusy(false); }
  };
  const sec = (k: string) => (d.secretsSet[k] ? ' (saved)' : ' (not set)');
  return (
    <Panel title="Account Aggregator (Setu)" note={<>Keys come from Setu's Bridge. Fill in the sandbox keys first. {d.setuReady ? 'Setu is ready.' : 'Not ready yet: client id, secret and product instance id are needed.'} Finvu is not connected: it needs Finvu's own API document and credentials.</>}>
      <div className="form-grid">
        <Field label="Setu web address" hint="Leave empty for the sandbox (https://fiu-sandbox.setu.co). Production is https://fiu.setu.co."><input className="inp" placeholder="https://fiu-sandbox.setu.co" {...bind('setu.baseUrl')} /></Field>
        <Field label="Client id"><input className="inp" autoComplete="off" {...bind('setu.clientId')} /></Field>
        <Field label={`Client secret${sec('setu.clientSecret')}`}><input className="inp" type="password" autoComplete="new-password" value={f['setu.clientSecret'] ?? ''} onChange={(ev) => setF({ ...f, 'setu.clientSecret': ev.target.value })} /></Field>
        <Field label="Product instance id"><input className="inp" autoComplete="off" {...bind('setu.productInstanceId')} /></Field>
        <Field label="Sign-in address (only if Setu gave one)" hint="When empty, the client id and secret are sent as headers."><input className="inp" {...bind('setu.authUrl')} /></Field>
        <Field label={`Webhook secret${sec('webhookSecret')}`}><input className="inp" type="password" autoComplete="new-password" value={f.webhookSecret ?? ''} onChange={(ev) => setF({ ...f, webhookSecret: ev.target.value })} /></Field>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn primary" disabled={busy} onClick={() => save()}>Save</button>
        <button className="btn" disabled={busy} onClick={() => save({ generateWebhookSecret: true })}>Make a webhook secret</button>
      </div>
      {d.webhookUrl && <p className="hint">Give Setu this notification address (Bridge, your product, Notifications): <code style={{ wordBreak: 'break-all' }}>{d.webhookUrl}</code></p>}
      {!d.encrypted && <p className="hint">The server has no FIELD_KEY, so these are stored without encryption.</p>}
    </Panel>
  );
}

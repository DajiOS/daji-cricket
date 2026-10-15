// Razorpay switch, contact details and auto-debit.
import { useState } from 'react';
import { useApi, put, formatPhone } from '../../lib';
import { Loading, ErrorBox, Chip, useToast } from '../../ui';
import { Panel, errText } from './common';

export default function Payments() {
  const toast = useToast();
  const [s, error, reload] = useApi<any>('/api/admin/settings');
  const [hrs, setHrs] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  if (error) return <ErrorBox msg={error} />;
  if (!s) return <Loading />;
  const hours = hrs ?? String(s.autoDebitHoursBefore);
  async function send(patch: Record<string, unknown>, text?: string) {
    setMsg('');
    try { await put('/api/admin/settings', patch); if (text) setMsg(text); reload(); } catch (e) { toast(errText(e)); }
  }
  return (
    <div className="stack">
      <Panel title="Online payments" actions={<button className="btn sm" onClick={() => send({ razorpayEnabled: !s.razorpayEnabled }).then(() => toast(`Online payments are now ${!s.razorpayEnabled ? 'ON' : 'OFF'}.`))}>{s.razorpayEnabled ? 'Turn Razorpay OFF' : 'Turn Razorpay ON'}</button>}>
        <div className="ad-line"><span>Razorpay (online payments)</span><span>{s.razorpayEnabled ? <Chip tone="good">On</Chip> : <><Chip tone="warn">Off</Chip> <span className="small muted">direct UPI with staff verification</span></>}</span></div>
        <div className="ad-line"><span>Contact person</span><b>{s.contactName}  ·  {formatPhone(s.contactPhone)}</b></div>
        <div className="ad-line"><span>Email</span><b>{s.contactEmail}</b></div>
        <div className="ad-line"><span>MP13 Academy</span><b>{s.academyName}  ·  {s.academyBrand}</b></div>
      </Panel>
      <Panel title="Auto-debit" note="Lets customers approve their bank once (UPI AutoPay) so the balance of each booking is charged automatically before it starts. Needs Recurring Payments enabled on the Razorpay account. Try it in test mode first."
        actions={<><Chip tone={s.autoDebitEnabled ? 'good' : 'mute'}>{s.autoDebitEnabled ? 'On' : 'Off'}</Chip><button className="btn sm" onClick={() => send({ autoDebitEnabled: !s.autoDebitEnabled })}>{s.autoDebitEnabled ? 'Turn auto-debit OFF' : 'Turn auto-debit ON'}</button></>}>
        <div className="row">
          <span>Charge</span><input className="inp" type="number" min={1} max={168} style={{ width: 90 }} value={hours} onChange={(e) => setHrs(e.target.value)} aria-label="Hours before the start" /><span>hours before the start</span>
          <button className="btn sm" onClick={() => send({ autoDebitHoursBefore: Number(hours) }, 'Saved.')}>Save</button>
          {msg && <span className="ok-text">{msg}</span>}
        </div>
      </Panel>
    </div>
  );
}

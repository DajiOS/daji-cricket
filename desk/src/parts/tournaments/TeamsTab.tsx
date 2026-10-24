import { useState } from 'react';
import { Chip, Confirm, ErrorBox, Field, Modal, Table, useForm, NameField, useToast } from '../../ui';
import { del, formatPhone, inr, patch, post } from '../../lib';
import { API, type Detail, type Team } from './shared';

function TeamForm({ tid, team, feePaise, onClose, onSaved }: { tid: string; team?: Team; feePaise: number; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { v, bind, setV } = useForm({ name: team?.name ?? '', captain: team?.captain ?? '', phone: team?.phone ?? '', feePaid: team?.feePaid ?? false, paymentRef: team?.paymentRef ?? '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!v.name.trim()) return setErr('Enter the team name.');
    setBusy(true); setErr(null);
    try {
      const body = { name: v.name, captain: v.captain, phone: v.phone, feePaid: v.feePaid, paymentRef: v.paymentRef };
      if (team) await patch(`${API}/${tid}/teams/${team.id}`, body); else await post(`${API}/${tid}/teams`, body);
      toast(team ? 'Team updated' : 'Team added'); onSaved();
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return (
    <Modal title={team ? 'Edit team' : 'Add team'} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} aria-busy={busy || undefined} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <ErrorBox msg={err} />
      <div className="form-grid">
        <Field label="Team name" full><input className="inp" {...bind('name')} autoFocus /></Field>
        <NameField value={v.captain} onChange={(n) => setV((x: any) => ({ ...x, captain: n }))} firstLabel="Captain first name" lastLabel="Captain last name" />
        <Field label="Captain's phone"><input className="inp" inputMode="tel" {...bind('phone')} placeholder="98765 43210" /></Field>
        <Field label={`Entry fee ${inr(feePaise)} paid`} full>
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={v.feePaid} onChange={bind('feePaid').onChange} /><span className="small">Fee received</span></label>
        </Field>
        {v.feePaid && <Field label="Payment reference" hint="UPI reference, receipt number or note" full><input className="inp" {...bind('paymentRef')} /></Field>}
      </div>
    </Modal>
  );
}

export function TeamsTab({ d, reload }: { d: Detail; reload: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<Team | 'new' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const t = d.tournament;
  async function act(fn: () => Promise<unknown>, msg: string) { setErr(null); try { await fn(); toast(msg); reload(); } catch (e: any) { setErr(e.message); } }
  return (
    <div className="card">
      <div className="card-head"><h3>Teams ({d.teams.length})</h3><button className="btn primary sm" onClick={() => setForm('new')}>Add team</button></div>
      <div className="card-pad"><ErrorBox msg={err} /></div>
      <Table rows={d.teams} empty="No teams yet. Add the first team to get started."
        cols={[
          { head: 'Team', cell: (x) => <b>{x.name}</b> },
          { head: 'Captain', cell: (x) => x.captain || <span className="muted">—</span> },
          { head: 'Phone', cell: (x) => x.phone ? <a href={`tel:${x.phone}`}>{formatPhone(x.phone)}</a> : <span className="muted">—</span> },
          { head: 'Entry fee', cell: (x) => x.feePaid ? <Chip tone="good">Paid</Chip> : <Chip tone="warn">Due {inr(t.entryFeePaise)}</Chip> },
          { head: 'Reference', cell: (x) => x.paymentRef || <span className="muted">—</span> },
          { head: '', num: true, cell: (x) => (
            <span className="row" style={{ justifyContent: 'flex-end', gap: 6 }} onClick={(e) => e.stopPropagation()}>
              {!x.feePaid && <button className="btn sm" onClick={() => setForm(x)}>Record payment</button>}
              <button className="btn sm ghost" onClick={() => setForm(x)}>Edit</button>
              <Confirm label="Remove" ask="Remove team?" onYes={() => act(() => del(`${API}/${t.id}/teams/${x.id}`), 'Team removed')} />
            </span>) },
        ]} />
      {form && <TeamForm tid={t.id} team={form === 'new' ? undefined : form} feePaise={t.entryFeePaise} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />}
    </div>
  );
}

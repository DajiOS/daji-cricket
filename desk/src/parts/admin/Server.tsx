import { useEffect, useState } from 'react';
import { useApi, put, post, fmtDateTime } from '../../lib';
import { Loading, ErrorBox, Chip, Stat, Field, Icon, useToast } from '../../ui';
import { Panel, errText } from './common';

interface Status {
  at: number; ok: boolean; database: 'ok' | 'error'; env: string; demo: boolean; version: string | null; node: string;
  startedAt: number; upSeconds: number; machineUpSeconds: number;
  memory: { usedMb: number; totalMb: number; serverMb: number; usedPercent: number };
  disk: { freeGb: number; totalGb: number; usedPercent: number } | null;
  load: number[];
  backups: { enabled: boolean; count: number; lastAt: number | null; offsiteAt: number | null };
  warnings: string[];
}
interface Console { instance: string; region: string; regionName: string; codingUrl: string; sshUrl: string | null; instanceUrl: string | null; lightsailHome: string; updatedAt: number | null; regions: [string, string][] }

const ENV: Record<string, string> = { live: 'Live', test: 'Test', dev: 'Development', unset: 'Not set' };
function since(s: number): string {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}
/** Opens a page in a new tab without giving it a handle back to the desk, and notes it in the audit log. */
function openOut(url: string, what: 'ssh' | 'coding' | 'lightsail', toast: (m: string) => void) {
  window.open(url, '_blank', 'noopener,noreferrer');
  post('/api/admin/server/opened', { what }).catch((e) => toast(`Opened, but it could not be noted in the audit log: ${errText(e)}`));
}

/**
 * Settings › Server (the owner and the software owner, never staff): how the server is doing, the Lightsail Connect using SSH button and the AI coding console.
 * Both buttons only open the outside page; the owner signs in there. Daji keeps no AWS keys and runs no shell.
 */
export default function Server() {
  const toast = useToast();
  const [d, error, reload] = useApi<{ status: Status; console: Console }>('/api/admin/server');
  useEffect(() => { const t = setInterval(reload, 30_000); return () => clearInterval(t); }, [reload]);
  if (error) return <ErrorBox msg={error} />;
  if (!d) return <Loading />;
  const s = d.status, c = d.console;
  return (
    <div className="stack">
      <Panel title="Server status" note={`Checked ${fmtDateTime(s.at)}. Updates every 30 seconds while this page is open.`} actions={<button className="btn sm" onClick={reload}><Icon name="repeat" />Check again</button>}>
        <div className="stack">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Chip tone={s.ok ? 'good' : 'bad'}>{s.ok ? 'Up and serving bookings' : 'Database cannot be read'}</Chip>
            <Chip tone={s.env === 'live' ? 'good' : 'warn'}>{ENV[s.env] ?? s.env}</Chip>
            {s.demo && <Chip tone="bad">Demo mode on</Chip>}
            {!s.warnings.length && <Chip tone="good">Nothing needs a look</Chip>}
          </div>
          {s.warnings.length > 0 && <div className="err" role="status">{s.warnings.map((w) => <div key={w}>{w}</div>)}</div>}
          <div className="grid g3">
            <Stat label="Running for" value={since(s.upSeconds)} foot={`Started ${fmtDateTime(s.startedAt)}. Machine up ${since(s.machineUpSeconds)}.`} />
            <Stat label="Memory" value={`${s.memory.usedPercent}%`} meter={s.memory.usedPercent} foot={`${s.memory.usedMb} of ${s.memory.totalMb} MB used; Daji uses ${s.memory.serverMb} MB`} />
            <Stat label="Disk" value={s.disk ? `${s.disk.usedPercent}%` : 'Unknown'} meter={s.disk?.usedPercent} foot={s.disk ? `${s.disk.freeGb} GB free of ${s.disk.totalGb} GB` : 'The data disk could not be read'} />
            <Stat label="Last backup" value={s.backups.lastAt ? fmtDateTime(s.backups.lastAt) : s.backups.enabled ? 'None yet' : 'Switched off'} foot={`${s.backups.count} kept on the server. Off-site copy: ${s.backups.offsiteAt ? fmtDateTime(s.backups.offsiteAt) : 'never'}`} />
            <Stat label="Version" value={s.version ?? 'Not recorded'} foot={`Node ${s.node}`} />
            <Stat label="Load" value={s.load[0]?.toFixed(2) ?? '0'} foot={`1, 5 and 15 minutes: ${s.load.map((n) => n.toFixed(2)).join(', ')}`} />
          </div>
        </div>
      </Panel>
      <SshPanel c={c} onSaved={reload} />
      <Panel title="AI coding console" note="Where changes to the Daji software are made with AI. It opens in a new tab and you sign in there; it cannot see this desk's data.">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={() => openOut(c.codingUrl, 'coding', toast)}><Icon name="ai" />Open AI coding console</button>
          <span className="hint">{c.codingUrl}</span>
        </div>
      </Panel>
      <div className="hint">Only the owner sees this page, never staff. The buttons open Amazon's and the coding console's own sign-in pages: Daji keeps no AWS keys or server passwords, and nothing here can run a command on the server.</div>
    </div>
  );
}

function SshPanel({ c, onSaved }: { c: Console; onSaved: () => void }) {
  const toast = useToast();
  const [instance, setInstance] = useState(c.instance);
  const [region, setRegion] = useState(c.region);
  const [codingUrl, setCodingUrl] = useState(c.codingUrl);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function save() {
    setBusy(true); setMsg(null);
    try { await put('/api/admin/server/console', { instance, region, codingUrl }); setMsg({ ok: true, text: 'Saved.' }); onSaved(); }
    catch (e) { setMsg({ ok: false, text: errText(e) }); }
    setBusy(false);
  }
  return (
    <Panel title="Connect to the server" note="Opens Amazon Lightsail's browser terminal (SSH) for the server in a new tab. You sign in to AWS there with your own account."
      actions={c.instanceUrl ? <button className="btn ghost sm" onClick={() => openOut(c.instanceUrl!, 'lightsail', toast)}>Open in Lightsail</button> : undefined}>
      <div className="stack">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={() => (c.sshUrl ? openOut(c.sshUrl, 'ssh', toast) : setMsg({ ok: false, text: 'Enter the Lightsail instance name below and save first.' }))}><Icon name="key" />Connect using SSH</button>
          <span className="hint">{c.sshUrl ? `Instance ${c.instance}, ${c.regionName} (${c.region})` : 'Enter the instance name below to switch the button on.'}</span>
        </div>
        <div className="form-grid">
          <Field label="Lightsail instance name" hint="Exactly as the Lightsail console lists it under Instances.">
            <input className="inp" value={instance} onChange={(e) => setInstance(e.target.value)} placeholder="e.g. Ubuntu-1" autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Region">
            <select className="inp" value={region} onChange={(e) => setRegion(e.target.value)}>
              {c.regions.map(([k, n]) => <option key={k} value={k}>{n} ({k})</option>)}
            </select>
          </Field>
          <Field label="AI coding console address" hint="Starts with https://. Leave empty for https://claude.ai/code." full>
            <input className="inp" value={codingUrl} onChange={(e) => setCodingUrl(e.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
        </div>
        <div className="row"><button className="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>{msg && <span className={msg.ok ? 'ok-text' : 'err-text'}>{msg.text}</span>}
          {!c.instance && <a className="small" href={c.lightsailHome} target="_blank" rel="noopener noreferrer">Find the name in Lightsail</a>}</div>
      </div>
    </Panel>
  );
}

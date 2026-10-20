import { useState } from 'react';
import { useApi, post, fmtDateTime } from '../../lib';
import { Loading, ErrorBox, Table, Chip, useToast } from '../../ui';
import { Panel, errText } from './common';

interface Practice { at: number; snapshot: string | null; ok: boolean; message: string }
interface BackupList {
  enabled: boolean; at: string; keep: number;
  items: { name: string; reason: string; dbBytes: number; integrity: string; offsite?: { at: number; ok: boolean; message: string } }[];
  restorePractice: Practice | null; offsiteCopy: { at: number; snapshots: number } | null;
}

export default function Backups() {
  const toast = useToast();
  const [bk, error, reload] = useApi<BackupList>('/api/admin/backups');
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorBox msg={error} />;
  if (!bk) return <Loading />;
  async function now() { setBusy(true); try { await post('/api/admin/backups', {}); toast('Backup taken.'); reload(); } catch (e) { toast(errText(e)); } setBusy(false); }
  async function practise() { setBusy(true); try { const r = await post<Practice>('/api/admin/backups/practice-restore', {}); toast(r.message); reload(); } catch (e) { toast(errText(e)); } setBusy(false); }
  const s3 = bk.items.find((i) => i.offsite)?.offsite;
  const rp = bk.restorePractice;
  return (
    <div className="stack">
      <Panel title="Backups" note={bk.enabled ? `A snapshot is taken every day at ${bk.at} India time; the newest ${bk.keep} are kept.` : 'Daily backups are off on this server (they are on by default on a real domain).'}
        actions={<button className="btn sm" disabled={busy} onClick={now}>Take a backup now</button>}>
        <Table rows={bk.items.slice(0, 6)} empty="No backups yet." cols={[
          { head: 'Snapshot', cell: (i) => i.name.replace('_', '  ') },
          { head: 'Why', cell: (i) => i.reason },
          { head: 'Size', cell: (i) => `${(i.dbBytes / 1024).toFixed(0)} KB`, num: true },
          { head: 'Check', cell: (i) => <Chip tone={i.integrity === 'ok' ? 'good' : 'warn'}>{i.integrity}</Chip> },
        ]} />
      </Panel>
      <Panel title="Off the server, and a practice restore" note="A backup on the same disk is lost with the disk, and a backup is only proven by restoring it."
        actions={<button className="btn sm" disabled={busy || !bk.items.length} onClick={practise}>Practise a restore</button>}>
        <div className="card-pad stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>Copied off the server</span>
            {bk.offsiteCopy ? <Chip tone="good">{fmtDateTime(bk.offsiteCopy.at)}, {bk.offsiteCopy.snapshots} snapshots</Chip>
              : s3 ? <Chip tone={s3.ok ? 'good' : 'bad'}>{s3.ok ? `Bucket, ${fmtDateTime(s3.at)}` : s3.message}</Chip>
              : <Chip tone="warn">Not yet: schedule deploy/offsite-backup.sh</Chip>}
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>Last practice restore</span>
            {rp ? <Chip tone={rp.ok ? 'good' : 'bad'}>{fmtDateTime(rp.at)}</Chip> : <Chip tone="warn">Never</Chip>}
          </div>
          {rp && <div className="hint">{rp.message} The live data is never touched; the copy is restored into a throw-away folder and deleted.</div>}
        </div>
      </Panel>
    </div>
  );
}

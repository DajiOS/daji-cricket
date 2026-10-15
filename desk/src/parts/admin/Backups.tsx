import { useState } from 'react';
import { useApi, post } from '../../lib';
import { Loading, ErrorBox, Table, Chip, useToast } from '../../ui';
import { Panel, errText } from './common';

export default function Backups() {
  const toast = useToast();
  const [bk, error, reload] = useApi<{ enabled: boolean; at: string; keep: number; items: { name: string; reason: string; dbBytes: number; integrity: string }[] }>('/api/admin/backups');
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorBox msg={error} />;
  if (!bk) return <Loading />;
  async function now() { setBusy(true); try { await post('/api/admin/backups', {}); toast('Backup taken.'); reload(); } catch (e) { toast(errText(e)); } setBusy(false); }
  return (
    <Panel title="Backups" note={bk.enabled ? `A snapshot is taken every day at ${bk.at} India time; the newest ${bk.keep} are kept.` : 'Daily backups are off on this server (they are on by default on a real domain).'}
      actions={<button className="btn sm" disabled={busy} onClick={now}>Take a backup now</button>}>
      <Table rows={bk.items.slice(0, 6)} empty="No backups yet." cols={[
        { head: 'Snapshot', cell: (i) => i.name.replace('_', '  ') },
        { head: 'Why', cell: (i) => i.reason },
        { head: 'Size', cell: (i) => `${(i.dbBytes / 1024).toFixed(0)} KB`, num: true },
        { head: 'Check', cell: (i) => <Chip tone={i.integrity === 'ok' ? 'good' : 'warn'}>{i.integrity}</Chip> },
      ]} />
    </Panel>
  );
}

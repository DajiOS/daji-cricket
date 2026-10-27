import { fmtDateTime, formatPhone } from '../../lib';
import { Chip, Table } from '../../ui';
import { KIND_LABEL, KIND_TONE, type HistoryRow } from './shared';

export default function HistoryTab({ rows }: { rows: HistoryRow[] }) {
  return (
    <div className="card">
      <div className="card-head"><h3>Sent history</h3></div>
      <Table rows={rows} rowKey={(r) => r.id} empty="Nothing has been marked as sent yet." cols={[
        { head: 'When', cell: (r) => <span className="small">{fmtDateTime(r.sentAt)}</span> },
        { head: 'Type', cell: (r) => <Chip tone={KIND_TONE[r.kind]}>{KIND_LABEL[r.kind]}</Chip> },
        { head: 'To', cell: (r) => <div><div className="strong">{r.name}</div><div className="small muted">{formatPhone(r.phone)}</div></div> },
        { head: 'Message', cell: (r) => <div className="rem-msg" title={r.message}>{r.message}</div> },
        { head: 'By', cell: (r) => <span className="small muted">{r.sentBy ?? '—'}</span> },
      ]} />
    </div>
  );
}

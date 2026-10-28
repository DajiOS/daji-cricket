// The documents whose pages mention a booking or a customer (a team list, a waiver, a receipt), shown on that booking or customer.
import { can, fmtDateTime, useApi } from '../../lib';
import { useSession } from '../../App';
import { Loading } from '../../ui';

/** Documents are for the owner and the bookkeepers, so front desk staff see a line saying where they are instead. */
export const seesDocs = (me: Parameters<typeof can>[0]) => !!me && (me.role !== 'staff' || can(me, 'manage_accounting'));

export function LinkedDocs({ kind, id }: { kind: 'booking' | 'customer'; id: string }) {
  const { me, ownerId } = useSession();
  const ok = seesDocs(me);
  const [d, err] = useApi<{ items: { id: string; name: string; pages: number; folder: { name: string } | null; createdAt: number }[] }>(ok ? `/api/docs?linkKind=${kind}&linkId=${encodeURIComponent(id)}` : null, [ownerId]);
  if (!ok) return <div data-state="empty" className="small muted">Documents are kept for the owner and the team members who keep the books.</div>;
  if (err) return <div className="err small">{err}</div>;
  if (!d) return <Loading h={40} />;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <b className="small">Documents that mention this {kind}</b>
      {!d.items.length ? <div data-state="empty" className="small muted">None yet. A file uploaded in <a href="#/documents">Documents</a> shows here when its pages mention this {kind === 'booking' ? 'booking number' : 'customer'}.</div>
        : d.items.map((x) => <a key={x.id} className="small" href={`#/documents/${x.id}`}>{x.name} <span className="muted">· {x.pages} page{x.pages === 1 ? '' : 's'}{x.folder ? ` · ${x.folder.name}` : ''} · {fmtDateTime(x.createdAt)}</span></a>)}
    </div>
  );
}

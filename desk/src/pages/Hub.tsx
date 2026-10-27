import { useSession } from '../App';
import { useApi, can, todayISO } from '../lib';
import { NAV, RAIL, BLURBS, navVisible, hrefOf } from '../registry';
import type { TodayData } from '../parts/dash/Today';

// The design's department hub (its Finance orbit): the jobs around a core, each a numbered card with its pages as chips, and a "Start here" list of what needs you today.
const POS = [[26, 24], [74, 24], [74, 76], [26, 76]] as const;
const COL = ['#B86E12', '#0F7C86', '#2F6FB0', '#7C4DBA'] as const;

export default function Hub({ sub }: { sub: string }) {
  const { me, ownerId } = useSession();
  const rail = RAIL.find((r) => r.section === sub) ?? RAIL.find((r) => r.hub)!;
  const jobs = NAV.filter((g) => g.section === rail.section).map((g) => ({ ...g, items: g.items.filter((i) => navVisible(me, i)) })).filter((g) => g.items.length);
  const [appr] = useApi<{ count: number }>(can(me, 'manage_accounting') ? '/api/accounting/approvals/count' : null, [ownerId]);
  const [pnl] = useApi<{ uncategorised: { count: number } }>(can(me, 'manage_accounting') && can(me, 'view_revenue') ? `/api/accounting/reports/pnl?month=${todayISO().slice(0, 7)}` : null, [ownerId]);
  const [today] = useApi<TodayData>(can(me, 'manage_bookings') ? '/api/staff/today' : null, [ownerId]);
  const needs: { label: string; n: number | null; href: string }[] = [];
  if (appr) needs.push({ label: 'Bills and payments to approve', n: appr.count, href: '/approvals' });
  if (pnl) needs.push({ label: 'Bank lines to categorise', n: pnl.uncategorised.count, href: '/transactions' });
  if (today) needs.push({ label: 'UPI payments to check', n: today.awaitingVerification, href: '/bookings/payments' });
  needs.push({ label: 'Close the month, step by step', n: null, href: '/close' });
  const shown = needs.filter((x) => navVisible(me, { to: x.href, label: '', icon: '', ...(x.href === '/close' ? { check: () => can(me, 'view_revenue') } : {}) }));
  return (
    <div className="dfin">
      <div className="dfin-hd"><span className="eyebrow">{rail.eyebrow}</span><h1>{rail.label}</h1></div>
      <div className="dfin-row">
        <div className="dorbit">
          <div className="dorbit-ring" />
          <div className="dorbit-core"><span>{rail.label}</span><b>What do you need to do?</b></div>
          {jobs.slice(0, 4).map((g, i) => (
            <div key={g.group} className="dorbit-card" style={{ left: `${POS[i]![0]}%`, top: `${POS[i]![1]}%`, borderTopColor: COL[i] }}>
              <a className="dorbit-name" href={`#${hrefOf(g.items[0]!)}`}>
                <span className="dorbit-n" style={{ background: COL[i] }}>{i + 1}</span>
                <span><b>{g.group}</b><span>{BLURBS[g.group]}</span></span>
              </a>
              <div className="dorbit-pages">{g.items.map((p) => <a key={hrefOf(p)} className="dchip" href={`#${hrefOf(p)}`}>{p.label}</a>)}</div>
            </div>))}
        </div>
        <aside className="dcard dneeds">
          <span className="eyebrow">Start here</span>
          <h2>Needs you today</h2>
          {shown.map((x) => <a key={x.label} className="dneed" href={`#${x.href}`}><span>{x.label}</span>{x.n != null && <b className="dneed-n">{x.n}</b>}</a>)}
        </aside>
      </div>
    </div>
  );
}

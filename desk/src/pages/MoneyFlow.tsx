import { useSession } from '../App';
import { PageHead, Loading, ErrorBox, Icon } from '../ui';
import { useApi, go, inr, inrShort, monthLabel, thisMonth } from '../lib';

// The starter kit's money flow: what was earned, then collected, then banked, then paid out, with the gap at each step.
interface Flow {
  month: string;
  earned: { totalPaise: number; bookingsPaise: number; membershipsPaise: number; academyPaise: number };
  collected: { totalPaise: number; bookingsPaise: number; membershipsPaise: number; academyPaise: number };
  banked: { totalPaise: number; bankPaise: number; cashPaise: number };
  paidOut: { totalPaise: number; billsPaise: number; payrollPaise: number; otherPaise: number };
  toCollectPaise: number;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const shift = (m: string, n: number) => { const [y, mo] = m.split('-').map(Number) as [number, number]; return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7); };

function Stage({ step, title, total, lines, href, tone }: { step: number; title: string; total: number; lines: [string, number][]; href: string; tone: string }) {
  return (
    <a className={`flow-stage t-${tone}`} href={`#${href}`}>
      <span className="flow-step">{step}</span>
      <span className="eyebrow">{title}</span>
      <span className="flow-total num">{inr(total)}</span>
      <span className="flow-lines">{lines.filter(([, v]) => v).map(([l, v]) => <span key={l}><span>{l}</span><span className="num">{inr(v)}</span></span>)}</span>
    </a>
  );
}
function Gap({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="flow-gap" title={hint}>
      <Icon name="chevron" />
      <span className={`flow-gap-v num${value > 0 ? ' warn' : ''}`}>{inrShort(Math.max(0, value))}</span>
      <span className="small muted">{label}</span>
    </div>
  );
}

export default function MoneyFlow({ sub }: { sub: string }) {
  const { ownerId } = useSession();
  const month = /^\d{4}-\d{2}$/.test(sub) ? sub : thisMonth();
  const [data, err] = useApi<{ current: Flow; trend: Flow[] }>(`/api/desk/money-flow?month=${month}`, [ownerId]);
  const [y, mo] = month.split('-').map(Number) as [number, number];
  const c = data?.current;
  const max = Math.max(1, ...(data?.trend ?? []).flatMap((f) => [f.earned.totalPaise, f.collected.totalPaise, f.banked.totalPaise, f.paidOut.totalPaise]));
  const bar = (v: number, tone: string) => <span className="flow-bar"><i className={`t-${tone}`} style={{ width: `${(Math.max(0, v) / max) * 100}%`, minWidth: v > 0 ? 2 : 0 }} /><span className="num">{inrShort(v)}</span></span>;

  return (
    <div className="stack">
      <PageHead eyebrow="Earned → collected → banked → paid out" title={`Money flow · ${MONTHS[mo - 1]} ${y}`} lede="Follow the month's money from the bookings, memberships and academy fees that earned it, to the payments that collected it, into the bank, and out again as bills and salaries.">
        <button className="btn sm" aria-label="Previous month" onClick={() => go(`/money/${shift(month, -1)}`)}>‹</button>
        <button className="btn sm" onClick={() => go('/money')}>This month</button>
        <button className="btn sm" aria-label="Next month" onClick={() => go(`/money/${shift(month, 1)}`)}>›</button>
      </PageHead>
      <ErrorBox msg={err} />
      {!c ? (!err && <Loading h={260} />) : (<>
        <div className="flow">
          <Stage step={1} title="Earned" tone="blue" total={c.earned.totalPaise} href="/bookings" lines={[['Sessions this month', c.earned.bookingsPaise], ['Memberships sold', c.earned.membershipsPaise], ['Academy fees billed', c.earned.academyPaise]]} />
          <Gap label="still to collect" value={c.toCollectPaise} hint="Booking balances and academy fees for this month that are not paid yet" />
          <Stage step={2} title="Collected" tone="teal" total={c.collected.totalPaise} href="/bookings/payments" lines={[['Booking payments', c.collected.bookingsPaise], ['Memberships', c.collected.membershipsPaise], ['Academy fees', c.collected.academyPaise]]} />
          <Gap label="not yet in the books" value={c.collected.totalPaise - c.banked.totalPaise} hint="Collected this month but not yet seen in an imported bank statement or the cash book" />
          <Stage step={3} title="Banked" tone="green" total={c.banked.totalPaise} href="/bank" lines={[['Into the bank', c.banked.bankPaise], ['Into the cash book', c.banked.cashPaise]]} />
          <Gap label="kept this month" value={c.banked.totalPaise - c.paidOut.totalPaise} hint="Money in less money out this month" />
          <Stage step={4} title="Paid out" tone="amber" total={c.paidOut.totalPaise} href="/bills" lines={[['Bills paid', c.paidOut.billsPaise], ['Salaries paid', c.paidOut.payrollPaise], ['Other spending in the books', c.paidOut.otherPaise]]} />
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>Banked and other spending come from the bank statements and cash book in Accounting, so they fill in once this month's statement is imported. Salaries paid by bank transfer can show under both salaries and other spending until that line is linked.</p>
        <section className="card">
          <div className="card-head"><h3>The last six months</h3></div>
          <div className="tbl-wrap">
            <table className="tbl flow-trend">
              <thead><tr><th>Month</th><th>Earned</th><th>Collected</th><th>Banked</th><th>Paid out</th></tr></thead>
              <tbody>{data!.trend.map((f) => (
                <tr key={f.month} className={f.month === month ? 'on' : ''} onClick={() => go(`/money/${f.month}`)} style={{ cursor: 'pointer' }}>
                  <td>{monthLabel(f.month)}</td><td>{bar(f.earned.totalPaise, 'blue')}</td><td>{bar(f.collected.totalPaise, 'teal')}</td><td>{bar(f.banked.totalPaise, 'green')}</td><td>{bar(f.paidOut.totalPaise, 'amber')}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </section>
      </>)}
    </div>
  );
}

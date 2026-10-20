import { useSession } from '../App';
import { PageHead, Loading, ErrorBox, Icon } from '../ui';
import { useApi, go } from '../lib';

// The starter kit's orbit hub: one score for the ground in the middle, the parts of the business around it.
interface Part { key: string; title: string; score: number; line: string; rule: string; href: string }
const ICON: Record<string, string> = { use: 'calendar', queue: 'check', collect: 'payments', bills: 'billing', books: 'accounts', jobs: 'tasks', academy: 'grad', compliance: 'audit' };
const tone = (s: number) => (s >= 80 ? 'green' : s >= 50 ? 'amber' : 'red');
const word = (s: number) => (s >= 80 ? 'Healthy' : s >= 50 ? 'Needs a look' : 'Needs work');

export default function Health({ sub }: { sub: string }) {
  void sub;
  const { ownerId } = useSession();
  const [d, err, reload] = useApi<{ score: number | null; parts: Part[] }>('/api/desk/health', [ownerId]);
  const parts = d?.parts ?? [];
  const R = 41; // ring radius in % of the orbit box
  return (
    <div className="stack">
      <PageHead eyebrow="The whole ground at a glance" title="Ground health" lede="Each part of the business gets a score out of 100 from a simple rule, shown under it. The middle is the average. Open a part to fix what pulls it down.">
        <button className="btn sm" onClick={() => reload()}><Icon name="repeat" />Refresh</button>
      </PageHead>
      <ErrorBox msg={err} />
      {!d ? (!err && <Loading h={520} />) : !parts.length ? <p className="muted">Your login has no part of the business to score.</p> : (<>
        <div className="orbit" aria-label="Ground health">
          <svg className="orbit-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r={R} /></svg>
          <div className={`orbit-core t-${tone(d.score ?? 0)}`}>
            <span className="eyebrow">Ground health</span>
            <span className="orbit-score num">{d.score}</span>
            <span className="small">{word(d.score ?? 0)}</span>
          </div>
          {parts.map((p, i) => {
            const a = (i / parts.length) * 2 * Math.PI - Math.PI / 2;
            return (
              <button key={p.key} className={`orbit-node t-${tone(p.score)}`} style={{ left: `${50 + R * Math.cos(a)}%`, top: `${50 + R * Math.sin(a)}%` }} onClick={() => go(p.href)} title={p.line}>
                <span className="orbit-ic" aria-hidden="true"><Icon name={ICON[p.key] ?? 'dashboard'} size={16} /></span>
                <b>{p.title}</b><span className="num">{p.score}</span>
              </button>);
          })}
        </div>
        <section className="card">
          <div className="card-head"><h3>How each part is scored</h3></div>
          <ul className="hub-list">
            {parts.map((p) => (
              <li key={p.key}>
                <span className={`hub-score num t-${tone(p.score)}`}>{p.score}</span>
                <span className="hub-main"><b>{p.title}</b><span>{p.line}</span><span className="small muted">{p.rule}</span></span>
                <button className="btn sm" onClick={() => go(p.href)}>Open<Icon name="chevron" size={14} /></button>
              </li>))}
          </ul>
        </section>
      </>)}
    </div>
  );
}

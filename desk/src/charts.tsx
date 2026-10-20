import { useState, useEffect, useRef } from 'react';
import { inr, inrShort, monthLabel } from './lib';

/**
 * Billed vs collected, by month. "Billed" is the target, drawn as a faint outlined bar;
 * "Collected" is the actual, drawn as a solid gold bar inside it. Hover any month for exact values.
 */
export function CollectionChart({ data }: { data: { period: string; billed: number; collected: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(640);
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setCw(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(box.current); return () => ro.disconnect();
  }, []);
  // Draw in real pixels so labels stay readable on phones.
  const W = cw, H = cw < 480 ? 220 : 240, L = 54, R = 8, T = 18, B = 30;
  const max = Math.max(1, ...data.map((d) => Math.max(d.billed, d.collected)));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const slot = (W - L - R) / data.length;
  const bw = Math.min(46, slot * 0.56);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  return (
    <div ref={box}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="legend" aria-hidden="true">
          <span><i style={{ background: 'var(--gold-chart)' }} />Collected</span>
          <span><i style={{ background: 'transparent', border: '1px solid var(--gold-lo)' }} />Billed</span>
        </div>
        <button className="btn ghost sm" onClick={() => setTable(!table)}>{table ? 'Show chart' : 'Show table'}</button>
      </div>
      {table ? (
        <table className="tbl">
          <thead><tr><th>Month</th><th className="num">Billed</th><th className="num">Collected</th><th className="num">Rate</th></tr></thead>
          <tbody>{data.map((d) => (
            <tr key={d.period}><td>{monthLabel(d.period)}</td><td className="num">{inr(d.billed)}</td><td className="num">{inr(d.collected)}</td>
              <td className="num">{d.billed ? Math.round((d.collected / d.billed) * 100) + '%' : '—'}</td></tr>
          ))}</tbody>
        </table>
      ) : (
        <div className="chart" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Billed versus collected rent by month">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
                <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{inrShort(t)}</text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = L + slot * i + slot / 2;
              const on = hover === i;
              const rate = d.billed ? Math.round((d.collected / d.billed) * 100) : null;
              return (
                <g key={d.period}>
                  <rect x={L + slot * i} y={T} width={slot} height={H - T - B} fill={on ? 'var(--surface2)' : 'transparent'}
                    onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${monthLabel(d.period)}: billed ${inr(d.billed)}, collected ${inr(d.collected)}`} />
                  {d.billed > 0 && <path d={barPath(cx - bw / 2, y(d.billed), bw, y(0) - y(d.billed))} fill="var(--soft2)" stroke="var(--strong)" strokeWidth={1.2} pointerEvents="none" />}
                  {d.collected > 0 && <path d={barPath(cx - bw / 2 + 5, y(d.collected), bw - 10, y(0) - y(d.collected))} fill={on ? 'var(--link)' : 'var(--strong)'} pointerEvents="none" />}
                  {i === data.length - 1 && rate != null && (
                    <text x={cx} y={y(Math.max(d.billed, d.collected)) - 7} textAnchor="middle" fontSize="11.5" fill="var(--ink)" fontWeight="600">{rate}%</text>
                  )}
                  <text x={cx} y={H - 10} textAnchor="middle" fontSize="11.5" fill={on ? 'var(--ink)' : 'var(--muted)'}>{monthLabel(d.period)}</text>
                </g>
              );
            })}
            <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" strokeWidth={1} />
          </svg>
          {hover != null && (() => {
            const d = data[hover]; const cx = ((L + slot * hover + slot / 2) / W) * 100;
            return (
              <div className="tip" style={{ left: `${cx}%`, top: `${(y(Math.max(d.billed, d.collected)) / H) * 100}%`, marginTop: -10 }}>
                <div style={{ color: 'var(--gold-hi)', fontWeight: 700, marginBottom: 4 }}>{monthLabel(d.period)}</div>
                <div>Billed <b>{inr(d.billed)}</b></div>
                <div>Collected <b>{inr(d.collected)}</b>{d.billed ? <span className="muted"> · {Math.round((d.collected / d.billed) * 100)}%</span> : null}</div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

/** Bar with 4px rounded top, square at the baseline. */
function barPath(x: number, y: number, w: number, h: number) {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Occupancy ring for units: rented share of total. */
export function Ring({ value, total, label }: { value: number; total: number; label: string }) {
  const pct = total ? value / total : 0; const r = 46, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 120 120" width="120" height="120" role="img" aria-label={`${label}: ${Math.round(pct * 100)}%`}>
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--soft)" strokeWidth="9" />
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--strong)" strokeWidth="9" strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 60 60)" />
      <text x="60" y="58" textAnchor="middle" fontSize="24" fontWeight="500" fill="var(--ink)" fontFamily="Cormorant Garamond, Georgia, serif">{Math.round(pct * 100)}%</text>
      <text x="60" y="76" textAnchor="middle" fontSize="9.5" fill="var(--muted)" letterSpacing="1.5">{label.toUpperCase()}</text>
    </svg>
  );
}

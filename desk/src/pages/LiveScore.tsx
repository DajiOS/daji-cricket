// Live score: every match being scored right now, its score updating by itself, and the matches still to start.
import { useEffect } from 'react';
import { Chip, Empty, ErrorBox, Loading, PageHead } from '../ui';
import { go, useApi } from '../lib';
import type { Match } from '../parts/club/MatchDialog';
import Scoreboard, { type Score } from '../parts/club/Scoreboard';

const EVERY_MS = 5000;

/** Reloads every few seconds while the page is open, so the score moves as balls are scored. */
function usePoll(reload: () => void) {
  useEffect(() => { const t = setInterval(reload, EVERY_MS); return () => clearInterval(t); }, [reload]);
}

export default function LiveScore() {
  const [data, error, reload] = useApi<{ items: Match[] }>('/api/staff/matches');
  usePoll(reload);
  const live = (data?.items ?? []).filter((m) => m.status === 'live');
  const next = (data?.items ?? []).filter((m) => m.status === 'scheduled');
  return (
    <div className="stack">
      <PageHead eyebrow="Today" title="Live score" lede="Every match being scored right now. The score updates by itself every few seconds.">
        <button className="btn ghost" onClick={() => go('/matches')}>All fixtures</button>
      </PageHead>
      {error ? <ErrorBox msg={error} /> : !data ? <Loading h={200} /> : !live.length ? (
        <div className="card"><Empty>No match is being scored right now. Start one from Fixtures and it shows here.</Empty></div>
      ) : live.map((m) => <LiveMatch key={m.id} m={m} />)}
      {next.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>Still to start</h3></div>
          <div className="card-pad stack">
            {next.map((m) => (
              <div className="row" key={m.id}>
                <span className="strong">{m.teamA} v {m.teamB}</span><span className="muted small">{m.title} · {m.overs} overs</span>
                <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => go('/matches/' + m.id)}>Start scoring</button>
              </div>))}
          </div>
        </div>)}
    </div>
  );
}

function LiveMatch({ m }: { m: Match }) {
  const [sc, err, reload] = useApi<Score>(`/api/staff/matches/${m.id}`);
  usePoll(reload);
  return (
    <section className="stack" aria-label={`${m.teamA} v ${m.teamB}`}>
      <div className="row">
        <h2 style={{ margin: 0 }}>{m.teamA} v {m.teamB}</h2>
        <Chip tone="bad">Live</Chip>
        <span className="muted small">{m.title} · {m.overs} overs</span>
        <button className="btn primary sm" style={{ marginLeft: 'auto' }} onClick={() => go('/matches/' + m.id)}>Score</button>
      </div>
      {err ? <ErrorBox msg={err} /> : !sc ? <Loading h={160} /> : <Scoreboard sc={sc} />}
    </section>
  );
}

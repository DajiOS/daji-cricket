import { useApi, go, fmtDateTime } from '../../lib';
import { Loading, ErrorBox, Chip, Stat } from '../../ui';
import { Panel } from './common';

type State = 'done' | 'todo' | 'warn' | 'you';
interface Item { id: string; group: string; label: string; state: State; detail: string; fix: string | null; link: string | null }
interface Readiness { at: number; openingDay: string; daysToOpening: number | null; done: number; total: number; items: Item[] }

const CHIP: Record<State, ['good' | 'bad' | 'warn' | 'info', string]> = { done: ['good', 'Done'], todo: ['bad', 'To do'], warn: ['warn', 'Check'], you: ['info', 'You'] };

/** Everything on the "before opening day" list the software can see, with where to fix each one. Settings are named, never shown. */
export default function GoLive() {
  const [r, error, reload] = useApi<Readiness>('/api/admin/readiness');
  if (error) return <ErrorBox msg={error} />;
  if (!r) return <Loading />;
  const groups = [...new Set(r.items.map((i) => i.group))];
  const todo = r.items.filter((i) => i.state === 'todo').length;
  return (
    <div className="stack">
      <div className="grid g3">
        <Stat label="Ready" value={`${r.done} of ${r.total}`} meter={(r.done / Math.max(1, r.total)) * 100} foot={`Checked ${fmtDateTime(r.at)}`} />
        <Stat label="Opening day" value={r.openingDay || 'Not set'} foot={r.daysToOpening == null ? 'Set it under Booking window' : r.daysToOpening > 0 ? `${r.daysToOpening} days to go` : r.daysToOpening === 0 ? 'Today' : 'Open'} />
        <Stat label="Still to do" value={todo} foot={todo ? 'Red items block opening' : 'Nothing blocking'} />
      </div>
      {groups.map((g) => (
        <Panel key={g} title={g} actions={g === groups[0] ? <button className="btn sm" onClick={reload}>Check again</button> : undefined}>
          <div className="golive">
            {r.items.filter((i) => i.group === g).map((i) => (
              <div key={i.id} className="golive-row">
                <Chip tone={CHIP[i.state][0]}>{CHIP[i.state][1]}</Chip>
                <div className="golive-text">
                  <div className="golive-label">{i.label}</div>
                  <div className="hint">{i.detail}{i.state !== 'done' && i.fix ? ` ${i.fix}` : ''}</div>
                </div>
                {i.link && i.state !== 'done' && <button className="btn ghost sm" onClick={() => go(i.link!)}>Open</button>}
              </div>
            ))}
          </div>
        </Panel>
      ))}
      <div className="hint">Secret settings (payment keys, tokens, passwords) are only ever named here, never shown. Put them in deploy/.env on the server, not in the desk, chat or git.</div>
    </div>
  );
}


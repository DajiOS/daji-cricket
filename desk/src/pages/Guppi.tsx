import { PageHead, Load, Icon, Table } from '../ui';
import { useApi, fmtDateTime } from '../lib';
import { askAssistant, AskBox } from '../CommandSearch';

// Guppi for the team: ask a question about the business, and what it can and cannot do. Answers come from the server's read-only
// report tools, limited to what this login may see. Guppi never changes a booking, a payment or the books.
const TABS: [string, string][] = [['', 'Ask'], ['history', 'History'], ['actions', 'Available actions']];

export default function Guppi({ sub }: { sub: string }) {
  const first = sub.split('/')[0];
  const tab = first === 'actions' || first === 'history' ? first : '';
  const [ex, err, reload, status] = useApi<{ items: string[]; claudeEnabled: boolean }>('/api/staff/ask/examples');
  return (
    <div className="stack">
      <PageHead eyebrow="Guppi" title="Ask Guppi" lede="Ask about bookings, money, jobs or the team in your own words. Guppi reads your own data, only what your login may see, and never changes anything." />
      <div role="tablist" aria-label="Guppi" className="dtabs ws-tabs">
        {TABS.map(([k, l]) => <a key={k} role="tab" aria-selected={tab === k} className={`dchip${tab === k ? ' on' : ''}`} href={k ? `#/guppi/${k}` : '#/guppi'}>{l}</a>)}
      </div>
      {tab === '' && (
        <div className="card card-pad stack">
          <AskBox />
          <Load data={ex} error={err} status={status} retry={reload} isEmpty={(x) => !x.items.length} empty="No example questions for this login.">{(x) => (
            <div className="stack" style={{ gap: 8 }}>
              <div className="eyebrow">Try one of these</div>
              <div className="ai-ex">{x.items.slice(0, 8).map((q) => <button key={q} type="button" onClick={() => askAssistant(q)}>{q}</button>)}</div>
              {!x.claudeEnabled && <p className="small muted">Guppi is answering from the built-in reports. The owner can add the AI key on the server to let it answer anything else.</p>}
            </div>)}</Load>
        </div>)}
      {tab === 'history' && <History />}
      {tab === 'actions' && (
        <div className="grid g2">
          <div className="card card-pad stack" style={{ gap: 8 }}>
            <div className="eyebrow"><Icon name="check" size={14} /> Guppi can</div>
            <ul className="small">
              <li>Answer questions from the bookings, payments, customers, jobs and books reports.</li>
              <li>Say which report or figure the answer came from.</li>
              <li>Suggest the next question and the page where the work is done.</li>
            </ul>
          </div>
          <div className="card card-pad stack" style={{ gap: 8 }}>
            <div className="eyebrow"><Icon name="lock" size={14} /> Guppi cannot</div>
            <ul className="small">
              <li>Make, move, cancel or refund a booking, or record a payment.</li>
              <li>Change prices, settings, the books or anyone's access.</li>
              <li>See anything this login is not allowed to see.</li>
              <li>Keep its answers: History lists your questions, and an answer is worked out again when you ask.</li>
            </ul>
          </div>
        </div>)}
    </div>
  );
}

/** This login's own recent questions. Pressing one asks it again. */
function History() {
  const [d, err, reload, status] = useApi<{ items: { id: number; at: number; question: string; source: string | null }[] }>('/api/staff/ask/history');
  return (
    <div className="card">
      <Load data={d} error={err} status={status} retry={reload} isEmpty={(x) => !x.items.length} empty="You have not asked Guppi anything yet.">{(x) => (
        <Table rows={x.items} rowKey={(r) => r.id} cols={[
          { head: 'Asked', cell: (r) => fmtDateTime(r.at) },
          { head: 'Question', cell: (r) => <button type="button" className="link" onClick={() => askAssistant(r.question)}>{r.question}</button> },
          { head: 'Answered by', cell: (r) => (r.source === 'claude' ? 'AI from your reports' : 'Built-in reports') },
        ]} />)}</Load>
    </div>
  );
}

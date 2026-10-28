import { useState } from 'react';
import { Chip, PageHead, Stat, Table, Tabs } from '../ui';
import { go, useApi } from '../lib';
import { Async } from '../parts/club/common';
import MatchDialog, { type Match } from '../parts/club/MatchDialog';
import Scorer from '../parts/club/Scorer';
import LiveNow from '../parts/club/LiveNow';
import Leaders from '../parts/club/Leaders';

// Fixtures: every match, its Live now tab (the register's Live score, at /matches/live; the old /live opens it too) and Player records
// (/matches/leaders: the career leaders from scored matches). /matches/<id> scores one.
const TABS: [string, string][] = [['all', 'All fixtures'], ['live', 'Live now'], ['leaders', 'Player records']];

export default function Matches({ sub }: { sub: string }) {
  const id = sub.split('/')[0] || '';
  if (id && id !== 'live' && id !== 'leaders') return <div className="stack"><PageHead eyebrow="Match day" title="Score a match" lede="Ball by ball from your phone; the public live page updates by itself." /><Scorer key={id} id={id} back={() => go('/matches')} /></div>;
  return <List tab={id === 'live' ? 'live' : id === 'leaders' ? 'leaders' : 'all'} />;
}

function List({ tab }: { tab: string }) {
  const [data, error, reload] = useApi<{ items: Match[] }>('/api/staff/matches');
  const [dlg, setDlg] = useState<Match | 'new' | null>(null);
  const items = data?.items ?? [];
  return (
    <div className="stack">
      <PageHead eyebrow="Ground" title="Fixtures" lede="Create a match, score it ball by ball from your phone, and the public live page updates by itself. Add a YouTube live link and viewers can watch from the same page.">
        <button className="btn primary" onClick={() => setDlg('new')}>New match</button>
      </PageHead>
      <div><Tabs value={tab} onChange={(k) => go(k === 'all' ? '/matches' : `/matches/${k}`)} items={TABS} label="Fixtures" /></div>
      {tab === 'live' ? <LiveNow /> : tab === 'leaders' ? <Leaders /> : <>
      {data && <div className="grid g3"><Stat label="Matches" value={items.length} /><Stat label="Live now" value={items.filter((m) => m.status === 'live').length} /><Stat label="On the public page" value={items.filter((m) => m.isPublic).length} /></div>}
      <div className="card">
        <Async data={data} error={error}>{(d) => (
          <Table rows={d.items} empty="No matches yet." onRow={(m) => go('/matches/' + m.id)} cols={[
            { head: 'Match', cell: (m) => <><span className="strong nw">{m.teamA} v {m.teamB}</span><div className="muted small nw">{m.title}</div></> },
            { head: 'Overs', num: true, cell: (m) => m.overs },
            { head: 'Status', cell: (m) => <Chip tone={m.status === 'live' ? 'bad' : m.status === 'completed' ? 'good' : 'mute'}>{m.result || (m.status === 'completed' ? 'Final' : m.status === 'live' ? 'Live' : m.status)}</Chip> },
            { head: 'Visible', cell: (m) => (m.isPublic ? <Chip tone="info">Public</Chip> : <Chip>Private</Chip>) },
            { head: '', cell: (m) => <div className="row end" onClick={(e) => e.stopPropagation()}><button className="btn primary sm" onClick={() => go('/matches/' + m.id)}>Score</button><button className="btn ghost sm" onClick={() => setDlg(m)}>Settings</button></div> },
          ]} />
        )}</Async>
      </div>
      </>}
      {dlg && <MatchDialog m={dlg === 'new' ? null : dlg} onClose={() => setDlg(null)} onSaved={reload} />}
    </div>
  );
}

import { useState } from 'react';
import { PageHead, Tabs } from '../ui';
import { go } from '../lib';
import { Txns } from '../parts/books/Txns';
import { Importer } from '../parts/books/Importer';

// Banking: every bank and cash line, and (its second tab) the bank feed and statement import that bring them in. The old Bank import page
// (/bank) opens the Import tab (routes.ts, MERGED).
const TABS: [string, string][] = [['lines', 'Bank lines'], ['import', 'Import and bank feed']];

/** sub: "import", or "pending", "posted" or "all", optionally followed by "/<accountId>". */
export default function Transactions({ sub }: { sub: string }) {
  const [tab, acct] = sub.split('/');
  const [a, setA] = useState<{ add: () => void; move: () => void } | null>(null);
  const importing = tab === 'import';
  return (
    <div className="stack">
      <PageHead eyebrow="Finance" title="Banking" lede={importing ? 'Connect a bank feed, or load a statement. Every transaction is checked, then read into your books.' : 'Every bank and cash line. Give each one a category so the profit and loss is complete.'}>
        {!importing && <><button className="btn" onClick={() => a?.move()}>Move money</button>
        <button className="btn primary" onClick={() => a?.add()}>Add a transaction</button></>}
      </PageHead>
      <div className="bk-tabs no-print"><Tabs value={importing ? 'import' : 'lines'} onChange={(k) => go(k === 'import' ? '/transactions/import' : '/transactions')} items={TABS} label="Banking sections" /></div>
      {importing ? <Importer /> : <Txns initialTab={tab === 'posted' || tab === 'all' ? tab : 'pending'} initialAccount={acct || ''} actions={setA} />}
    </div>
  );
}

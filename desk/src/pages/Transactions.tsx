import { useState } from 'react';
import { PageHead } from '../ui';
import { Txns } from '../parts/books/Txns';

/** sub: "pending", "posted" or "all", optionally followed by "/<accountId>". */
export default function Transactions({ sub }: { sub: string }) {
  const [tab, acct] = sub.split('/');
  const [a, setA] = useState<{ add: () => void; move: () => void } | null>(null);
  return (
    <div className="stack">
      <PageHead eyebrow="Finance" title="Transactions" lede="Every bank and cash line. Give each one a category so the profit and loss is complete.">
        <button className="btn" onClick={() => a?.move()}>Move money</button>
        <button className="btn primary" onClick={() => a?.add()}>Add a transaction</button>
      </PageHead>
      <Txns initialTab={tab === 'posted' || tab === 'all' ? tab : 'pending'} initialAccount={acct || ''} actions={setA} />
    </div>
  );
}

import { PageHead, Empty } from '../ui';

export default function Transactions({ sub }: { sub: string }) {
  void sub;
  return <div className="stack"><PageHead eyebrow="Coming together" title="Transactions" /><Empty>This page is being built.</Empty></div>;
}

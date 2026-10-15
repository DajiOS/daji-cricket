import { PageHead, Empty } from '../ui';

export default function Promos({ sub }: { sub: string }) {
  void sub;
  return <div className="stack"><PageHead eyebrow="Coming together" title="Promos" /><Empty>This page is being built.</Empty></div>;
}

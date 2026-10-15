import { PageHead, Empty } from '../ui';

export default function Accounting({ sub }: { sub: string }) {
  void sub;
  return <div className="stack"><PageHead eyebrow="Coming together" title="Accounting" /><Empty>This page is being built.</Empty></div>;
}

import { PageHead, Empty } from '../ui';

export default function Dashboard({ sub }: { sub: string }) {
  void sub;
  return <div className="stack"><PageHead eyebrow="Coming together" title="Dashboard" /><Empty>This page is being built.</Empty></div>;
}

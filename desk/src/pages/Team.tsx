import { PageHead, Empty } from '../ui';

export default function Team({ sub }: { sub: string }) {
  void sub;
  return <div className="stack"><PageHead eyebrow="Coming together" title="Team" /><Empty>This page is being built.</Empty></div>;
}

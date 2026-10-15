import { PageHead, Empty } from '../ui';

export default function Matches({ sub }: { sub: string }) {
  void sub;
  return <div className="stack"><PageHead eyebrow="Coming together" title="Matches" /><Empty>This page is being built.</Empty></div>;
}

import { PageHead, Empty } from '../ui';

export default function Tournaments({ sub }: { sub: string }) {
  void sub;
  return <div className="stack"><PageHead eyebrow="Coming together" title="Tournaments" /><Empty>This page is being built.</Empty></div>;
}

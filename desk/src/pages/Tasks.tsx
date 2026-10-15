import { PageHead, Empty } from '../ui';

export default function Tasks({ sub }: { sub: string }) {
  void sub;
  return <div className="stack"><PageHead eyebrow="Coming together" title="Tasks" /><Empty>This page is being built.</Empty></div>;
}

import { PageHead, Empty } from '../ui';

export default function Platform({ sub }: { sub: string }) {
  void sub;
  return <div className="stack"><PageHead eyebrow="Coming together" title="Platform" /><Empty>This page is being built.</Empty></div>;
}

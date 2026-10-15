import { PageHead, Empty } from '../ui';

export default function Approvals({ sub }: { sub: string }) {
  void sub;
  return <div className="stack"><PageHead eyebrow="Coming together" title="Approvals" /><Empty>This page is being built.</Empty></div>;
}

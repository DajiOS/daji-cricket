import { PageHead, Empty } from '../ui';

export default function Memberships({ sub }: { sub: string }) {
  void sub;
  return <div className="stack"><PageHead eyebrow="Coming together" title="Memberships" /><Empty>This page is being built.</Empty></div>;
}

import { PageHead, Empty } from '../ui';

export default function Contacts({ sub }: { sub: string }) {
  void sub;
  return <div className="stack"><PageHead eyebrow="Coming together" title="Contacts" /><Empty>This page is being built.</Empty></div>;
}

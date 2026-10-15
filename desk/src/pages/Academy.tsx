import { PageHead, Empty } from '../ui';

export default function Academy({ sub }: { sub: string }) {
  void sub;
  return <div className="stack"><PageHead eyebrow="Coming together" title="Academy" /><Empty>This page is being built.</Empty></div>;
}

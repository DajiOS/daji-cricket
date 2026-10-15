import { PageHead, Empty } from '../ui';

export default function Settings({ sub }: { sub: string }) {
  void sub;
  return <div className="stack"><PageHead eyebrow="Coming together" title="Settings" /><Empty>This page is being built.</Empty></div>;
}

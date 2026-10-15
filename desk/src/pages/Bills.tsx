import { PageHead, Empty } from '../ui';

export default function Bills({ sub }: { sub: string }) {
  void sub;
  return <div className="stack"><PageHead eyebrow="Coming together" title="Bills" /><Empty>This page is being built.</Empty></div>;
}

import { PageHead, Empty } from '../ui';

export default function Payroll({ sub }: { sub: string }) {
  void sub;
  return <div className="stack"><PageHead eyebrow="Coming together" title="Payroll" /><Empty>This page is being built.</Empty></div>;
}

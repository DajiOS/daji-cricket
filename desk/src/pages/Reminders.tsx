import { PageHead, Empty } from '../ui';

export default function Reminders({ sub }: { sub: string }) {
  void sub;
  return <div className="stack"><PageHead eyebrow="Coming together" title="Reminders" /><Empty>This page is being built.</Empty></div>;
}

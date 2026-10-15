import { PageHead, Empty } from '../ui';

export default function BankImport({ sub }: { sub: string }) {
  void sub;
  return <div className="stack"><PageHead eyebrow="Coming together" title="BankImport" /><Empty>This page is being built.</Empty></div>;
}

import { PageHead } from '../ui';
import { Importer } from '../parts/books/Importer';

export default function BankImport({ sub }: { sub: string }) {
  void sub;
  return (
    <div className="stack">
      <PageHead eyebrow="Finance" title="Bank import" lede="Connect a bank feed, or load a statement. Every transaction is checked, then read into your books." />
      <Importer />
    </div>
  );
}

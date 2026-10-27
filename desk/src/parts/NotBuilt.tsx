import { PageHead } from '../ui';
import type { RegisterRoute } from '../routes';

/** A register address that nothing in this desk serves yet. It says so plainly, instead of showing an empty page that reads as "nothing here". */
export function NotBuilt({ row }: { row: RegisterRoute }) {
  return (
    <div className="stack">
      <PageHead eyebrow={row.section} title={row.label} />
      <div className="state state-missing" data-state="not-built" role="status">
        <b>{row.finding === 'NOT APPLICABLE' ? 'This is not part of the cricket desk.' : 'This page is not built yet.'}</b>
        <span className="small">{row.note}</span>
        <span className="small muted">Register row {row.row} · {row.route}</span>
      </div>
    </div>
  );
}

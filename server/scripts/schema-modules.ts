// Loads every schema module the server registers (each file that calls registerSchema), for the schema lock.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
export const LOCK_PATH = join(SRC, '..', 'schema.lock.json');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

export async function loadSchemaModules(): Promise<Record<string, string>> {
  for (const f of walk(SRC)) if (/registerSchema\(/.test(readFileSync(f, 'utf8'))) await import(pathToFileURL(f).href);
  const { schemaChecksums } = await import(pathToFileURL(join(SRC, 'db.ts')).href);
  return schemaChecksums();
}

export function compareLock(lock: Record<string, string>, current: Record<string, string>) {
  return {
    added: Object.keys(current).filter((id) => !(id in lock)),
    changed: Object.keys(current).filter((id) => id in lock && lock[id] !== current[id]),
    removed: Object.keys(lock).filter((id) => !(id in current)),
  };
}

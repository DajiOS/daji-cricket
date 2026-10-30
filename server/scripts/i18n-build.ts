// Writes the screen word list for the phone app and the website from shared/src/i18n.ts. Run it after changing that file:
//   node server/scripts/i18n-build.ts
import { writeFileSync } from 'node:fs';
import { i18nOutputs } from './i18n-outputs.ts';

for (const o of i18nOutputs()) { writeFileSync(o.path, o.text); console.log(`wrote ${o.path}`); }

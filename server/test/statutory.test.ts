import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statutory, annualTaxNewRegime } from '../src/accounting/statutory.ts';

const base = { payType: 'monthly', ratePaise: 0, grossPaise: 0, bonusPaise: 0, paidDays: 30, pf: false, esi: false, pt: false, tds: false, tdsFixedPaise: 0 };
const R = (n: number) => n * 100;

test('PF: 12% of wages capped at 15,000; employer side includes admin and EDLI', () => {
  const a = statutory({ ...base, grossPaise: R(12000), pf: true });
  assert.equal(a.pfEmployeePaise, R(1440)); assert.equal(a.pfEmployerPaise, R(1440)); assert.equal(a.pfAdminPaise, R(120));
  const b = statutory({ ...base, grossPaise: R(40000), pf: true });
  assert.equal(b.pfEmployeePaise, R(1800));
  assert.equal(statutory({ ...base, grossPaise: R(12000) }).pfEmployeePaise, 0);
});

test('ESI: 0.75% / 3.25% rounded up, only up to 21,000, daily wage under 176 is exempt for the employee', () => {
  const a = statutory({ ...base, grossPaise: R(15000), esi: true });
  assert.equal(a.esiEmployeePaise, R(113)); assert.equal(a.esiEmployerPaise, R(488));
  assert.equal(statutory({ ...base, grossPaise: R(21001), esi: true }).esiEmployerPaise, 0);
  const low = statutory({ ...base, grossPaise: R(5000), esi: true });
  assert.equal(low.esiEmployeePaise, 0); assert.equal(low.esiEmployerPaise, R(163));
});

test('Gujarat PT: nil up to 12,000, 200 above', () => {
  assert.equal(statutory({ ...base, grossPaise: R(12000), pt: true }).ptPaise, 0);
  assert.equal(statutory({ ...base, grossPaise: R(12001), pt: true }).ptPaise, R(200));
  assert.equal(statutory({ ...base, grossPaise: R(30000), pt: false }).ptPaise, 0);
});

test('TDS: new regime, rebate to 12 lakh, slabs above, owner override wins', () => {
  assert.equal(annualTaxNewRegime(R(1275000)), 0);              // 12.75 lakh less 75,000 standard = 12 lakh: rebate
  assert.equal(annualTaxNewRegime(R(1600000)), R(113100));        // 15.25 lakh taxable: 20,000 + 40,000 + 48,750, plus 4% cess
  assert.equal(statutory({ ...base, grossPaise: R(50000), tds: true, tdsFixedPaise: R(900) }).tdsPaise, R(900));
  assert.equal(statutory({ ...base, ratePaise: R(30000), grossPaise: R(30000), tds: true }).tdsPaise, 0); // 3.6 lakh a year: nil
});

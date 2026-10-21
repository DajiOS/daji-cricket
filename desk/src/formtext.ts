// Turns the server's field errors into plain sentences a person can act on ("Enter the mobile number."), instead of "customer.phone: Required".
// No imports, so the server tests can check it directly.

export interface FieldProblem { field: string; message: string }

/** Plain names for the field keys the server sends back. Anything not listed is spelled out from its key (dueDate -> due date). */
const NAMES: Record<string, string> = {
  phone: 'mobile number', mobile: 'mobile number', countryCode: 'country code', email: 'email', password: 'password', newPassword: 'new password',
  currentPassword: 'current password', firstName: 'first name', lastName: 'last name', name: 'name', code: 'code', identifier: 'email or mobile number',
  groundId: 'ground', date: 'date', startTime: 'start time', endTime: 'end time', slots: 'number of hours', players: 'number of players',
  notes: 'note', note: 'note', reference: 'reference', method: 'payment method', amountPaise: 'amount', pricePaise: 'price', totalPaise: 'total',
  customer: 'customer details', payment: 'payment details', title: 'title', body: 'message', message: 'message', vendorId: 'vendor', accountId: 'account',
  planId: 'plan', studentId: 'student', batchId: 'batch', staffId: 'staff member', ownerId: 'business', fromDate: 'start date', toDate: 'end date',
  preferredDate: 'preferred date', dueDate: 'due date', upiId: 'UPI ID', businessName: 'business name', url: 'link', loginUrl: 'login link',
};

/** "customer.phone" -> "mobile number", "billDate" -> "bill date". */
export function fieldName(key: string): string {
  const last = key.split('.').pop() || key;
  if (NAMES[last]) return NAMES[last]!;
  const bare = last.replace(/\[\d+\]$/, '').replace(/(Paise|Id|Ids)$/, '');
  return bare.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase() || 'field';
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const choose = (key: string) => /Id$|Ids$|method$|groundId|kind$|status$|role$/.test(key.split('.').pop() || '');

/** One field problem as a sentence. */
export function fieldSentence(p: FieldProblem): string {
  if (/[.!?]$/.test((p.message || '').trim())) return p.message.trim(); // already a sentence
  const name = fieldName(p.field), m = (p.message || '').trim().replace(/\.$/, '');
  if (!m || /^(required|is required|missing|cannot be empty|must not be empty)$/i.test(m)) return `${choose(p.field) ? 'Choose' : 'Enter'} the ${name}.`;
  // a message that already reads as a sentence stays as it is
  if (/\s/.test(m) && m.split(/\s+/).length > 4 && /^[A-Z]/.test(m) && !/^(Must|Use|At|Not|Too|Should)\b/.test(m)) return m + '.';
  return `${cap(name)}: ${m[0]!.toLowerCase() + m.slice(1)}.`;
}

/** All field problems as one message for the box by the button. */
export function problemsSentence(fields: FieldProblem[]): string {
  const seen = new Set<string>(), out: string[] = [];
  for (const f of fields) { const s = fieldSentence(f); if (!seen.has(s)) { seen.add(s); out.push(s); } }
  return out.join(' ');
}

/** A field key as the form knows it: "customer.phone" is the "phone" field of the form. */
export const formKey = (field: string) => field.split('.').pop()!.replace(/\[\d+\]$/, '');

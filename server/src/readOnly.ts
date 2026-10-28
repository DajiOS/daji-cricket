import { HttpError } from './errors.ts';
import { isReadOnly, listStaff, scopeOwnerId, userRow, type UserRow } from './auth.ts';

// "Read only" team members (the switch on the Team page). They keep every screen their role opens, but the server refuses
// every change they try, here, before any route runs: one rule for desk, iPad, iPhone and Android, old app builds included.
// Looking is never refused, and neither is what only touches their own sign-in on this device.

export const READ_ONLY_MESSAGE = 'This is a view-only account. Changes are switched off.';

/** Requests that change nothing in the business, so a read-only member may still send them. Matched against the path, method POST. */
export const STILL_OPEN: RegExp[] = [
  /^\/api\/auth\/logout(-all)?$/, // signing out
  /^\/api\/me\/push-token(\/remove)?$/, // this phone's notification address
  /^\/api\/legal\/staff-terms\/accept$/, // without it they could not get past the team terms
  /^\/api\/staff\/ask$/, // questions to the assistant: its tools only read (ask/tools.ts)
  /^\/api\/ai-name\/check$/, // checks a name, saves nothing
  // previews and look-ups that are sent as POST but only read
  /^\/api\/staff\/bookings\/[^/]+\/reschedule-preview$/,
  /^\/api\/staff\/broadcasts\/preview$/,
  /^\/api\/desk\/reminders\/preview$/,
  /^\/api\/accounting\/attachment-counts$/,
  /^\/api\/cameras\/view-token$/,
  /^\/api\/guppi\/options$/,
  /^\/api\/availability\/options$/,
];

/** Throws 403 READ_ONLY when a read-only member tries to change something. Called for every signed-in route. */
export function refuseIfReadOnly(user: UserRow | null, method: string, path: string): void {
  if (!user || !isReadOnly(user)) return;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  if (method === 'POST' && STILL_OPEN.some((re) => re.test(path))) return;
  throw new HttpError(403, 'READ_ONLY', READ_ONLY_MESSAGE);
}

// ---- Ask AI: "am I view only?", "who on the team is read only?"

export const isReadOnlyQuestion = (q: string): boolean =>
  /\b(read[- ]?only|view[- ]?only)\b|\bwhy (cant|can'?t|cannot|can not) i (change|edit|save|cancel|add|update|delete|book|record|make changes)\b/i.test(q);

export function readOnlyAnswer(user: UserRow): { answer: string; details: { label: string; text: string }[] } {
  const me = userRow(user.id) ?? user;
  if (me.role === 'staff') {
    return isReadOnly(me)
      ? { answer: `Your login is view-only. You can open and read everything your role allows, but changes are switched off. Only the owner can change this, on the Team page.`, details: [] }
      : { answer: 'Your login is not view-only: you can make the changes your role allows.', details: [] };
  }
  const owner = scopeOwnerId(me);
  const ro = owner ? listStaff(owner).filter((s) => s.active && isReadOnly(s)) : [];
  if (!ro.length) return { answer: 'Nobody on your team is view-only. Tick "Read only" for a member on the Team page to make their login view-only.', details: [] };
  return {
    answer: `${ro.length === 1 ? '1 team member is' : `${ro.length} team members are`} view-only: they can look but cannot change anything.`,
    details: ro.map((s) => ({ label: s.name || s.email || 'Team member', text: 'Read only' })),
  };
}

// API contract shared by the server, the website and the Expo app.
// Money is integer paise. Times are epoch milliseconds. Dates are YYYY-MM-DD in IST (UTC+05:30).

export type Role = 'customer' | 'owner' | 'staff' | 'super_admin';

export const STAFF_PERMISSIONS = [
  'manage_bookings',
  'verify_payments',
  'record_payments',
  'manage_enquiries',
  'manage_grounds',
  'view_customers',
  'view_reports',
  'manage_accounting',
  'send_broadcasts',
  'manage_academy',
  'manage_matches',
  'manage_tasks',
  'view_cameras',
  'view_revenue',
] as const;
export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];

/** Ready-made sets of permissions for common jobs. The owner picks one when adding a team member and can still adjust it. */
export const ROLE_PRESETS: Record<string, { title: string; permissions: StaffPermission[] }> = {
  // An Admin works for the owner with fewer rights: day-to-day bookings, payments, customers, the academy and matches, and reading reports.
  // Not the books (changing them), prices and timings, promo codes, other team members or settings. Those stay with the owner.
  admin: { title: 'Admin', permissions: ['manage_bookings', 'verify_payments', 'record_payments', 'manage_enquiries', 'view_customers', 'view_reports', 'manage_academy', 'manage_matches', 'manage_tasks'] },
  general_manager: { title: 'General manager', permissions: ['manage_bookings', 'verify_payments', 'record_payments', 'manage_enquiries', 'manage_grounds', 'view_customers', 'view_reports', 'send_broadcasts', 'manage_academy', 'manage_matches', 'manage_tasks', 'view_revenue'] },
  coach: { title: 'Coach', permissions: ['manage_academy', 'manage_matches'] },
  front_desk: { title: 'Front desk', permissions: ['manage_bookings', 'verify_payments', 'record_payments', 'manage_enquiries', 'view_customers'] },
  accountant: { title: 'Accountant', permissions: ['view_reports', 'manage_accounting', 'view_revenue'] },
};

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
export interface FieldProblem {
  field: string;
  message: string;
}
export interface ValidationErrorDetails {
  fields: FieldProblem[];
}

export interface Consent {
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
  updatedAt: number | null;
}

export interface User {
  /** The person's own profile picture, or null (the app then shows their initial). */
  avatarUrl: string | null;
  /** False for an account made with a phone code or at the desk: it can set a first password without a current one. */
  hasPassword: boolean;
  id: string;
  role: Role;
  name: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  ownerId: string | null;
  permissions: StaffPermission[];
  active: boolean;
  consent: Consent;
  businessName: string | null;
  upiId: string | null;
  createdAt: number;
}

export interface AuthResult {
  token: string;
  user: User;
}

export interface Ground {
  id: string;
  ownerId: string;
  ownerName: string | null;
  name: string;
  slug: string;
  city: string;
  area: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  /** A Google Maps link the owner pasted (maps.app.goo.gl, google.com/maps, ...). Null if none. */
  mapUrl: string | null;
  /** Where "Get directions" goes: the owner's map link, else a Google Maps pin from lat/lng, else null. */
  directionsUrl: string | null;
  description: string | null;
  facilities: string[];
  images: string[];
  surface: string | null;
  openTime: string; // HH:MM
  closeTime: string; // HH:MM; may run past midnight, up to "27:00" (3 am next morning). These are the summer hours.
  /** Winter hours (null = the same hours all year). Winter runs from winterFromMonth to winterToMonth, e.g. 11 to 2. */
  winterOpenTime: string | null;
  winterCloseTime: string | null;
  winterFromMonth: number;
  winterToMonth: number;
  /** The price list: hourly and fixed-session prices by ball, day and time. When it has any line, customers book from it. */
  rates: RateRule[];
  /** A line shown to customers under the prices, e.g. who to call for custom days. */
  ratesNote: string | null;
  /** Days of the week the ground is shut (0 = Sunday … 6 = Saturday). */
  closedDays: number[];
  slotMinutes: number;
  pricePaise: number;
  weekendPricePaise: number | null;
  eveningSurchargePaise: number;
  eveningFrom: string;
  maxSlots: number;
  formats: PlayFormat[];
  minNoticeMinutes: number;
  advanceMode: AdvanceMode | null;
  advanceValue: number | null;
  active: boolean;
}

export type AdvanceMode = 'fixed' | 'percent';

/** Leather ball covers red and white; 'red' and 'white' remain so older formats keep working. */
export type BallType = 'combo' | 'leather' | 'red' | 'white' | 'tennis' | 'practice';

/** A way to play: which ball, and how long the session is. Sessions run back to back from opening time (9-1, 1-5 for four hours). */
export interface PlayFormat {
  id: string;
  label: string; // "T20", "40 overs"
  ball: BallType;
  minutes: number;
  pricePaise: number; // for the whole session
  weekendPricePaise: number | null;
}

/**
 * One line of a ground's price list: this ball, on these days (0 = Sunday … 6 = Saturday), between these times.
 * hourly: the customer picks the hours they want and pays pricePaise for each hour.
 * fixed: the whole window is one session at pricePaise (bundleDays 2 = the same window on the next day too, one booking).
 */
export interface RateRule {
  id: string;
  label: string;
  ball: 'combo' | 'leather' | 'tennis' | 'practice';
  days: number[];
  from: string; // HH:MM
  to: string; // HH:MM, up to "27:00" (3 am next morning)
  mode: 'hourly' | 'fixed';
  pricePaise: number;
  bundleDays?: number;
}

/** One thing a customer can book on a date from the price list. */
export interface RateOption {
  ruleId: string;
  label: string;
  ball: 'combo' | 'leather' | 'tennis' | 'practice';
  mode: 'hourly' | 'fixed';
  start: number;
  end: number;
  time: string; // HH:MM IST
  endTime: string;
  /** fixed: price of the whole session; hourly: price of one hour. */
  pricePaise: number;
  bundleDays: number;
  /** fixed session already under way today: sold for the hours left, at a share of the price (start/time/pricePaise already reflect that). */
  proRated?: boolean;
  fullPricePaise?: number;
  hoursLeft?: number;
  state: SlotView['state'];
  /** hourly only: the hours, each priced for one slot. */
  slots?: SlotView[];
}

export interface FormatWindow {
  start: number;
  end: number;
  time: string; // HH:MM IST
  endTime: string;
  pricePaise: number;
  state: SlotView['state'];
}

export interface FormatAvailability { formatId: string; windows: FormatWindow[] }

export interface SlotView {
  start: number;
  end: number;
  time: string; // HH:MM IST
  pricePaise: number;
  state: 'available' | 'held' | 'booked' | 'blocked' | 'past';
}

export interface AvailabilityResponse {
  groundId: string;
  date: string;
  slots: SlotView[];
  formats: FormatAvailability[];
  /** What can be booked this day from the ground's price list (empty when it has none, or the ground is shut). */
  rates?: RateOption[];
  /** True when the ground is shut that day (for example every Monday for maintenance). */
  closed?: boolean;
}

export type BookingStatus = 'held' | 'confirmed' | 'cancelled' | 'expired' | 'no_show' | 'completed';
export type BookingSource = 'online' | 'walk_in' | 'enquiry';
export type PayMethod = 'razorpay' | 'upi' | 'cash' | 'card' | 'bank_transfer' | 'credit';
export type PaymentStatus =
  | 'created'
  | 'pending'
  | 'submitted'
  | 'captured'
  | 'failed'
  | 'rejected'
  | 'refunded'
  | 'partially_refunded';

export interface BlockDay { id: string; ref: string; date: string; startAt: number; endAt: number; status: string; totalPaise: number; paidPaise: number; balancePaise: number }
/** A multi-day booking (camp, tournament) seen as one: dates, money across every day, and (in the detail) each day. */
export interface BlockPayment { createdAt: number; method: string; status: string; amountPaise: number; refundedPaise: number; reference: string | null }
export interface BlockSummary { seriesId: string; cancelled: boolean; awaitingPaise: number; refundedPaise: number; creditedPaise: number; cancellableDays: number; days: number; fromDate: string; toDate: string; totalPaise: number; paidPaise: number; balancePaise: number; items?: BlockDay[]; payments?: BlockPayment[];
  /** The tournament this multi-day booking was made for, if any. */
  tournament?: { id: string; name: string } | null }

export interface Booking {
  id: string;
  ref: string;
  groundId: string;
  groundName: string;
  ownerId: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  date: string;
  startAt: number;
  endAt: number;
  slotCount: number;
  formatLabel: string | null;
  ball: BallType | null;
  status: BookingStatus;
  source: BookingSource;
  totalPaise: number;
  advancePaise: number;
  paidPaise: number;
  balancePaise: number;
  holdExpiresAt: number | null;
  needsReview: boolean;
  cancelKind: 'free' | 'credit' | 'none' | null;
  /** Online bookings wait for the owner's approval after the deposit; the slot stays held. Cancelled by the owner: see resolution. */
  approval: 'pending' | 'approved';
  /** The owner cancelled it and explained why (cancelReason). 'awaiting' means the customer has not yet chosen refund, credit or another slot. */
  cancelledByOwner: boolean;
  resolution: 'awaiting' | 'refund' | 'half' | 'credit' | null;
  /** What the owner offered the customer when the ground cancelled: any of 'refund' (full), 'half' (cashRefundPercent back to the payment method), 'credit' (full). Another slot comes with 'credit'. */
  promoCode: string | null;
  /** Set when the booking belongs to a repeating series; index 0 is the first one. */
  seriesId?: string | null;
  seriesIndex?: number | null;
  /** Set on the first day of a multi-day block in staff lists: the whole block as one booking. */
  block?: BlockSummary | null;
  discountPaise: number;
  cancelOffers: ('refund' | 'half' | 'credit')[];
  cancelReason: string | null;
  refundPaise: number;
  creditPaise: number;
  cancelledAt: number | null;
  confirmedAt: number | null;
  players: number | null;
  notes: string | null;
  createdAt: number;
}

export interface Payment {
  id: string;
  bookingId: string;
  method: PayMethod;
  status: PaymentStatus;
  purpose: 'advance' | 'balance' | 'full';
  amountPaise: number;
  refundedPaise: number;
  reference: string | null;
  submittedAt: number | null;
  verifiedAt: number | null;
  verifiedBy: string | null;
  rejectReason: string | null;
  late: boolean;
  createdAt: number;
}

export interface PaymentInstructions {
  mode: 'razorpay' | 'upi' | 'none';
  amountPaise: number;
  paymentId: string | null;
  // razorpay
  razorpay?: { keyId: string; orderId: string; demo: boolean };
  // upi
  upi?: { upiId: string; payee: string; uri: string; note: string; deadline: number };
}

export interface HoldRequest {
  groundId: string;
  date: string;
  startTime: string;
  slots: number;
  useCredit?: boolean;
  players?: number;
  notes?: string;
}

export interface HoldResponse {
  booking: Booking;
  payment: PaymentInstructions;
  creditAppliedPaise: number;
  /** Present when the booking repeats: how many dates were reserved and which were left out. */
  series?: { id: string; frequency: RepeatFrequency; created: number; skipped: { date: string; reason: string }[] };
}

export type RepeatFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface BookingDetail {
  booking: Booking;
  payments: Payment[];
}

export interface CancelPreview {
  bookingId: string;
  kind: 'free' | 'credit' | 'none' | 'owner';
  hoursBeforeStart: number;
  paidPaise: number;
  refundPaise: number;
  creditPaise: number;
  retainedPaise: number;
  /** Free cancellations: what the customer would get as account credit if they choose credit instead of a refund (everything they paid). */
  creditOptionPaise?: number;
  /** The share of the cash paid that goes back to the payment method (for example 50). */
  cashRefundPercent?: number;
  message: string;
}

export interface CreditLot {
  id: string;
  ownerId: string;
  amountPaise: number;
  remainingPaise: number;
  source: string;
  bookingId: string | null;
  issuedAt: number;
  expiresAt: number;
  expiredAt: number | null;
}
export interface CreditLedgerEntry {
  id: string;
  ownerId: string;
  kind: 'issued' | 'redeemed' | 'adjusted' | 'expired' | 'restored';
  amountPaise: number;
  balanceAfterPaise: number;
  bookingId: string | null;
  note: string | null;
  createdAt: number;
}
export interface CreditSummary {
  /** Credit is held per ground owner and can only be spent at that owner's grounds. */
  balancePaise: number;
  byOwner: { ownerId: string; ownerName: string; balancePaise: number }[];
  lots: CreditLot[];
  ledger: CreditLedgerEntry[];
}

export type EnquiryStatus = 'new' | 'follow_up' | 'quoted' | 'converted' | 'closed';
export interface Quotation {
  id: string;
  amountPaise: number;
  validUntil: number | null;
  details: string | null;
  status: 'sent' | 'accepted' | 'declined' | 'expired';
  createdAt: number;
}
export interface EnquiryNote {
  id: string;
  kind: 'note' | 'contact' | 'status';
  body: string;
  authorId: string | null;
  createdAt: number;
}
export interface Enquiry {
  id: string;
  groundId: string | null;
  groundName: string | null;
  ownerId: string;
  customerId: string | null;
  name: string;
  phone: string;
  email: string | null;
  preferredDate: string | null;
  players: number | null;
  message: string;
  status: EnquiryStatus;
  closedReason: string | null;
  bookingId: string | null;
  quotations: Quotation[];
  notes: EnquiryNote[];
  createdAt: number;
  updatedAt: number;
}

/** Who to call and write to. Shown on the website and at the end of booking messages. */
export interface ContactInfo {
  name: string;
  phone: string;
  email: string;
}

/** The academy that trains at the ground. */
export interface AcademyInfo {
  name: string;
  /** The person who runs it. */
  runBy: string;
  /** The label it trains under, e.g. MP13. */
  brand: string;
  about: string;
  coaches: AcademyCoach[];
}

export interface PublicConfig {
  brand: string;
  tagline: string;
  contact: ContactInfo;
  academy: AcademyInfo;
  instagramUrl: string | null;
  gallery: string[];
  academyGallery: string[];
  razorpayEnabled: boolean;
  /** Whether sign-in codes by WhatsApp or text message can be sent. When false, sign-up and sign-in use email and password. */
  codesEnabled?: boolean;
  /** Whether the phone apps can offer Sign in with Microsoft (the server has a Microsoft Entra app registration). */
  microsoftSignIn?: boolean;
  razorpayDemo: boolean;
  razorpayKeyId: string | null;
  holdMinutesOnline: number;
  /** How many days ahead a customer can book. */
  maxDaysAhead: number;
  holdMinutesUpi: number;
  verifyMinutesUpi: number;
  creditExpiryDays: number;
  freeCancelHours: number;
  lateCancelCreditPercent: number;
  cashRefundPercent: number;
  requireApproval: boolean;
  autoDebitEnabled: boolean;
  autoDebitHoursBefore: number;
  /** Customers can book from this day on (YYYY-MM-DD); empty means bookings are open now. */
  bookingsOpenFrom: string;
  /** Customers cannot book on or after this day (YYYY-MM-DD) until it is cleared; empty means no closing day. */
  bookingsCloseFrom: string;
  /** Single upcoming days switched off for online booking. */
  closedDates: { ground: string[]; practice: string[]; academy: string[] };
  advanceMode: AdvanceMode;
  advanceValue: number;
  fullPaymentWithinHours: number;
  demoMode: boolean;
  publicUrl: string;
  /** Where photos, videos and the background films load from when a CDN is set up (MEDIA_CDN); null = this server. */
  mediaBase?: string | null;
}

/** A professional coach shown on the website's academy section. */
export interface AcademyCoach { name: string; title: string; bio: string; photo: string }

export interface GlobalSettings {
  razorpayEnabled: boolean;
  requireApproval: boolean;
  autoDebitEnabled: boolean;
  autoDebitHoursBefore: number;
  bookingsOpenFrom: string;
  bookingsCloseFrom: string;
  upiId: string;
  upiPayee: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  academyName: string;
  academyRunBy: string;
  academyBrand: string;
  academyAbout: string;
  academyCoaches: AcademyCoach[];
  /** Link to the ground's Instagram page. Empty hides the button. */
  instagramUrl: string;
  /** Photo links (https) shown in the website gallery, in order. */
  galleryImages: string[];
  academyImages: string[];
  holdMinutesOnline: number;
  holdMinutesUpi: number;
  verifyMinutesUpi: number;
  graceMinutes: number;
  maxHoldExtensions: number;
  advanceMode: AdvanceMode;
  advanceValue: number;
  fullPaymentWithinHours: number;
  freeCancelHours: number;
  lateCancelCreditPercent: number;
  cashRefundPercent: number;
  creditExpiryDays: number;
  noShowGraceMinutes: number;
  /** On a festival day the festival look applies to every visitor, even one who picked a theme. */
  festivalForEveryone: boolean;
  /** 'rotate' (the design changes through the day) or one fixed design id. */
  siteDesign: string;
  /** How often the rotating design changes: daypart (four times a day), daily or weekly. */
  designPace: 'daypart' | 'daily' | 'weekly';
}

export interface AuditEntry {
  id: number;
  at: number;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  ownerId: string | null;
  detail: unknown;
}

export interface Notification {
  id: string;
  userId: string;
  channel: 'email' | 'sms' | 'whatsapp' | 'push';
  category: 'transactional' | 'marketing';
  template: string;
  subject: string | null;
  body: string;
  status: 'queued' | 'sent' | 'skipped' | 'failed';
  skipReason: string | null;
  bookingId: string | null;
  createdAt: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface RefundRow {
  /** Set when the super admin has authorised it; no money moves before then. */
  approvedAt?: number | null;
  /** True while the ground's own approval steps for this refund are still waiting; the super admin can authorise it only after. */
  waitingOnGround?: boolean;
  /** How the customer originally paid. Decides how the money goes back: Razorpay through the gateway, anything else by hand. */
  paymentMethod?: string | null;
  id: string;
  paymentId: string;
  bookingId: string;
  amountPaise: number;
  status: 'pending' | 'processing' | 'done' | 'failed';
  mode: 'gateway' | 'manual';
  reference: string | null;
  reason: string | null;
  createdAt: number;
  completedAt: number | null;
}

// ---- contacts and broadcasts ----

/** Everyone who has played at the owner's grounds. */
export interface Contact {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  timesPlayed: number;
  slotsPlayed: number;
  firstPlayedAt: number;
  lastPlayedAt: number;
  paidPaise: number;
  groundIds: string[];
  consent: { email: boolean; sms: boolean; whatsapp: boolean };
  /** Can we message them on this channel right now: has the address, said yes, account not disabled. */
  reachable: { email: boolean; sms: boolean; whatsapp: boolean };
}

export interface ContactSummary {
  total: number;
  reachableEmail: number;
  reachableWhatsapp: number;
  reachableSms: number;
}

/** 'played' = finished sessions only; 'booked' = also upcoming confirmed ones; 'all' = also no-shows. */
export type ContactWho = 'played' | 'booked' | 'all';
export type BroadcastChannel = 'email' | 'sms' | 'whatsapp';

export interface ContactFilter {
  who?: ContactWho;
  groundId?: string;
  playedFrom?: string;
  playedTo?: string;
  minTimes?: number;
  /** Last played before this date: lapsed players. */
  inactiveSince?: string;
  q?: string;
}

export interface BroadcastPlan {
  channel: BroadcastChannel;
  audience: number;
  willSend: number;
  skipped: { noConsent: number; noAddress: number; disabled: number };
  /** The first few people it will go to, so the owner can see it is the right group. */
  sample: { id: string; name: string }[];
  /** The message as the first recipient would get it, footer included. */
  preview: { subject: string | null; body: string };
}

export interface Broadcast {
  id: string;
  ownerId: string;
  channel: BroadcastChannel;
  subject: string | null;
  body: string;
  filter: ContactFilter;
  audience: number;
  /** Handed over for delivery. */
  queued: number;
  skipped: number;
  /** Live from the delivery log: how many of the queued ones went out, and how many the provider refused. */
  sent: number;
  failed: number;
  createdAt: number;
  createdBy: string | null;
}

export type RecipientStatus = 'queued' | 'sent' | 'failed' | 'skipped';
export interface BroadcastRecipient {
  userId: string;
  name: string;
  status: RecipientStatus;
  reason: string | null;
}

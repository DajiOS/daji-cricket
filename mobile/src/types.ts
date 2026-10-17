// The parts of the server's responses the app reads. They mirror shared/src/types.ts on the server.
export interface User { id: string; role: 'customer' | 'owner' | 'staff' | 'super_admin'; name: string; email: string | null; phone: string | null; permissions?: string[]; avatarUrl?: string | null; businessName?: string | null; upiId?: string | null }
export type Ball = 'leather' | 'tennis' | 'practice';
export interface Ground { id: string; name: string; city: string; address?: string; pricePaise: number; weekendPricePaise: number | null; amenities?: string[]; directionsUrl?: string | null; maxSlots?: number; rates?: { id: string; label: string; ball: Ball; mode: 'fixed' | 'hourly' }[]; ratesNote?: string | null }
/** One line of the price list for a day: a fixed session, or an hourly price with its own hours. */
export interface RateOption { ruleId: string; label: string; ball: Ball; mode: 'fixed' | 'hourly'; state: Slot['state']; time: string; endTime: string; start: number; pricePaise: number; proRated?: boolean; hoursLeft?: number; slots?: Slot[]; bundleDays?: number }
export interface Availability { slots: Slot[]; rates?: RateOption[]; closed?: boolean }
export type RepeatFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';
export interface Mandate { status: 'none' | 'pending' | 'active'; maxAmountPaise: number | null; since: number | null; enabled: boolean; hoursBefore: number }
export interface Slot { start: number; end: number; time: string; pricePaise: number; state: 'available' | 'held' | 'booked' | 'blocked' | 'past' }
export interface Booking {
  id: string; ref: string; groundId: string; groundName: string; date: string; startAt: number; endAt: number; slotCount: number;
  status: 'held' | 'confirmed' | 'cancelled' | 'expired' | 'no_show' | 'completed';
  totalPaise: number; paidPaise: number; balancePaise: number; holdExpiresAt: number | null; refundPaise: number; creditPaise: number; cancelKind: string | null; seriesId?: string | null; seriesIndex?: number | null; block?: { seriesId: string; days: number; fromDate: string; toDate: string; totalPaise: number; paidPaise: number; balancePaise: number } | null;
}
export interface PaymentInstructions {
  mode: 'razorpay' | 'upi' | 'none'; amountPaise: number; paymentId: string | null;
  razorpay?: { keyId: string; orderId: string; demo: boolean };
  upi?: { upiId: string; payee: string; uri: string; note: string; deadline: number };
}
export interface HoldResponse { booking: Booking; payment: PaymentInstructions; creditAppliedPaise: number; series?: { id: string; frequency: RepeatFrequency; created: number; skipped: { date: string; reason: string }[] } }
export interface AppConfig { freeCancelHours: number; maxDaysAhead: number; contact: { name: string; phone: string }; demoMode: boolean; bookingsOpenFrom?: string; bookingsCloseFrom?: string; closedDates?: { ground: string[]; practice: string[]; academy: string[] }; autoDebitEnabled?: boolean; autoDebitHoursBefore?: number }
export interface Dashboard {
  spentPaise: number; sessions: number; slots: number; cancelled: number; noShows: number; paidAheadPaise: number; upcoming: number; creditPaise: number; firstPlayed: string | null;
  byGround: { groundId: string; groundName: string; sessions: number; spentPaise: number }[]; byMonth: { month: string; sessions: number; spentPaise: number }[];
}
export interface Child {
  relation: 'parent' | 'self'; id: string; name: string; batch: string | null; academy: string;
  attendance: { sessions: number; present: number; percent: number | null };
  cards: { id: string; month: string; ratings: { skill: string; rating: number }[]; comment: string | null }[];
}

export interface StaffBooking {
  id: string; ref: string; groundName: string; customerName: string; customerPhone: string | null; date: string; startAt: number; endAt: number; slotCount: number; formatLabel: string | null;
  status: 'held' | 'confirmed' | 'cancelled' | 'expired' | 'no_show' | 'completed'; totalPaise: number; paidPaise: number; balancePaise: number; needsReview: boolean; approval: 'pending' | 'approved';
  cancelledByOwner: boolean; resolution: string | null; promoCode: string | null;
}
export interface PaymentRow { id: string; bookingId: string; method: string; status: string; purpose: string; amountPaise: number; reference: string | null }
export interface TaskPhoto { id: string; url: string; takenAt: number; uploadedByName: string | null; note: string | null; source: string }
export interface Task { id: string; title: string; details: string | null; assignedTo: string | null; assignedName: string | null; dueDate: string | null; overdue: boolean; photosRequired: number; status: 'open' | 'done' | 'cancelled'; completedAt: number | null; completedByName: string | null; photos: TaskPhoto[] }
export interface TeamMember { id: string; name: string; email: string | null; phone: string | null; active: boolean; permissions: string[] }
export interface Promo { id: string; code: string; label: string | null; active: boolean; kind: 'percent' | 'flat'; value: number; usageLimit: number | null; used: number }
export interface Student { id: string; name: string; bornOn: string | null; batch: string | null; guardianName: string; guardianEmail: string | null; guardianPhone: string | null; linked: boolean; status: 'active' | 'left' }
export interface ProgressCard { id: string; month: string; ratings: { skill: string; rating: number }[]; comment: string | null; published: boolean }
export interface MatchRow { id: string; title: string; teamA: string; teamB: string; overs: number; status: string; result: string | null; isPublic: boolean }
export interface Innings { number: 1 | 2; team: string; runs: number; wickets: number; overs: string; closed: boolean; target: number | null; recent: string[]; batting: { name: string; runs: number; balls: number; out: string | null }[]; bowling: { name: string; overs: string; runs: number; wickets: number }[] }
export interface Scorecard { match: MatchRow; innings: Innings[] }

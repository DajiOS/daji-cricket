// What each audit action is called on the activity feed and the Dashboard's alerts.
export const TITLES: Record<string, string> = {
  'booking.hold': 'Booking held', 'booking.confirm': 'Booking confirmed', 'booking.approve': 'Booking approved', 'booking.cancel': 'Booking cancelled', 'booking.no_show': 'Marked as no-show',
  'booking.review_done': 'Booking reviewed', 'booking.walk_in': 'Walk-in booking added', 'booking.cancel_by_owner': 'Booking cancelled by the ground', 'booking.expire': 'Hold ran out', 'booking.complete': 'Session played', 'booking.block': 'Time blocked', 'series.confirm': 'Multi-day booking confirmed',
  'payment.submit': 'UPI payment sent for checking', 'payment.capture': 'Payment received', 'payment.captured': 'Payment received', 'payment.reject': 'UPI payment rejected', 'payment.refund': 'Refund started', 'payment.record': 'Payment recorded',
  'refund.approve': 'Refund approved', 'refund.decline': 'Refund declined', 'refund.complete': 'Refund paid',
  'bill.create': 'Bill entered', 'bill.update': 'Bill changed', 'bill.submit': 'Bill sent for approval', 'bill.approve': 'Bill approved', 'bill.reject': 'Bill rejected', 'bill.pay': 'Bill paid', 'bill.delete': 'Bill deleted',
  'bill.vendor.create': 'Vendor added', 'acct.txn.create': 'Bank or cash line added', 'acct.import': 'Bank statement imported', 'acct.signoff': 'Month signed off', 'acct.reopen': 'Month reopened', 'acct.txn.categorise': 'Bank line categorised',
  'task.create': 'Job added', 'task.done': 'Job done', 'task.cancel': 'Job cancelled', 'task.comment': 'Comment on a job', 'task.reopen': 'Job reopened', 'membership.sell': 'Membership sold', 'membership.renew': 'Membership renewed', 'tournament.create': 'Tournament created', 'tournament.result': 'Tournament result saved', 'match.create': 'Match created', 'match.complete': 'Match finished',
};
/** "bill.vendor.create" becomes "Vendor create" when there is no better title. */
export const title = (a: string) => TITLES[a] ?? (a.split('.').slice(1).join(' ').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) || a);

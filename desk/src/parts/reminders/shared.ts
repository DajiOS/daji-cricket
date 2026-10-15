export type Kind = 'booking' | 'payment' | 'membership' | 'fixture';
export interface QueueItem { kind: Kind; key: string; customerId: string | null; name: string; phone: string | null; summary: string; message: string; link: string | null; sentAt: number | null }
export interface Queue { items: QueueItem[]; membershipsAvailable: boolean; counts: Record<string, number> }
export interface Template { kind: Kind; label: string; body: string; custom: boolean; defaultBody: string }
export interface HistoryRow { id: string; kind: Kind; name: string; phone: string | null; message: string; sentAt: number; sentBy: string | null }
export const KIND_LABEL: Record<Kind, string> = { booking: 'Booking', payment: 'Payment due', membership: 'Membership', fixture: 'Fixture' };
export const KIND_TONE: Record<Kind, 'info' | 'warn' | 'gold' | 'good'> = { booking: 'info', payment: 'warn', membership: 'gold', fixture: 'good' };

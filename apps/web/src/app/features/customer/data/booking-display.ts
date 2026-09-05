import type { BookingStatus, PaymentStatus } from '@eventhub/contracts';

/**
 * How the domain's states are shown.
 *
 * Kept next to the feature rather than in a component so the list, the detail
 * page and the checkout all label a status identically - a booking that reads
 * "Awaiting advance" in one place and "Accepted" in another looks like two
 * different things to the person reading it.
 */

export type Tone = 'neutral' | 'progress' | 'good' | 'warn' | 'bad';

interface Presentation {
  label: string;
  tone: Tone;
  /** One line of plain English about what this state means for the customer. */
  hint: string;
}

export const BOOKING_PRESENTATION: Record<BookingStatus, Presentation> = {
  ENQUIRY: {
    label: 'Enquiry sent',
    tone: 'neutral',
    hint: 'The vendor has your enquiry and will send a quote.',
  },
  QUOTED: {
    label: 'Quote received',
    tone: 'progress',
    hint: 'Review the quote and accept it to hold your date.',
  },
  ACCEPTED: {
    label: 'Awaiting advance',
    tone: 'warn',
    hint: 'Your date is held for 48 hours. Pay the advance to confirm it.',
  },
  CONFIRMED: {
    label: 'Confirmed',
    tone: 'good',
    hint: 'The date is booked. The balance falls due a week before the event.',
  },
  IN_PROGRESS: {
    label: 'In progress',
    tone: 'progress',
    hint: 'The vendor has started work on your function.',
  },
  COMPLETED: {
    label: 'Completed',
    tone: 'good',
    hint: 'This booking is finished.',
  },
  CANCELLED: {
    label: 'Cancelled',
    tone: 'bad',
    hint: 'This booking was cancelled and the date released.',
  },
  EXPIRED: {
    label: 'Expired',
    tone: 'bad',
    hint: 'The advance was not paid in time, so the date was released.',
  },
  DISPUTED: {
    label: 'In dispute',
    tone: 'warn',
    hint: 'Support is reviewing this booking.',
  },
};

export const PAYMENT_PRESENTATION: Record<PaymentStatus | 'NOT_DUE', Presentation> = {
  NOT_DUE: { label: 'Not due yet', tone: 'neutral', hint: '' },
  CREATED: { label: 'Awaiting payment', tone: 'warn', hint: '' },
  PENDING: { label: 'Processing', tone: 'progress', hint: '' },
  CAPTURED: { label: 'Paid', tone: 'good', hint: '' },
  FAILED: { label: 'Failed', tone: 'bad', hint: '' },
  REFUNDED: { label: 'Refunded', tone: 'neutral', hint: '' },
  PARTIALLY_REFUNDED: { label: 'Partly refunded', tone: 'neutral', hint: '' },
};

/** "Sat, 14 Feb 2027" - the date the wedding function actually falls on. */
export function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC', // event dates are stored at UTC midnight
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Whole days from now until the event; negative once it has passed. */
export function daysUntil(iso: string): number {
  const startOfDay = (d: Date): number =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor((startOfDay(new Date(iso)) - startOfDay(new Date())) / 86_400_000);
}

import type { Paisa } from './common.js';
import type { VendorCategory } from './enums.js';

/**
 * Reviews, and the ratings they add up to.
 *
 * The rating on a vendor was a number nobody could change: seeded once, never
 * written, and yet driving the sort order, the minimum-rating filter and the
 * comparison panel. A marketplace whose stars mean nothing is a marketplace
 * whose ranking means nothing.
 *
 * What makes this worth doing properly here is the booking. Every other
 * platform takes reviews from anyone with an account and spends its life
 * fighting the fakes; this one already knows who paid whom, so a review is
 * attached to a completed booking or it does not exist. One booking, one
 * review, and the vendor cannot delete it.
 */

/** The four things a couple can judge separately, all 1-5. */
export interface ReviewScores {
  /** Did the work match what was promised and photographed? */
  quality: number;
  /** Answering messages, turning up when they said. */
  professionalism: number;
  /** What it cost against what it was worth - not the same as cheap. */
  value: number;
  /** Did they make the day easier or harder? */
  flexibility: number;
}

export interface ReviewDto {
  id: string;
  vendorId: string;
  bookingId: string;
  /** The reviewer's display name. Never their number. */
  authorName: string;
  /** The overall figure, the mean of the four scores, rounded to one decimal. */
  rating: number;
  scores: ReviewScores;
  title: string;
  body: string;
  /** What was actually booked, so a reader can weigh the review against it. */
  category: VendorCategory;
  eventDate: string;
  /** Paid, not quoted. Shown as a band so a couple's spend is not published. */
  amountBand?: string | null;
  /** A vendor may answer once, in public, and cannot delete the review. */
  vendorReply?: { body: string; repliedAt: string } | null;
  createdAt: string;
}

export interface CreateReviewRequest {
  bookingId: string;
  scores: ReviewScores;
  title: string;
  body: string;
}

export interface VendorReplyRequest {
  body: string;
}

/**
 * The ratings breakdown shown above a vendor's reviews.
 *
 * The histogram matters: four-point-two out of a hundred reviews with none
 * below three is a different vendor from four-point-two with a fifth of them
 * at one star, and an average alone hides which one you are looking at.
 */
export interface RatingSummary {
  average: number;
  count: number;
  /** How many gave 5, 4, 3, 2, 1 - index 0 is five stars. */
  histogram: [number, number, number, number, number];
  averages: ReviewScores;
}

export const MIN_REVIEW_BODY = 30;
export const MAX_REVIEW_BODY = 2000;
export const MAX_REVIEW_TITLE = 120;
export const MAX_VENDOR_REPLY = 1000;

/**
 * What a couple paid, as a band.
 *
 * The exact figure is nobody else's business - it is a negotiated price, and
 * publishing it would put every couple's spend on the internet - but "what
 * ballpark" is the single most useful thing a reader wants and cannot get
 * anywhere else.
 */
export function amountBand(total: Paisa | number | null | undefined): string | null {
  if (total == null || total <= 0) return null;
  const rupees = total / 100;
  const lakhs = rupees / 100_000;

  if (lakhs < 0.5) return 'Under ₹50,000';
  if (lakhs < 1) return '₹50,000 – ₹1 lakh';
  if (lakhs < 2) return '₹1 – 2 lakh';
  if (lakhs < 5) return '₹2 – 5 lakh';
  if (lakhs < 10) return '₹5 – 10 lakh';
  if (lakhs < 25) return '₹10 – 25 lakh';
  return 'Over ₹25 lakh';
}

/** The overall figure from the four scores. One decimal, like every site shows. */
export function overallRating(scores: ReviewScores): number {
  const values = [scores.quality, scores.professionalism, scores.value, scores.flexibility];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.round(mean * 10) / 10;
}

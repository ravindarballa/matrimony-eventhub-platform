import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import {
  BookingStatus,
  ErrorCode,
  amountBand,
  overallRating,
  type CreateReviewRequest,
  type Paisa,
  type RatingSummary,
  type ReviewDto,
} from '@eventhub/contracts';

import { Vendor, type VendorDocument } from '../schemas/vendor.schema.js';
import { Review, type ReviewDocument } from '../schemas/review.schema.js';
import { Booking, type BookingDocument } from '../../events/schemas/booking.schema.js';
import { User, type UserDocument } from '../../auth/schemas/user.schema.js';

/** The states in which the work is done and a review is a fair thing to ask for. */
const REVIEWABLE: string[] = [BookingStatus.COMPLETED, BookingStatus.DISPUTED];

/**
 * Reviews, and the vendor rating they produce.
 *
 * The rating is derived and never set. Before this, `rating` and `reviewCount`
 * were fields anyone could have written and nothing ever did - seeded once and
 * frozen, while the search sorted by them and a filter promised to hide
 * anything below four stars. Recomputing from the reviews on every write is
 * what makes those numbers mean something.
 *
 * A review requires a completed booking, which is the advantage of running the
 * money as well as the listings: there is no need to guess whether a reviewer
 * is real, because the platform watched them pay.
 */
@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(Review.name) private readonly reviews: Model<ReviewDocument>,
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    @InjectModel(Booking.name) private readonly bookings: Model<BookingDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
  ) {}

  /**
   * Writes a review against a booking the caller owns and has completed.
   *
   * The booking is read through the model rather than the bookings service,
   * which would be a circular import; four fields are copied off it and none
   * of them are decisions, so nothing is duplicated except a lookup.
   */
  async create(customerId: string, dto: CreateReviewRequest): Promise<ReviewDto> {
    if (!Types.ObjectId.isValid(dto.bookingId)) throw new NotFoundException();

    const booking = await this.bookings.findById(dto.bookingId);
    // Not "you may not review this": distinguishing the two would tell a
    // stranger that somebody else's booking exists.
    if (!booking || booking.customerId.toString() !== customerId) {
      throw new NotFoundException();
    }
    if (!REVIEWABLE.includes(booking.status)) {
      throw new ConflictException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'You can review a vendor once the event is done.',
      });
    }

    for (const [name, value] of Object.entries(dto.scores)) {
      if (!Number.isInteger(value) || value < 1 || value > 5) {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          fields: { [`scores.${name}`]: 'Give a score from 1 to 5.' },
        });
      }
    }

    let created: ReviewDocument;
    try {
      created = await this.reviews.create({
        vendorId: booking.vendorId,
        bookingId: booking._id,
        customerId: new Types.ObjectId(customerId),
        authorName: await this.displayName(customerId),
        rating: overallRating(dto.scores),
        scores: dto.scores,
        title: dto.title.trim(),
        body: dto.body.trim(),
        category: booking.category,
        eventDate: booking.eventDate,
        amountPaid: booking.paidAmount,
      });
    } catch (err) {
      // The unique index on bookingId is what actually stops a second review;
      // this turns its error into something a person can read.
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException({
          code: ErrorCode.VALIDATION_FAILED,
          message: 'You have already reviewed this booking.',
        });
      }
      throw err;
    }

    await this.recomputeRating(booking.vendorId);
    return this.toDto(created);
  }

  /**
   * The caller's own review of one booking, or null.
   *
   * The booking page needs this to decide between offering the form and
   * showing what was already written. Without it the only way to find out is
   * to submit and be told no, which is a rude way to learn that you already
   * did something.
   */
  async forBooking(customerId: string, bookingId: string): Promise<ReviewDto | null> {
    if (!Types.ObjectId.isValid(bookingId)) return null;

    const review = await this.reviews.findOne({
      bookingId: new Types.ObjectId(bookingId),
      customerId: new Types.ObjectId(customerId),
    });
    return review ? this.toDto(review) : null;
  }

  /** A vendor answers once, in public. They can never remove the review. */
  async reply(vendorOwnerId: string, reviewId: string, body: string): Promise<ReviewDto> {
    if (!Types.ObjectId.isValid(reviewId)) throw new NotFoundException();

    const review = await this.reviews.findById(reviewId);
    if (!review) throw new NotFoundException();

    const vendor = await this.vendors.findById(review.vendorId);
    if (!vendor || vendor.ownerId.toString() !== vendorOwnerId) {
      throw new ForbiddenException(ErrorCode.AUTH_FORBIDDEN);
    }
    if (review.vendorReply) {
      throw new ConflictException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'You have already replied to this review.',
      });
    }

    review.vendorReply = { body: body.trim(), repliedAt: new Date() };
    await review.save();
    return this.toDto(review);
  }

  async listForVendor(
    vendorId: string,
    page = 1,
    limit = 10,
  ): Promise<{ items: ReviewDto[]; total: number; page: number }> {
    if (!Types.ObjectId.isValid(vendorId)) return { items: [], total: 0, page: 1 };

    const filter = { vendorId: new Types.ObjectId(vendorId) };
    const [rows, total] = await Promise.all([
      this.reviews
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      this.reviews.countDocuments(filter),
    ]);

    return { items: rows.map((r) => this.toDto(r)), total, page };
  }

  /**
   * The breakdown shown above the list.
   *
   * The histogram is the point: 4.2 with nothing below three is a different
   * vendor from 4.2 with a fifth of them at one star, and the average alone
   * cannot tell those apart.
   */
  async summaryFor(vendorId: string): Promise<RatingSummary> {
    const empty: RatingSummary = {
      average: 0,
      count: 0,
      histogram: [0, 0, 0, 0, 0],
      averages: { quality: 0, professionalism: 0, value: 0, flexibility: 0 },
    };
    if (!Types.ObjectId.isValid(vendorId)) return empty;

    const rows = await this.reviews.find({ vendorId: new Types.ObjectId(vendorId) });
    if (rows.length === 0) return empty;

    const histogram: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    const totals = { quality: 0, professionalism: 0, value: 0, flexibility: 0 };

    for (const r of rows) {
      // Index 0 is five stars, so the bar chart reads top-down like every site.
      histogram[5 - Math.round(r.rating)] += 1;
      totals.quality += r.scores.quality;
      totals.professionalism += r.scores.professionalism;
      totals.value += r.scores.value;
      totals.flexibility += r.scores.flexibility;
    }

    const mean = (n: number): number => Math.round((n / rows.length) * 10) / 10;
    return {
      average: mean(rows.reduce((sum, r) => sum + r.rating, 0)),
      count: rows.length,
      histogram,
      averages: {
        quality: mean(totals.quality),
        professionalism: mean(totals.professionalism),
        value: mean(totals.value),
        flexibility: mean(totals.flexibility),
      },
    };
  }

  /**
   * How the reviewer is named in public: first name and a last initial.
   *
   * Full names are how a review becomes searchable against the person who
   * wrote it, and a couple leaving an honest three stars should not have to
   * weigh that against their wedding being on the internet under their name.
   */
  private async displayName(customerId: string): Promise<string> {
    const user = await this.users.findById(customerId).select('fullName');
    const parts = (user?.fullName ?? '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'A customer';
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
  }

  /**
   * Recomputes the vendor's headline rating from its reviews.
   *
   * Recomputed rather than nudged: an incremental average drifts as reviews are
   * edited or removed, and this runs once per review written, which is not a
   * rate worth optimising for.
   */
  private async recomputeRating(vendorId: Types.ObjectId): Promise<void> {
    const [agg] = await this.reviews.aggregate<{ avg: number; count: number }>([
      { $match: { vendorId } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);

    await this.vendors.updateOne(
      { _id: vendorId },
      {
        $set: {
          rating: agg ? Math.round(agg.avg * 10) / 10 : 0,
          reviewCount: agg?.count ?? 0,
        },
      },
    );
  }

  private toDto(review: ReviewDocument): ReviewDto {
    return {
      id: review.id as string,
      vendorId: review.vendorId.toString(),
      bookingId: review.bookingId.toString(),
      authorName: review.authorName,
      rating: review.rating,
      scores: {
        quality: review.scores.quality,
        professionalism: review.scores.professionalism,
        value: review.scores.value,
        flexibility: review.scores.flexibility,
      },
      title: review.title,
      body: review.body,
      category: review.category,
      eventDate: review.eventDate.toISOString(),
      amountBand: amountBand(review.amountPaid as Paisa | undefined),
      vendorReply: review.vendorReply
        ? {
            body: review.vendorReply.body,
            repliedAt: review.vendorReply.repliedAt.toISOString(),
          }
        : null,
      createdAt: review.createdAt.toISOString(),
    };
  }
}

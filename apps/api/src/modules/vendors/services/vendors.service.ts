import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import {
  AvailabilityStatus,
  ErrorCode,
  IFSC_REGEX,
  KycStatus,
  PAN_REGEX,
  GSTIN_REGEX,
  type KycDecisionRequest,
  type OnboardVendorRequest,
  type Paisa,
  type SubmitKycRequest,
  type UpsertServiceRequest,
  type VendorDto,
  type VendorSearchQuery,
  type VendorCalendarDay,
  type VendorSearchResult,
  type VendorServiceDto,
} from '@eventhub/contracts';

import {
  VendorAvailability,
  type VendorAvailabilityDocument,
} from '../../events/schemas/vendor-availability.schema.js';
import { Vendor, type VendorDocument } from '../schemas/vendor.schema.js';
import {
  VendorService as VendorServiceEntity,
  type VendorServiceDocument,
} from '../schemas/vendor-service.schema.js';

const DUPLICATE_KEY = 11000;

const isDuplicateKey = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: number }).code === DUPLICATE_KEY;

/** Dates are stored at UTC midnight, so one calendar day is one exact value. */
const toUtcMidnight = (d: Date | string): Date => {
  const date = new Date(d);
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
};

/** How many recent response times feed the median. */
const RESPONSE_WINDOW = 20;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

@Injectable()
export class VendorsService {
  private readonly logger = new Logger(VendorsService.name);

  constructor(
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    @InjectModel(VendorServiceEntity.name)
    private readonly services: Model<VendorServiceDocument>,
    @InjectModel(VendorAvailability.name)
    private readonly availability: Model<VendorAvailabilityDocument>,
    private readonly events: EventEmitter2,
  ) {}

  // ---------------------------------------------------------------- onboarding

  /**
   * Creates the vendor organisation for a signed-in owner.
   *
   * The unique index on ownerId is what prevents a second listing, not this
   * code being careful - two concurrent submissions both reach the insert and
   * exactly one survives.
   */
  async onboard(ownerId: string, dto: OnboardVendorRequest): Promise<VendorDto> {
    try {
      const created = await this.vendors.create({
        ownerId: new Types.ObjectId(ownerId),
        ...dto,
        kycStatus: KycStatus.NOT_STARTED,
      });
      return this.toDto(created);
    } catch (e) {
      if (isDuplicateKey(e)) {
        throw new ConflictException({
          code: ErrorCode.VND_OWNER_ONLY,
          message: 'You already have a vendor listing.',
        });
      }
      throw e;
    }
  }

  async findMine(ownerId: string): Promise<VendorDto> {
    return this.toDto(await this.requireOwned(ownerId));
  }

  /**
   * Submits KYC for review.
   *
   * The formats are checked here as well as in the DTO because this is the
   * boundary that matters: a malformed IFSC reaches a bank transfer, and the
   * cost of finding out then is a failed payout, not a validation message.
   */
  async submitKyc(ownerId: string, dto: SubmitKycRequest): Promise<VendorDto> {
    const vendor = await this.requireOwned(ownerId);

    if (vendor.kycStatus === KycStatus.VERIFIED) {
      throw new ConflictException({
        code: ErrorCode.VND_KYC_REJECTED,
        message: 'Your KYC is already verified.',
      });
    }

    const fields: Record<string, string> = {};
    if (!PAN_REGEX.test(dto.pan)) fields['pan'] = 'That is not a valid PAN.';
    if (!IFSC_REGEX.test(dto.ifsc)) fields['ifsc'] = 'That is not a valid IFSC code.';
    if (dto.gstin && !GSTIN_REGEX.test(dto.gstin)) {
      fields['gstin'] = 'That is not a valid GSTIN.';
    }
    if (Object.keys(fields).length) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, fields });
    }

    vendor.kyc = { ...dto, submittedAt: new Date() };
    vendor.kycStatus = KycStatus.SUBMITTED;
    vendor.kycRejectionReason = undefined;
    await vendor.save();

    return this.toDto(vendor);
  }

  /** Admin decision. A rejection without a reason is unactionable, so refuse it. */
  async decideKyc(vendorId: string, dto: KycDecisionRequest): Promise<VendorDto> {
    const vendor = await this.requireById(vendorId);

    if (dto.decision === 'REJECTED') {
      if (!dto.reason?.trim()) {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          fields: { reason: 'Tell the vendor what to fix.' },
        });
      }
      vendor.kycStatus = KycStatus.REJECTED;
      vendor.kycRejectionReason = dto.reason.trim();
    } else {
      vendor.kycStatus = KycStatus.VERIFIED;
      vendor.kycRejectionReason = undefined;
      vendor.kycVerifiedAt = new Date();
    }

    await vendor.save();
    this.logger.log(`Vendor ${vendorId} KYC ${vendor.kycStatus}`);

    // The vendor is told by the notifications module, which listens for this.
    this.events.emit('vendor.kyc.decided', {
      vendorId,
      ownerId: vendor.ownerId.toString(),
      status: vendor.kycStatus,
      reason: vendor.kycRejectionReason,
    });
    return this.toDto(vendor);
  }

  /** The queue an admin works through, oldest submission first. */
  async pendingKyc(): Promise<VendorDto[]> {
    const rows = await this.vendors
      .find({ kycStatus: { $in: [KycStatus.SUBMITTED, KycStatus.IN_REVIEW] } })
      .sort({ createdAt: 1 });
    return rows.map((v) => this.toDto(v));
  }

  // ------------------------------------------------------------------ catalogue

  async addService(
    ownerId: string,
    dto: UpsertServiceRequest,
  ): Promise<VendorServiceDto> {
    const vendor = await this.requireOwned(ownerId);
    const created = await this.services.create({
      vendorId: vendor._id,
      ...dto,
    });
    await this.refreshPriceFrom(vendor._id);
    return this.toServiceDto(created);
  }

  async updateService(
    ownerId: string,
    serviceId: string,
    dto: Partial<UpsertServiceRequest> & { isActive?: boolean },
  ): Promise<VendorServiceDto> {
    const vendor = await this.requireOwned(ownerId);
    if (!Types.ObjectId.isValid(serviceId)) throw new NotFoundException();

    // Ownership is part of the query: a vendor cannot edit another's catalogue.
    const service = await this.services.findOne({
      _id: new Types.ObjectId(serviceId),
      vendorId: vendor._id,
    });
    if (!service) throw new NotFoundException();

    Object.assign(service, dto);
    await service.save();
    await this.refreshPriceFrom(vendor._id);
    return this.toServiceDto(service);
  }

  async listServices(vendorId: string): Promise<VendorServiceDto[]> {
    if (!Types.ObjectId.isValid(vendorId)) throw new NotFoundException();
    const rows = await this.services
      .find({ vendorId: new Types.ObjectId(vendorId), isActive: true })
      .sort({ basePrice: 1 });
    return rows.map((s) => this.toServiceDto(s));
  }

  /**
   * Keeps the denormalised `priceFrom` honest. Search sorts on it, so it must
   * follow every catalogue change rather than being computed once at creation.
   */
  private async refreshPriceFrom(vendorId: Types.ObjectId): Promise<void> {
    const [cheapest] = await this.services
      .find({ vendorId, isActive: true })
      .sort({ basePrice: 1 })
      .limit(1);

    await this.vendors.updateOne(
      { _id: vendorId },
      cheapest
        ? { $set: { priceFrom: cheapest.basePrice } }
        : { $unset: { priceFrom: 1 } },
    );
  }

  // --------------------------------------------------------------------- search

  /**
   * Vendor search.
   *
   * The date filter is what makes this more than a directory: a vendor whose
   * calendar is already taken that day is dropped, so every result is something
   * the customer can actually book. Without it, the first thing a customer
   * learns about their favourite venue is that it was never available.
   */
  async search(query: VendorSearchQuery): Promise<{
    items: VendorSearchResult[];
    total: number;
    page: number;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, query.limit ?? DEFAULT_LIMIT));

    const filter: Record<string, unknown> = { isActive: true };
    if (query.category) filter.category = query.category;
    // Case-insensitive exact city match: users type "pune", data holds "Pune".
    if (query.city) filter.city = new RegExp(`^${escapeRegex(query.city)}$`, 'i');
    if (query.maxPrice !== undefined) filter.priceFrom = { $lte: query.maxPrice };
    if (query.minRating !== undefined) filter.rating = { $gte: query.minRating };

    const sort = SORTS[query.sort ?? 'rating'];

    const [rows, total] = await Promise.all([
      this.vendors
        .find(filter)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit),
      this.vendors.countDocuments(filter),
    ]);

    const ids = rows.map((v) => v._id);
    const [services, taken] = await Promise.all([
      this.services.find({ vendorId: { $in: ids }, isActive: true }).sort({ basePrice: 1 }),
      query.date ? this.takenVendorIds(ids, query.date) : Promise.resolve(new Set<string>()),
    ]);

    const byVendor = new Map<string, VendorServiceDto[]>();
    for (const s of services) {
      const key = s.vendorId.toString();
      byVendor.set(key, [...(byVendor.get(key) ?? []), this.toServiceDto(s)]);
    }

    const items = rows
      .map((v) => ({
        ...this.toDto(v),
        services: byVendor.get(v.id as string) ?? [],
        availableOnDate: query.date ? !taken.has(v.id as string) : null,
      }))
      // A date in the query means "show me what I can book", not "show me
      // everything and let me discover the disappointment on the next page".
      .filter((v) => v.availableOnDate !== false);

    return { items, total, page };
  }

  /** Vendors whose calendar is HELD or BOOKED on that date. */
  private async takenVendorIds(
    vendorIds: Types.ObjectId[],
    date: string,
  ): Promise<Set<string>> {
    const rows = await this.availability.find({
      vendorId: { $in: vendorIds },
      date: toUtcMidnight(date),
      status: { $in: [AvailabilityStatus.HELD, AvailabilityStatus.BOOKED, AvailabilityStatus.BLOCKED] },
    });
    return new Set(rows.map((r) => r.vendorId.toString()));
  }

  async findOne(vendorId: string): Promise<VendorSearchResult> {
    const vendor = await this.requireById(vendorId);
    return {
      ...this.toDto(vendor),
      services: await this.listServices(vendorId),
      availableOnDate: null,
    };
  }

  // ------------------------------------------------------------------ calendar

  /**
   * The vendor's own calendar for a date range.
   *
   * Held and booked days come from real bookings and are read-only here; a
   * vendor who wants one back has to cancel the booking, which has consequences
   * a calendar click should not quietly trigger.
   */
  async calendar(
    ownerId: string,
    from: string,
    to: string,
  ): Promise<VendorCalendarDay[]> {
    const vendor = await this.requireOwned(ownerId);

    const rows = await this.availability
      .find({
        vendorId: vendor._id,
        date: { $gte: toUtcMidnight(from), $lte: toUtcMidnight(to) },
        status: { $ne: AvailabilityStatus.AVAILABLE },
      })
      .sort({ date: 1 });

    return rows.map((row) => ({
      date: row.date.toISOString(),
      status: row.status as VendorCalendarDay['status'],
      bookingId: row.bookingId?.toString() ?? null,
      reason: row.reason ?? null,
    }));
  }

  /**
   * Marks dates unavailable - leave, an offline booking, a family wedding.
   *
   * A date that already carries a held or confirmed booking is refused rather
   * than overwritten: the customer's date is not the vendor's to take back by
   * editing a calendar, and silently hiding a booking would be worse than
   * failing.
   */
  async blockDates(
    ownerId: string,
    dates: string[],
    reason?: string,
  ): Promise<VendorCalendarDay[]> {
    const vendor = await this.requireOwned(ownerId);
    const normalised = [...new Set(dates.map((d) => toUtcMidnight(d).getTime()))]
      .map((t) => new Date(t))
      .sort((a, b) => a.getTime() - b.getTime());

    const taken = await this.availability.find({
      vendorId: vendor._id,
      date: { $in: normalised },
      status: { $in: [AvailabilityStatus.HELD, AvailabilityStatus.BOOKED] },
    });

    if (taken.length) {
      throw new ConflictException({
        code: ErrorCode.VND_DATE_HAS_BOOKING,
        message: `${taken.length} of those dates already carry a booking. Cancel it first if the date really is unavailable.`,
      });
    }

    // Upsert per date, so blocking the same day twice is harmless.
    await Promise.all(
      normalised.map((date) =>
        this.availability.updateOne(
          { vendorId: vendor._id, date, status: AvailabilityStatus.BLOCKED },
          { $set: { reason } },
          { upsert: true },
        ),
      ),
    );

    return this.calendar(
      ownerId,
      normalised[0]!.toISOString(),
      normalised[normalised.length - 1]!.toISOString(),
    );
  }

  /** Frees a manually blocked date. Bookings are untouched by design. */
  async unblockDate(ownerId: string, date: string): Promise<void> {
    const vendor = await this.requireOwned(ownerId);
    const result = await this.availability.deleteMany({
      vendorId: vendor._id,
      date: toUtcMidnight(date),
      status: AvailabilityStatus.BLOCKED,
    });
    if (result.deletedCount === 0) throw new NotFoundException();
  }

  // -------------------------------------------------------------- for other modules

  /**
   * The check the enquiry and booking flows make before letting money near a
   * vendor. KYC gates money, not presence: an unverified vendor may be listed
   * and browsed, but cannot be sent an enquiry that could become a booking.
   */
  async requireBookable(vendorId: string): Promise<VendorDocument> {
    const vendor = await this.requireById(vendorId);

    if (!vendor.isActive) {
      throw new ConflictException({
        code: ErrorCode.EVT_VENDOR_INACTIVE,
        message: `${vendor.businessName} is not taking bookings at the moment.`,
      });
    }
    if (vendor.kycStatus !== KycStatus.VERIFIED) {
      throw new ConflictException({
        code: ErrorCode.VND_NOT_VERIFIED,
        message: `${vendor.businessName} has not completed verification yet.`,
      });
    }
    return vendor;
  }

  /** The vendor organisation this user owns, or 403. */
  async requireOwned(ownerId: string): Promise<VendorDocument> {
    if (!Types.ObjectId.isValid(ownerId)) throw new ForbiddenException();
    const vendor = await this.vendors.findOne({
      ownerId: new Types.ObjectId(ownerId),
    });
    if (!vendor) {
      throw new ForbiddenException({
        code: ErrorCode.VND_OWNER_ONLY,
        message: 'Complete your vendor onboarding first.',
      });
    }
    return vendor;
  }

  async requireById(vendorId: string): Promise<VendorDocument> {
    if (!Types.ObjectId.isValid(vendorId)) throw new NotFoundException();
    const vendor = await this.vendors.findById(vendorId);
    if (!vendor) throw new NotFoundException();
    return vendor;
  }

  /**
   * Records how long a vendor took to answer an enquiry and re-derives the
   * median. Kept to a rolling window so one slow month does not haunt a vendor
   * that has since improved.
   */
  async recordResponseTime(
    vendorId: Types.ObjectId,
    minutes: number,
  ): Promise<void> {
    const vendor = await this.vendors.findById(vendorId);
    if (!vendor) return;

    vendor.recentResponseMins = [...vendor.recentResponseMins, minutes].slice(
      -RESPONSE_WINDOW,
    );
    vendor.medianResponseMins = median(vendor.recentResponseMins);
    await vendor.save();
  }

  toDto(vendor: VendorDocument): VendorDto {
    return {
      id: vendor.id as string,
      ownerId: vendor.ownerId.toString(),
      businessName: vendor.businessName,
      category: vendor.category,
      city: vendor.city,
      description: vendor.description,
      kycStatus: vendor.kycStatus,
      kycRejectionReason: vendor.kycRejectionReason ?? null,
      isActive: vendor.isActive,
      priceFrom: (vendor.priceFrom as Paisa | undefined) ?? null,
      rating: vendor.rating,
      reviewCount: vendor.reviewCount,
      medianResponseMins: vendor.medianResponseMins ?? null,
      completedBookings: vendor.completedBookings,
    };
  }

  private toServiceDto(service: VendorServiceDocument): VendorServiceDto {
    return {
      id: service.id as string,
      vendorId: service.vendorId.toString(),
      title: service.title,
      description: service.description,
      pricingModel: service.pricingModel,
      basePrice: service.basePrice as Paisa,
      minimumUnits: service.minimumUnits ?? null,
      capacity: service.capacity ?? null,
      inclusions: service.inclusions,
      isActive: service.isActive,
    };
  }
}

/** Nulls sort last in Mongo ascending order, which is what we want for price. */
const SORTS: Record<string, Record<string, 1 | -1>> = {
  rating: { rating: -1, reviewCount: -1 },
  price: { priceFrom: 1 },
  response: { medianResponseMins: 1 },
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}

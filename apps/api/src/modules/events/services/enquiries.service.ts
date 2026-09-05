import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import {
  ENQUIRY_SLA_HOURS,
  EnquiryVendorStatus,
  ErrorCode,
  GST_BPS,
  MAX_ENQUIRY_VENDORS,
  type CreateEnquiryRequest,
  type CreateQuoteRequest,
  type CreateWeddingFunctionRequest,
  type CreateWeddingRequest,
  type EnquiryDto,
  type Paisa,
  type QuoteDto,
  type VendorEnquiryDto,
  type WeddingDto,
  type WeddingFunctionDto,
} from '@eventhub/contracts';

import { VendorsService } from '../../vendors/services/vendors.service.js';
import { Enquiry, type EnquiryDocument } from '../schemas/enquiry.schema.js';
import { Quote, type QuoteDocument } from '../schemas/quote.schema.js';
import { Wedding, type WeddingDocument } from '../schemas/wedding.schema.js';
import {
  WeddingFunction,
  type WeddingFunctionDocument,
} from '../schemas/wedding-function.schema.js';
import { toUtcMidnight } from './bookings.service.js';

const DUPLICATE_KEY = 11000;

const isDuplicateKey = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: number }).code === DUPLICATE_KEY;

/** Advance bounds the platform enforces, whatever a vendor types. */
const MIN_ADVANCE_PERCENT = 10;
const MAX_ADVANCE_PERCENT = 50;

const MIN_VALID_DAYS = 1;
const MAX_VALID_DAYS = 30;

const HOUR_MS = 60 * 60 * 1000;

/**
 * The step between finding a vendor and holding a date.
 *
 * A customer describes the function once and it fans out to up to five
 * vendors; each answers with an itemised quote; the customer compares and
 * accepts one, which is where BookingsService takes over and locks the date.
 */
@Injectable()
export class EnquiriesService {
  private readonly logger = new Logger(EnquiriesService.name);

  constructor(
    @InjectModel(Enquiry.name) private readonly enquiries: Model<EnquiryDocument>,
    @InjectModel(Quote.name) private readonly quotes: Model<QuoteDocument>,
    @InjectModel(Wedding.name) private readonly weddings: Model<WeddingDocument>,
    @InjectModel(WeddingFunction.name)
    private readonly functions: Model<WeddingFunctionDocument>,
    private readonly vendors: VendorsService,
    private readonly events: EventEmitter2,
  ) {}

  // -------------------------------------------------------------------- weddings

  async createWedding(
    customerId: string,
    dto: CreateWeddingRequest,
  ): Promise<WeddingDto> {
    const created = await this.weddings.create({
      customerId: new Types.ObjectId(customerId),
      coupleNames: { bride: dto.brideName, groom: dto.groomName },
      primaryDate: toUtcMidnight(dto.primaryDate),
      city: dto.city,
      guestEstimate: dto.guestEstimate,
      budgetTotal: dto.budgetTotal,
    });
    return this.toWeddingDto(created);
  }

  async listWeddings(customerId: string): Promise<WeddingDto[]> {
    if (!Types.ObjectId.isValid(customerId)) return [];
    const rows = await this.weddings
      .find({ customerId: new Types.ObjectId(customerId) })
      .sort({ primaryDate: 1 });
    return rows.map((w) => this.toWeddingDto(w));
  }

  /**
   * Adds one ceremony to a wedding.
   *
   * Each function carries its own date and guest count because each is booked
   * separately - the sangeet caterer and the reception caterer are different
   * bookings on different nights, and collapsing them is how a family ends up
   * with dinner arriving on the wrong day.
   */
  async addFunction(
    weddingId: string,
    customerId: string,
    dto: CreateWeddingFunctionRequest,
  ): Promise<WeddingFunctionDto> {
    const wedding = await this.requireOwnedWedding(weddingId, customerId);

    try {
      const created = await this.functions.create({
        weddingId: wedding._id,
        customerId: wedding.customerId,
        type: dto.type,
        date: toUtcMidnight(dto.date),
        guestCount: dto.guestCount,
      });
      return this.toFunctionDto(created);
    } catch (e) {
      if (isDuplicateKey(e)) {
        throw new ConflictException({
          code: ErrorCode.VALIDATION_FAILED,
          message: `This wedding already has a ${dto.type.toLowerCase()}.`,
        });
      }
      throw e;
    }
  }

  async listFunctions(
    weddingId: string,
    customerId: string,
  ): Promise<WeddingFunctionDto[]> {
    const wedding = await this.requireOwnedWedding(weddingId, customerId);
    const rows = await this.functions
      .find({ weddingId: wedding._id })
      .sort({ date: 1 });
    return rows.map((f) => this.toFunctionDto(f));
  }

  async removeFunction(
    weddingId: string,
    functionId: string,
    customerId: string,
  ): Promise<void> {
    const wedding = await this.requireOwnedWedding(weddingId, customerId);
    if (!Types.ObjectId.isValid(functionId)) throw new NotFoundException();

    const result = await this.functions.deleteOne({
      _id: new Types.ObjectId(functionId),
      weddingId: wedding._id,
    });
    if (result.deletedCount === 0) throw new NotFoundException();
  }

  private toFunctionDto(doc: WeddingFunctionDocument): WeddingFunctionDto {
    return {
      id: doc.id as string,
      weddingId: doc.weddingId.toString(),
      type: doc.type,
      date: doc.date.toISOString(),
      guestCount: doc.guestCount,
    };
  }

  // ------------------------------------------------------------------ enquiries

  /**
   * Fans one enquiry out to the chosen vendors.
   *
   * Every vendor is checked for bookability before any leg is written, so the
   * customer never ends up waiting on a vendor who could never have quoted.
   * The fan-out is capped: an enquiry to every vendor in a city is a broadcast,
   * and vendors stop answering broadcasts.
   */
  async create(customerId: string, dto: CreateEnquiryRequest): Promise<EnquiryDto> {
    const wedding = await this.requireOwnedWedding(dto.weddingId, customerId);

    const unique = [...new Set(dto.vendorIds)];
    if (unique.length === 0 || unique.length > MAX_ENQUIRY_VENDORS) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        fields: {
          vendorIds: `Choose between 1 and ${MAX_ENQUIRY_VENDORS} vendors.`,
        },
      });
    }

    const functionDate = toUtcMidnight(dto.functionDate);
    if (functionDate.getTime() < toUtcMidnight(new Date()).getTime()) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        fields: { functionDate: 'Pick a date in the future.' },
      });
    }

    // Checked up front, so a rejection names the vendor rather than failing
    // halfway through the fan-out.
    const vendors = await Promise.all(
      unique.map((id) => this.vendors.requireBookable(id)),
    );

    const offCategory = vendors.find((v) => v.category !== dto.category);
    if (offCategory) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        fields: {
          vendorIds: `${offCategory.businessName} does not work in ${dto.category.toLowerCase()}.`,
        },
      });
    }

    const created = await this.enquiries.create({
      weddingId: wedding._id,
      customerId: new Types.ObjectId(customerId),
      category: dto.category,
      functionType: dto.functionType,
      functionDate,
      city: wedding.city,
      guestCount: dto.guestCount,
      budget: dto.budget,
      notes: dto.notes,
      vendors: vendors.map((v) => ({
        vendorId: v._id,
        businessName: v.businessName,
        status: EnquiryVendorStatus.SENT,
      })),
      expiresAt: new Date(Date.now() + ENQUIRY_SLA_HOURS * HOUR_MS),
    });

    // Vendors are notified out of band; the customer is not made to wait for it.
    this.events.emit('enquiry.created', {
      enquiryId: created.id as string,
      vendorIds: unique,
      category: dto.category,
      functionDate: functionDate.toISOString(),
    });

    return this.toDto(created);
  }

  async listForCustomer(customerId: string): Promise<EnquiryDto[]> {
    if (!Types.ObjectId.isValid(customerId)) return [];
    const rows = await this.enquiries
      .find({ customerId: new Types.ObjectId(customerId) })
      .sort({ createdAt: -1 });
    return rows.map((e) => this.toDto(e));
  }

  async findForCustomer(enquiryId: string, customerId: string): Promise<EnquiryDto> {
    return this.toDto(await this.requireOwnedEnquiry(enquiryId, customerId));
  }

  /**
   * The vendor inbox, ordered by how little time is left to answer. Vendors
   * leave this open all day and their median response time is a ranking input,
   * so the most urgent enquiry must be the first one they see.
   */
  async inboxForVendor(
    ownerId: string,
    status?: EnquiryVendorStatus,
  ): Promise<VendorEnquiryDto[]> {
    const vendor = await this.vendors.requireOwned(ownerId);

    const rows = await this.enquiries
      .find({
        'vendors.vendorId': vendor._id,
        ...(status ? { 'vendors.status': status } : {}),
      })
      .sort({ expiresAt: 1 });

    const vendorId = vendor._id.toString();
    return rows
      .map((enquiry): VendorEnquiryDto | null => {
        const leg = enquiry.vendors.find((v) => v.vendorId.toString() === vendorId);
        if (!leg) return null;
        // A leg-level status filter is applied here as well: the query above
        // matches documents where ANY leg has that status, not necessarily ours.
        if (status && leg.status !== status) return null;

        return {
          id: enquiry.id as string,
          category: enquiry.category,
          functionType: enquiry.functionType,
          functionDate: enquiry.functionDate.toISOString(),
          city: enquiry.city,
          guestCount: enquiry.guestCount,
          budget: (enquiry.budget as Paisa | undefined) ?? null,
          notes: enquiry.notes ?? null,
          status: leg.status,
          quoteId: leg.quoteId?.toString() ?? null,
          receivedAt: (enquiry as unknown as { createdAt: Date }).createdAt.toISOString(),
          expiresAt: enquiry.expiresAt.toISOString(),
          hoursRemaining:
            Math.round(((enquiry.expiresAt.getTime() - Date.now()) / HOUR_MS) * 10) / 10,
        };
      })
      .filter((row): row is VendorEnquiryDto => row !== null);
  }

  async decline(ownerId: string, enquiryId: string): Promise<void> {
    const vendor = await this.vendors.requireOwned(ownerId);
    const enquiry = await this.requireEnquiry(enquiryId);
    const leg = this.requireOpenLeg(enquiry, vendor._id.toString());

    leg.status = EnquiryVendorStatus.DECLINED;
    leg.respondedAt = new Date();
    await enquiry.save();
  }

  // --------------------------------------------------------------------- quotes

  /**
   * A vendor's itemised answer.
   *
   * Every total is recomputed here from the line items - line totals, subtotal,
   * GST and the grand total. Nothing the vendor sends about sums is trusted,
   * because a quote that claims a total its own lines do not support becomes a
   * booking amount, and then a charge.
   */
  async quote(
    ownerId: string,
    enquiryId: string,
    dto: CreateQuoteRequest,
  ): Promise<QuoteDto> {
    const vendor = await this.vendors.requireBookable(
      (await this.vendors.requireOwned(ownerId)).id as string,
    );
    const enquiry = await this.requireEnquiry(enquiryId);
    const leg = this.requireOpenLeg(enquiry, vendor._id.toString());

    if (enquiry.expiresAt.getTime() < Date.now()) {
      throw new GoneException({
        code: ErrorCode.EVT_QUOTE_EXPIRED,
        message: 'This enquiry has expired.',
      });
    }

    if (
      dto.advancePercent < MIN_ADVANCE_PERCENT ||
      dto.advancePercent > MAX_ADVANCE_PERCENT
    ) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        fields: {
          advancePercent: `The advance must be between ${MIN_ADVANCE_PERCENT}% and ${MAX_ADVANCE_PERCENT}%.`,
        },
      });
    }
    if (dto.validForDays < MIN_VALID_DAYS || dto.validForDays > MAX_VALID_DAYS) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        fields: {
          validForDays: `A quote may stay valid for ${MIN_VALID_DAYS} to ${MAX_VALID_DAYS} days.`,
        },
      });
    }
    if (!dto.lineItems.length) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        fields: { lineItems: 'Add at least one line.' },
      });
    }

    // The arithmetic, done once, here.
    const lineItems = dto.lineItems.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: (line.quantity * line.unitPrice) as Paisa,
    }));
    const subtotal = lineItems.reduce((n, l) => n + l.lineTotal, 0) as Paisa;
    const gstAmount = Math.round((subtotal * GST_BPS) / 10_000) as Paisa;
    const total = (subtotal + gstAmount) as Paisa;

    const created = await this.quotes.create({
      enquiryId: enquiry._id,
      vendorId: vendor._id,
      weddingId: enquiry.weddingId,
      customerId: enquiry.customerId,
      category: enquiry.category,
      functionDate: enquiry.functionDate,
      lineItems,
      subtotal,
      gstAmount,
      total,
      advancePercent: dto.advancePercent,
      validUntil: new Date(Date.now() + dto.validForDays * 24 * 60 * 60 * 1000),
      status: 'SENT',
    });

    leg.status = EnquiryVendorStatus.QUOTED;
    leg.quoteId = created._id;
    leg.respondedAt = new Date();
    await enquiry.save();

    // Response time is a ranking input, so it is recorded from the enquiry's
    // own clock rather than trusted from anywhere else.
    const receivedAt = (enquiry as unknown as { createdAt: Date }).createdAt;
    await this.vendors.recordResponseTime(
      vendor._id,
      Math.max(0, Math.round((Date.now() - receivedAt.getTime()) / 60_000)),
    );

    this.events.emit('quote.sent', {
      quoteId: created.id as string,
      enquiryId: enquiry.id as string,
      customerId: enquiry.customerId.toString(),
      total,
    });

    return this.toQuoteDto(created);
  }

  /** The comparison view: every quote against one enquiry, cheapest first. */
  async quotesForEnquiry(enquiryId: string, customerId: string): Promise<QuoteDto[]> {
    const enquiry = await this.requireOwnedEnquiry(enquiryId, customerId);
    const rows = await this.quotes
      .find({ enquiryId: enquiry._id })
      .sort({ total: 1 });
    return rows.map((q) => this.toQuoteDto(q));
  }

  /**
   * Expires enquiry legs nobody answered. Without this a vendor's inbox fills
   * with dead enquiries and their SLA counts against them forever.
   */
  async expireStaleEnquiries(now = new Date()): Promise<number> {
    const result = await this.enquiries.updateMany(
      { expiresAt: { $lt: now }, 'vendors.status': EnquiryVendorStatus.SENT },
      { $set: { 'vendors.$[leg].status': EnquiryVendorStatus.EXPIRED } },
      { arrayFilters: [{ 'leg.status': EnquiryVendorStatus.SENT }] },
    );
    if (result.modifiedCount) {
      this.logger.log(`Expired legs on ${result.modifiedCount} enquiries`);
    }
    return result.modifiedCount;
  }

  // ------------------------------------------------------------------- internals

  private async requireEnquiry(enquiryId: string): Promise<EnquiryDocument> {
    if (!Types.ObjectId.isValid(enquiryId)) throw new NotFoundException();
    const enquiry = await this.enquiries.findById(enquiryId);
    if (!enquiry) throw new NotFoundException();
    return enquiry;
  }

  private async requireOwnedEnquiry(
    enquiryId: string,
    customerId: string,
  ): Promise<EnquiryDocument> {
    if (!Types.ObjectId.isValid(enquiryId) || !Types.ObjectId.isValid(customerId)) {
      throw new NotFoundException();
    }
    // Ownership is part of the query, not a check after the fact.
    const enquiry = await this.enquiries.findOne({
      _id: new Types.ObjectId(enquiryId),
      customerId: new Types.ObjectId(customerId),
    });
    if (!enquiry) throw new NotFoundException();
    return enquiry;
  }

  private async requireOwnedWedding(
    weddingId: string,
    customerId: string,
  ): Promise<WeddingDocument> {
    if (!Types.ObjectId.isValid(weddingId) || !Types.ObjectId.isValid(customerId)) {
      throw new NotFoundException();
    }
    const wedding = await this.weddings.findOne({
      _id: new Types.ObjectId(weddingId),
      customerId: new Types.ObjectId(customerId),
    });
    if (!wedding) throw new NotFoundException();
    return wedding;
  }

  /** The caller's leg, and only if it is still theirs to answer. */
  private requireOpenLeg(
    enquiry: EnquiryDocument,
    vendorId: string,
  ): EnquiryDocument['vendors'][number] {
    const leg = enquiry.vendors.find((v) => v.vendorId.toString() === vendorId);
    if (!leg) throw new ForbiddenException(ErrorCode.AUTH_FORBIDDEN);

    if (leg.status === EnquiryVendorStatus.QUOTED) {
      throw new ConflictException({
        code: ErrorCode.EVT_INVALID_TRANSITION,
        message: 'You have already quoted for this enquiry.',
      });
    }
    if (leg.status === EnquiryVendorStatus.DECLINED) {
      throw new ConflictException({
        code: ErrorCode.EVT_INVALID_TRANSITION,
        message: 'You declined this enquiry.',
      });
    }
    return leg;
  }

  private toDto(enquiry: EnquiryDocument): EnquiryDto {
    return {
      id: enquiry.id as string,
      weddingId: enquiry.weddingId.toString(),
      customerId: enquiry.customerId.toString(),
      category: enquiry.category,
      functionType: enquiry.functionType,
      functionDate: enquiry.functionDate.toISOString(),
      city: enquiry.city,
      guestCount: enquiry.guestCount,
      budget: (enquiry.budget as Paisa | undefined) ?? null,
      notes: enquiry.notes ?? null,
      vendors: enquiry.vendors.map((v) => ({
        vendorId: v.vendorId.toString(),
        businessName: v.businessName,
        status: v.status,
        quoteId: v.quoteId?.toString() ?? null,
        respondedAt: v.respondedAt?.toISOString() ?? null,
      })),
      expiresAt: enquiry.expiresAt.toISOString(),
      createdAt: (enquiry as unknown as { createdAt: Date }).createdAt.toISOString(),
    };
  }

  private toQuoteDto(quote: QuoteDocument): QuoteDto {
    return {
      id: quote.id as string,
      enquiryId: quote.enquiryId.toString(),
      vendorId: quote.vendorId.toString(),
      functionDate: quote.functionDate.toISOString(),
      lineItems: quote.lineItems,
      subtotal: quote.subtotal as Paisa,
      gstAmount: quote.gstAmount as Paisa,
      total: quote.total as Paisa,
      advancePercent: quote.advancePercent,
      validUntil: quote.validUntil.toISOString(),
      status: quote.status,
    };
  }

  private toWeddingDto(wedding: WeddingDocument): WeddingDto {
    return {
      id: wedding.id as string,
      customerId: wedding.customerId.toString(),
      coupleNames: {
        bride: wedding.coupleNames.bride,
        groom: wedding.coupleNames.groom,
      },
      primaryDate: wedding.primaryDate.toISOString(),
      city: wedding.city,
      guestEstimate: wedding.guestEstimate,
      budgetTotal: wedding.budgetTotal as Paisa,
      sourceProfileId: wedding.sourceProfileId?.toString() ?? null,
    };
  }
}

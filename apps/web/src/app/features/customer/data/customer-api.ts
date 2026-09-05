import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  BookingDto,
  CreateEnquiryRequest,
  CreateWeddingRequest,
  EnquiryDto,
  PaymentDto,
  PaymentIntentDto,
  PaymentMilestone,
  PaymentScheduleEntry,
  QuoteDto,
  RefundPreview,
  VendorSearchQuery,
  VendorSearchResult,
  WeddingDto,
} from '@eventhub/contracts';

/** Every successful response from this API is wrapped in { data, meta }. */
export interface Envelope<T> {
  data: T;
}

/** Unwraps the envelope for httpResource's `parse`. */
export const unwrap = <T>(raw: unknown): T => (raw as Envelope<T>).data;

/**
 * URLs and mutations for the customer portal.
 *
 * Reads are not here: pages declare them with httpResource so the request is
 * tied to the signals it depends on and re-runs itself. What lives here is the
 * writes, which are explicit user actions rather than reactive reads, plus the
 * URLs both sides share.
 */
@Injectable({ providedIn: 'root' })
export class CustomerApi {
  private readonly http = inject(HttpClient);

  readonly bookings = '/api/v1/bookings';
  readonly vendors = '/api/v1/vendors';
  readonly enquiries = '/api/v1/enquiries';
  readonly weddings = '/api/v1/weddings';
  readonly payments = '/api/v1/payments';

  bookingUrl = (id: string): string => `${this.bookings}/${id}`;
  scheduleUrl = (bookingId: string): string =>
    `${this.payments}/booking/${bookingId}/schedule`;
  paymentsForBookingUrl = (bookingId: string): string =>
    `${this.payments}/booking/${bookingId}`;

  /**
   * Opens a checkout.
   *
   * The idempotency key is supplied by the caller rather than generated here,
   * so a retry of the same attempt carries the same key and cannot open a
   * second order. A new attempt is a new key.
   */
  async createIntent(
    bookingId: string,
    milestone: PaymentMilestone,
    idempotencyKey: string,
  ): Promise<PaymentIntentDto> {
    const res = await firstValueFrom(
      this.http.post<Envelope<PaymentIntentDto>>(
        `${this.payments}/intents`,
        { bookingId, milestone },
        { headers: { 'Idempotency-Key': idempotencyKey } },
      ),
    );
    return res.data;
  }

  /**
   * Local development only. The fake gateway has no hosted checkout page, so
   * this stands in for the customer completing one; the server refuses it
   * against a real gateway.
   */
  async simulateCapture(paymentId: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.payments}/${paymentId}/simulate-capture`, {}),
    );
  }


  /**
   * Vendor search. Undefined filters are dropped rather than sent empty, so the
   * URL is a stable cache key and httpResource does not refetch on no-op edits.
   */
  searchUrl(query: VendorSearchQuery): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, String(value));
      }
    }
    const qs = params.toString();
    return qs ? `${this.vendors}/search?${qs}` : `${this.vendors}/search`;
  }

  quotesUrl = (enquiryId: string): string =>
    `${this.enquiries}/${enquiryId}/quotes`;

  async createWedding(dto: CreateWeddingRequest): Promise<WeddingDto> {
    const res = await firstValueFrom(
      this.http.post<Envelope<WeddingDto>>(this.weddings, dto),
    );
    return res.data;
  }

  async createEnquiry(dto: CreateEnquiryRequest): Promise<EnquiryDto> {
    const res = await firstValueFrom(
      this.http.post<Envelope<EnquiryDto>>(this.enquiries, dto),
    );
    return res.data;
  }

  async quotesFor(enquiryId: string): Promise<QuoteDto[]> {
    const res = await firstValueFrom(
      this.http.get<Envelope<QuoteDto[]>>(this.quotesUrl(enquiryId)),
    );
    return res.data;
  }

  /** Accepting is what locks the vendor's date, so it is a write, not a read. */
  async acceptQuote(quoteId: string): Promise<BookingDto> {
    const res = await firstValueFrom(
      this.http.post<Envelope<BookingDto>>(
        `${this.bookings}/quotes/${quoteId}/accept`,
        {},
      ),
    );
    return res.data;
  }

  async searchVendors(query: VendorSearchQuery): Promise<VendorSearchResult[]> {
    const res = await firstValueFrom(
      this.http.get<Envelope<VendorSearchResult[]>>(this.searchUrl(query)),
    );
    return res.data;
  }

  async refundPreview(bookingId: string): Promise<RefundPreview> {
    const res = await firstValueFrom(
      this.http.get<Envelope<RefundPreview>>(
        `${this.bookingUrl(bookingId)}/refund-preview`,
      ),
    );
    return res.data;
  }

  async cancelBooking(
    bookingId: string,
    reason: string,
  ): Promise<{ booking: BookingDto; refund: RefundPreview }> {
    const res = await firstValueFrom(
      this.http.post<Envelope<{ booking: BookingDto; refund: RefundPreview }>>(
        `${this.bookingUrl(bookingId)}/cancel`,
        { reason },
      ),
    );
    return res.data;
  }

  async listPayments(bookingId: string): Promise<PaymentDto[]> {
    const res = await firstValueFrom(
      this.http.get<Envelope<PaymentDto[]>>(this.paymentsForBookingUrl(bookingId)),
    );
    return res.data;
  }

  async schedule(bookingId: string): Promise<PaymentScheduleEntry[]> {
    const res = await firstValueFrom(
      this.http.get<Envelope<PaymentScheduleEntry[]>>(this.scheduleUrl(bookingId)),
    );
    return res.data;
  }
}

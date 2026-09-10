import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  CreateQuoteRequest,
  OnboardVendorRequest,
  QuoteDto,
  ReviewDto,
  SubmitKycRequest,
  UpsertServiceRequest,
  VendorDto,
  VendorEnquiryDto,
  VendorServiceDto,
} from '@eventhub/contracts';

interface Envelope<T> {
  data: T;
}

export const unwrap = <T>(raw: unknown): T => (raw as Envelope<T>).data;

/** Writes for the vendor portal; reads are declared with httpResource. */
@Injectable({ providedIn: 'root' })
export class VendorApi {
  private readonly http = inject(HttpClient);

  readonly base = '/api/v1/vendors';
  readonly enquiries = '/api/v1/enquiries';

  readonly meUrl = `${this.base}/me`;
  readonly inboxUrl = `${this.enquiries}/inbox`;

  servicesUrl = (vendorId: string): string => `${this.base}/${vendorId}/services`;
  reviewsUrl = (vendorId: string): string => `${this.base}/${vendorId}/reviews`;
  reviewSummaryUrl = (vendorId: string): string =>
    `${this.base}/${vendorId}/reviews/summary`;

  /**
   * Answers a review, once, in public.
   *
   * There is deliberately no counterpart that removes one. A vendor gets the
   * last word and never the delete key, which is the only arrangement under
   * which the ratings on the search page are worth anything.
   */
  async replyToReview(reviewId: string, body: string): Promise<ReviewDto> {
    const res = await firstValueFrom(
      this.http.post<Envelope<ReviewDto>>(`${this.base}/reviews/${reviewId}/reply`, {
        body,
      }),
    );
    return res.data;
  }

  async onboard(dto: OnboardVendorRequest): Promise<VendorDto> {
    const res = await firstValueFrom(
      this.http.post<Envelope<VendorDto>>(this.base, dto),
    );
    return res.data;
  }

  async submitKyc(dto: SubmitKycRequest): Promise<VendorDto> {
    const res = await firstValueFrom(
      this.http.post<Envelope<VendorDto>>(`${this.base}/me/kyc`, dto),
    );
    return res.data;
  }

  /**
   * Adds one portfolio photo.
   *
   * FormData with no Content-Type set by hand - the browser must add the
   * multipart boundary itself, and setting the header manually omits it.
   */
  async addPortfolioPhoto(file: File, caption?: string): Promise<VendorDto> {
    const body = new FormData();
    body.append('file', file, file.name);
    if (caption?.trim()) body.append('caption', caption.trim());
    const res = await firstValueFrom(
      this.http.post<Envelope<VendorDto>>(`${this.meUrl}/portfolio`, body),
    );
    return res.data;
  }

  async removePortfolioPhoto(photoId: string): Promise<VendorDto> {
    const res = await firstValueFrom(
      this.http.delete<Envelope<VendorDto>>(`${this.meUrl}/portfolio/${photoId}`),
    );
    return res.data;
  }

  async setCoverPhoto(photoId: string): Promise<VendorDto> {
    const res = await firstValueFrom(
      this.http.post<Envelope<VendorDto>>(
        `${this.meUrl}/portfolio/${photoId}/cover`,
        {},
      ),
    );
    return res.data;
  }

  async addService(dto: UpsertServiceRequest): Promise<VendorServiceDto> {
    const res = await firstValueFrom(
      this.http.post<Envelope<VendorServiceDto>>(`${this.base}/me/services`, dto),
    );
    return res.data;
  }

  /**
   * Answers an enquiry. Only the lines are sent - the server recomputes every
   * total, so there is deliberately nothing here that adds anything up.
   */
  async sendQuote(enquiryId: string, dto: CreateQuoteRequest): Promise<QuoteDto> {
    const res = await firstValueFrom(
      this.http.post<Envelope<QuoteDto>>(
        `${this.enquiries}/${enquiryId}/quotes`,
        dto,
      ),
    );
    return res.data;
  }

  async decline(enquiryId: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.enquiries}/${enquiryId}/decline`, {}),
    );
  }

  async inbox(): Promise<VendorEnquiryDto[]> {
    const res = await firstValueFrom(
      this.http.get<Envelope<VendorEnquiryDto[]>>(this.inboxUrl),
    );
    return res.data;
  }
}

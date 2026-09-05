import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  CreateQuoteRequest,
  OnboardVendorRequest,
  QuoteDto,
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

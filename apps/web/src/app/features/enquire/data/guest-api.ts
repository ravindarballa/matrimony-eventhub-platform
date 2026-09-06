import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  GuestEnquiryRequest,
  GuestEnquiryResponse,
  VendorSearchQuery,
  VendorSearchResult,
} from '@eventhub/contracts';

interface Envelope<T> {
  data: T;
}

/** Unwraps the envelope for httpResource's `parse`. */
export const unwrapGuest = <T>(raw: unknown): T => (raw as Envelope<T>).data;

/**
 * The two calls a signed-out visitor is allowed to make.
 *
 * Deliberately separate from CustomerApi: everything there assumes a session,
 * and a public page that leaned on it would be one careless import away from
 * firing an authenticated request it cannot make. Search is public on the
 * server, and the enquiry itself is authenticated by the one-time code rather
 * than a token.
 */
@Injectable({ providedIn: 'root' })
export class GuestApi {
  private readonly http = inject(HttpClient);

  private readonly vendors = '/api/v1/vendors';
  private readonly guestEnquiry = '/api/v1/enquiries/guest';

  /** Undefined filters are dropped, so the URL stays a stable cache key. */
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

  /**
   * Creates the account, the wedding and the enquiry in one request, and
   * returns a session with them.
   */
  async createEnquiry(dto: GuestEnquiryRequest): Promise<GuestEnquiryResponse> {
    const res = await firstValueFrom(
      this.http.post<Envelope<GuestEnquiryResponse>>(this.guestEnquiry, dto),
    );
    return res.data;
  }
}

export type { VendorSearchResult };

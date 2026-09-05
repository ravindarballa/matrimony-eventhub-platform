import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  InterestDto,
  MatrimonyProfileDto,
  PartnerPreferencesDto,
  ProfileDetailDto,
  ProfileSearchQuery,
  UpsertProfileRequest,
} from '@eventhub/contracts';

interface Envelope<T> {
  data: T;
}

export const unwrap = <T>(raw: unknown): T => (raw as Envelope<T>).data;

/** URLs and writes for the matrimony feature; reads use httpResource. */
@Injectable({ providedIn: 'root' })
export class MatrimonyApi {
  private readonly http = inject(HttpClient);

  readonly base = '/api/v1/matrimony';

  readonly meUrl = `${this.base}/profile/me`;
  readonly interestsUrl = `${this.base}/interests`;
  readonly quotaUrl = `${this.base}/interests/quota`;
  readonly shortlistUrl = `${this.base}/shortlist`;
  readonly preferencesUrl = `${this.base}/preferences`;

  profileUrl = (id: string): string => `${this.base}/profile/${id}`;
  interestTabUrl = (tab: string): string => `${this.interestsUrl}?tab=${tab}`;

  /**
   * Search. Array filters repeat the key rather than joining with commas,
   * because that is what the server's array DTO expects.
   */
  searchUrl(query: ProfileSearchQuery): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        for (const item of value) if (item) params.append(key, String(item));
      } else {
        params.set(key, String(value));
      }
    }
    const qs = params.toString();
    return qs ? `${this.base}/search?${qs}` : `${this.base}/search`;
  }

  async saveProfile(dto: UpsertProfileRequest): Promise<MatrimonyProfileDto> {
    const res = await firstValueFrom(
      this.http.put<Envelope<MatrimonyProfileDto>>(this.meUrl, dto),
    );
    return res.data;
  }

  async publish(): Promise<MatrimonyProfileDto> {
    const res = await firstValueFrom(
      this.http.post<Envelope<MatrimonyProfileDto>>(`${this.meUrl}/publish`, {}),
    );
    return res.data;
  }

  /** The handoff into the wedding side. The most valuable action on the platform. */
  async markEngaged(): Promise<MatrimonyProfileDto> {
    const res = await firstValueFrom(
      this.http.post<Envelope<MatrimonyProfileDto>>(`${this.meUrl}/engaged`, {}),
    );
    return res.data;
  }

  async savePreferences(
    dto: Omit<PartnerPreferencesDto, 'profileId'>,
  ): Promise<PartnerPreferencesDto> {
    const res = await firstValueFrom(
      this.http.put<Envelope<PartnerPreferencesDto>>(this.preferencesUrl, dto),
    );
    return res.data;
  }

  async viewProfile(id: string): Promise<ProfileDetailDto> {
    const res = await firstValueFrom(
      this.http.get<Envelope<ProfileDetailDto>>(this.profileUrl(id)),
    );
    return res.data;
  }

  async sendInterest(toProfileId: string, message?: string): Promise<InterestDto> {
    const res = await firstValueFrom(
      this.http.post<Envelope<InterestDto>>(this.interestsUrl, {
        toProfileId,
        message,
      }),
    );
    return res.data;
  }

  async acceptInterest(id: string): Promise<InterestDto> {
    const res = await firstValueFrom(
      this.http.post<Envelope<InterestDto>>(`${this.interestsUrl}/${id}/accept`, {}),
    );
    return res.data;
  }

  async declineInterest(id: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.interestsUrl}/${id}/decline`, {}),
    );
  }

  async withdrawInterest(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.interestsUrl}/${id}`));
  }

  async shortlist(targetProfileId: string, note?: string): Promise<void> {
    await firstValueFrom(
      this.http.post(this.shortlistUrl, { targetProfileId, note }),
    );
  }

  async removeShortlist(targetProfileId: string): Promise<void> {
    await firstValueFrom(
      this.http.delete(`${this.shortlistUrl}/${targetProfileId}`),
    );
  }

  async block(targetProfileId: string, reason?: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.base}/blocks`, { targetProfileId, reason }),
    );
  }
}

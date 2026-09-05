import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpClient, httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { formatInr, type VendorDto } from '@eventhub/contracts';

import type { AppError } from '../../../core/models/app-error';

interface Envelope<T> {
  data: T;
}

/**
 * Vendors waiting on verification, oldest first.
 *
 * Rejecting requires a reason and the form enforces it before the request is
 * even sent, because the server refuses a reasonless rejection anyway — and a
 * vendor told only "rejected" has nothing to act on and will simply resubmit
 * the same thing.
 */
@Component({
  selector: 'eh-kyc-queue-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatProgressBarModule],
  template: `
    <main class="wrap">
      <header>
        <h1>KYC queue</h1>
        <p class="sub">
          Verification gates money, not presence: an unverified vendor can list
          and be browsed, but cannot be sent an enquiry or paid.
        </p>
      </header>

      @if (queue.isLoading()) { <mat-progress-bar mode="indeterminate" /> }
      @if (message(); as m) { <p class="notice" role="status">{{ m }}</p> }

      @for (vendor of queue.value(); track vendor.id) {
        <article class="card">
          <div class="row">
            <div>
              <h2>{{ vendor.businessName }}</h2>
              <p class="meta">
                {{ label(vendor.category) }} · {{ vendor.city }}
                @if (vendor.priceFrom) { · from {{ inr(vendor.priceFrom) }} }
              </p>
            </div>
            <span class="status">{{ label(vendor.kycStatus) }}</span>
          </div>

          <p class="desc">{{ vendor.description }}</p>

          @if (rejecting() === vendor.id) {
            <label class="reason">
              <span>Why is this rejected?</span>
              <textarea
                rows="2"
                maxlength="300"
                [value]="reason()"
                (input)="reason.set($any($event.target).value)"
                placeholder="e.g. The bank proof is unreadable"
              ></textarea>
            </label>
            <div class="actions">
              <button mat-button [disabled]="busy()" (click)="rejecting.set(null)">
                Cancel
              </button>
              <button
                mat-flat-button
                class="danger"
                [disabled]="busy() || reason().trim().length < 5"
                (click)="decide(vendor.id, 'REJECTED')"
              >
                Confirm rejection
              </button>
            </div>
          } @else {
            <div class="actions">
              <button
                mat-flat-button
                [disabled]="busy()"
                (click)="decide(vendor.id, 'VERIFIED')"
              >
                Verify
              </button>
              <button mat-button [disabled]="busy()" (click)="startReject(vendor.id)">
                Reject
              </button>
            </div>
          }
        </article>
      } @empty {
        @if (!queue.isLoading()) {
          <section class="empty">
            <h2>Nothing waiting</h2>
            <p>Every submitted vendor has been reviewed.</p>
          </section>
        }
      }
    </main>
  `,
  styles: `
    .wrap { max-width: 46rem; margin: 2rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1rem; }
    h1 { margin: 0; font-size: 1.6rem; font-weight: 600; }
    .sub { margin: 0.25rem 0 0; color: rgb(0 0 0 / 0.6); font-size: 0.9rem; }
    .card { background: #fff; border: 1px solid rgb(0 0 0 / 0.12); border-radius: 10px;
            padding: 1.1rem 1.25rem; display: flex; flex-direction: column; gap: 0.6rem; }
    .row { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; }
    h2 { margin: 0; font-size: 1.02rem; font-weight: 600; }
    .meta { margin: 0.2rem 0 0; font-size: 0.85rem; color: rgb(0 0 0 / 0.6); }
    .status { font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
              letter-spacing: 0.05em; background: #fbf1dc; color: #8a5a00;
              border-radius: 999px; padding: 0.2rem 0.55rem; white-space: nowrap; }
    .desc { margin: 0; font-size: 0.88rem; color: rgb(0 0 0 / 0.75); }
    .reason { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.72rem;
              text-transform: uppercase; letter-spacing: 0.05em; color: rgb(0 0 0 / 0.55); }
    .reason textarea { font: inherit; font-size: 0.9rem; padding: 0.5rem;
                       border: 1px solid rgb(0 0 0 / 0.25); border-radius: 6px;
                       resize: vertical; text-transform: none; letter-spacing: normal;
                       color: rgb(0 0 0 / 0.87); }
    .actions { display: flex; gap: 0.6rem; }
    .danger { --mdc-filled-button-container-color: #b3261e; }
    .notice { margin: 0; font-size: 0.88rem; color: #0d47a1; background: #e3f2fd;
              border-left: 3px solid #0d47a1; padding: 0.6rem 0.8rem;
              border-radius: 0 6px 6px 0; }
    .empty { text-align: center; padding: 3rem 1rem; color: rgb(0 0 0 / 0.6); }
    .empty h2 { font-size: 1.1rem; margin: 0 0 0.4rem; }
  `,
})
export class KycQueuePage {
  private readonly http = inject(HttpClient);

  protected readonly queue = httpResource<VendorDto[]>(
    () => '/api/v1/vendors/kyc/pending',
    { parse: (raw) => (raw as Envelope<VendorDto[]>).data, defaultValue: [] },
  );

  protected readonly rejecting = signal<string | null>(null);
  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);

  protected startReject(vendorId: string): void {
    this.reason.set('');
    this.rejecting.set(vendorId);
  }

  protected async decide(
    vendorId: string,
    decision: 'VERIFIED' | 'REJECTED',
  ): Promise<void> {
    this.busy.set(true);
    this.message.set(null);
    try {
      await firstValueFrom(
        this.http.post(`/api/v1/vendors/${vendorId}/kyc-decision`, {
          decision,
          ...(decision === 'REJECTED' ? { reason: this.reason().trim() } : {}),
        }),
      );
      this.rejecting.set(null);
      this.queue.reload();
      this.message.set(
        decision === 'VERIFIED'
          ? 'Verified. They can now accept bookings.'
          : 'Rejected, and told why.',
      );
    } catch (e) {
      this.message.set((e as AppError).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected readonly inr = (paisa: number): string => formatInr(paisa as never);
  protected readonly label = (value: string): string =>
    value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
}

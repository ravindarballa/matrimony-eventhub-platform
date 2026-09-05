import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { FormField, form, submit } from '@angular/forms/signals';
import {
  maxLength,
  minLength,
  pattern,
  required,
  schema,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import {
  GSTIN_REGEX,
  IFSC_REGEX,
  PAN_REGEX,
  VendorCategory,
  type VendorDto,
} from '@eventhub/contracts';

import { VendorApi, unwrap } from '../data/vendor-api';
import type { AppError } from '../../../core/models/app-error';

interface BusinessModel {
  businessName: string;
  category: VendorCategory;
  city: string;
  description: string;
}

const businessSchema = schema<BusinessModel>((p) => {
  required(p.businessName, { message: 'What is the business called?' });
  minLength(p.businessName, 2);
  maxLength(p.businessName, 120);

  required(p.city, { message: 'Which city do you work in?' });
  minLength(p.city, 2);

  required(p.description, { message: 'Customers decide from this' });
  minLength(p.description, 20, {
    message: 'Tell customers a little more than that — at least 20 characters',
  });
  maxLength(p.description, 2000);
});

interface KycModel {
  pan: string;
  gstin: string;
  bankAccountName: string;
  bankAccountNumber: string;
  ifsc: string;
}

/**
 * Mirrors the server's DTO. The server stays the authority - its rejection
 * returns `fields` keyed by these same paths, so a server-side failure lands
 * on the right control.
 */
const kycSchema = schema<KycModel>((p) => {
  required(p.pan, { message: 'PAN is required' });
  pattern(p.pan, PAN_REGEX, { message: 'That is not a valid PAN (ABCDE1234F)' });

  required(p.bankAccountName, { message: 'Name as it appears on the account' });
  required(p.bankAccountNumber, { message: 'Account number is required' });
  pattern(p.bankAccountNumber, /^\d{9,18}$/, {
    message: 'An account number is 9 to 18 digits',
  });

  required(p.ifsc, { message: 'IFSC is required' });
  pattern(p.ifsc, IFSC_REGEX, { message: 'That is not a valid IFSC (HDFC0001234)' });
});

/**
 * Onboarding and verification in one place.
 *
 * The two halves are deliberately separate: a vendor can list and be browsed
 * straight away, while KYC - which gates money, not presence - can be completed
 * later. A rejection always states what to fix, because "rejected" on its own
 * is not something a vendor can act on.
 */
@Component({
  selector: 'eh-vendor-onboarding-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  template: `
    <main class="wrap">
      @if (vendor.isLoading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (!vendor.value()) {
        <header>
          <h1>List your business</h1>
          <p class="sub">
            This is what customers see in search. You can add packages and prices next.
          </p>
        </header>

        <form class="card" (submit)="$event.preventDefault(); createBusiness()">
          <mat-form-field appearance="outline">
            <mat-label>Business name</mat-label>
            <input matInput [formField]="b.businessName" />
            @if (b.businessName().touched() && b.businessName().errors().length) {
              <mat-error>{{ b.businessName().errors()[0].message }}</mat-error>
            }
          </mat-form-field>

          <label class="native">
            <span>Category</span>
            <select
              [value]="business().category"
              (change)="setCategory($any($event.target).value)"
            >
              @for (c of categories; track c) {
                <option [value]="c">{{ label(c) }}</option>
              }
            </select>
          </label>

          <mat-form-field appearance="outline">
            <mat-label>City</mat-label>
            <input matInput [formField]="b.city" />
            @if (b.city().touched() && b.city().errors().length) {
              <mat-error>{{ b.city().errors()[0].message }}</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>What you offer</mat-label>
            <textarea matInput rows="4" [formField]="b.description"></textarea>
            @if (b.description().touched() && b.description().errors().length) {
              <mat-error>{{ b.description().errors()[0].message }}</mat-error>
            }
          </mat-form-field>

          @if (error(); as e) { <p class="err" role="alert">{{ e }}</p> }

          <button mat-flat-button type="submit" [disabled]="busy()">
            Create listing
          </button>
        </form>
      } @else {
        <header>
          <h1>{{ vendor.value()!.businessName }}</h1>
          <p class="sub">
            {{ label(vendor.value()!.category) }} · {{ vendor.value()!.city }}
          </p>
        </header>

        @if (vendor.value()!.kycStatus === 'VERIFIED') {
          <section class="card done">
            <h2>✓ Verified</h2>
            <p>
              Your business is verified. You can accept bookings and receive payouts.
            </p>
          </section>
        } @else {
          <form class="card" (submit)="$event.preventDefault(); sendKyc()">
            <h2>Verification</h2>
            <p class="sub">
              PAN and bank details are checked before any money moves. GSTIN is only
              needed above the ₹20 lakh turnover threshold.
            </p>

            @if (vendor.value()!.kycStatus === 'REJECTED') {
              <p class="rejected" role="alert">
                <strong>Rejected:</strong> {{ vendor.value()!.kycRejectionReason }}
              </p>
            }
            @if (submitted()) {
              <p class="pending" role="status">
                Submitted for review. We will email you when it clears.
              </p>
            }

            <mat-form-field appearance="outline">
              <mat-label>PAN</mat-label>
              <input matInput [formField]="k.pan" style="text-transform: uppercase" />
              @if (k.pan().touched() && k.pan().errors().length) {
                <mat-error>{{ k.pan().errors()[0].message }}</mat-error>
              }
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>GSTIN (optional)</mat-label>
              <input matInput [formField]="k.gstin" style="text-transform: uppercase" />
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Account holder name</mat-label>
              <input matInput [formField]="k.bankAccountName" />
              @if (k.bankAccountName().touched() && k.bankAccountName().errors().length) {
                <mat-error>{{ k.bankAccountName().errors()[0].message }}</mat-error>
              }
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Account number</mat-label>
              <input matInput [formField]="k.bankAccountNumber" inputmode="numeric" />
              @if (
                k.bankAccountNumber().touched() && k.bankAccountNumber().errors().length
              ) {
                <mat-error>{{ k.bankAccountNumber().errors()[0].message }}</mat-error>
              }
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>IFSC</mat-label>
              <input matInput [formField]="k.ifsc" style="text-transform: uppercase" />
              @if (k.ifsc().touched() && k.ifsc().errors().length) {
                <mat-error>{{ k.ifsc().errors()[0].message }}</mat-error>
              }
            </mat-form-field>

            @if (error(); as e) { <p class="err" role="alert">{{ e }}</p> }

            <button mat-flat-button type="submit" [disabled]="busy()">
              Submit for verification
            </button>
          </form>
        }
      }
    </main>
  `,
  styles: `
    .wrap { max-width: 40rem; margin: 2.5rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1.25rem; }
    h1 { margin: 0; font-size: 1.6rem; font-weight: 600; }
    .sub { margin: 0.35rem 0 0; color: rgb(0 0 0 / 0.6); font-size: 0.9rem; }
    .card { display: flex; flex-direction: column; gap: 0.4rem; background: #fff;
            border: 1px solid rgb(0 0 0 / 0.12); border-radius: 12px; padding: 1.5rem; }
    .card h2 { margin: 0 0 0.2rem; font-size: 1.05rem; font-weight: 600; }
    .card.done { border-color: #c8e6c9; background: #f6fbf7; }
    .card.done h2 { color: #1b5e20; }
    .native { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.72rem;
              text-transform: uppercase; letter-spacing: 0.05em; color: rgb(0 0 0 / 0.55);
              margin-bottom: 0.9rem; }
    .native select { font: inherit; font-size: 0.95rem; padding: 0.7rem 0.6rem;
                     border: 1px solid rgb(0 0 0 / 0.38); border-radius: 4px;
                     text-transform: none; letter-spacing: normal; color: rgb(0 0 0 / 0.87); }
    .rejected { margin: 0 0 0.5rem; font-size: 0.88rem; color: #b3261e;
                background: #fdecea; border-left: 3px solid #b3261e;
                padding: 0.6rem 0.8rem; border-radius: 0 6px 6px 0; }
    .pending { margin: 0 0 0.5rem; font-size: 0.88rem; color: #8a5a00;
               background: #fbf1dc; border-left: 3px solid #c98a16;
               padding: 0.6rem 0.8rem; border-radius: 0 6px 6px 0; }
    .err { color: #b3261e; font-size: 0.9rem; margin: 0 0 0.5rem; }
    button { align-self: flex-start; }
  `,
})
export class VendorOnboardingPage {
  private readonly api = inject(VendorApi);

  protected readonly categories = Object.values(VendorCategory);

  protected readonly vendor = httpResource<VendorDto>(() => this.api.meUrl, {
    parse: unwrap<VendorDto>,
  });

  protected readonly business = signal<BusinessModel>({
    businessName: '',
    category: 'VENUE',
    city: '',
    description: '',
  });
  protected readonly b = form(this.business, businessSchema);

  protected readonly kyc = signal<KycModel>({
    pan: '',
    gstin: '',
    bankAccountName: '',
    bankAccountNumber: '',
    ifsc: '',
  });
  protected readonly k = form(this.kyc, kycSchema);

  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);

  protected setCategory(category: string): void {
    this.business.update((b) => ({ ...b, category: category as VendorCategory }));
  }

  protected createBusiness(): void {
    this.error.set(null);
    void submit(this.b, async () => {
      this.busy.set(true);
      try {
        await this.api.onboard(this.business());
        this.vendor.reload();
      } catch (e) {
        this.error.set((e as AppError).message);
      } finally {
        this.busy.set(false);
      }
    });
  }

  protected sendKyc(): void {
    this.error.set(null);
    void submit(this.k, async () => {
      const value = this.kyc();
      this.busy.set(true);
      try {
        await this.api.submitKyc({
          pan: value.pan.toUpperCase(),
          // An empty optional field must be absent, not an empty string - the
          // server validates the GSTIN format whenever one is present.
          gstin: value.gstin ? value.gstin.toUpperCase() : undefined,
          bankAccountName: value.bankAccountName,
          bankAccountNumber: value.bankAccountNumber,
          ifsc: value.ifsc.toUpperCase(),
        });
        this.submitted.set(true);
        this.vendor.reload();
      } catch (e) {
        this.error.set((e as AppError).message);
      } finally {
        this.busy.set(false);
      }
    });
  }

  protected readonly label = (value: string): string =>
    value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');

  /** Only referenced so the GSTIN constant stays wired to the shared contract. */
  protected readonly gstinPattern = GSTIN_REGEX;
}

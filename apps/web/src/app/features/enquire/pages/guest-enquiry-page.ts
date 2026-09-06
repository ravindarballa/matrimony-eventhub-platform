import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import {
  FunctionType,
  MAX_ENQUIRY_VENDORS,
  VendorCategory,
  formatInr,
  toPaisa,
  type Paisa,
  type VendorSearchResult,
} from '@eventhub/contracts';

import { GuestApi, unwrapGuest } from '../data/guest-api';
import { AuthApi } from '../../auth/data/auth-api';
import { AuthStore } from '../../auth/data/auth.store';
import type { AppError } from '../../../core/models/app-error';

const CATEGORIES = Object.values(VendorCategory);
const FUNCTIONS = Object.values(FunctionType);

type Step = 'pick' | 'details' | 'code';

/**
 * The open front door: ask several vendors for a quote without an account.
 *
 * The point of the screen is that a family reaches a real enquiry without ever
 * meeting a signup form. Identity is proved once, at the end, by a code sent to
 * the number a vendor would reply to anyway - which is the first moment an
 * identity is genuinely needed. The account is created behind that, and the
 * response signs the browser in, so the quotes land in a portal the visitor
 * never consciously registered for.
 */
@Component({
  selector: 'eh-guest-enquiry-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, MatProgressBarModule],
  template: `
    <main class="wrap">
      <header class="head">
        <h1>Get quotes for your wedding</h1>
        <p class="sub">
          Pick up to {{ maxVendors }} vendors and ask them all at once. No account needed —
          we verify your mobile at the end so vendors can reply.
        </p>
        <ol class="steps" aria-label="Progress">
          <li [class.on]="step() === 'pick'" [class.done]="step() !== 'pick'">1. Choose vendors</li>
          <li [class.on]="step() === 'details'" [class.done]="step() === 'code'">2. Your details</li>
          <li [class.on]="step() === 'code'">3. Verify mobile</li>
        </ol>
      </header>

      @if (busy() || results.isLoading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (error(); as e) {
        <p class="err" role="alert">{{ e }}</p>
      }

      @if (step() === 'pick') {
        <section class="filters">
          <label>
            <span>Category</span>
            <select [value]="category()" (change)="category.set($any($event.target).value)">
              @for (c of categories; track c) {
                <option [value]="c">{{ label(c) }}</option>
              }
            </select>
          </label>

          <label>
            <span>City</span>
            <input
              type="text"
              placeholder="Pune"
              [value]="city()"
              (change)="city.set($any($event.target).value)"
            />
          </label>

          <label>
            <span>Function date</span>
            <input
              type="date"
              [min]="today"
              [value]="date()"
              (change)="date.set($any($event.target).value)"
            />
          </label>
        </section>

        @if (!date()) {
          <p class="hint">
            Pick a date and we will only show vendors who are actually free that day.
          </p>
        }

        @if (selected().size) {
          <section class="tray" role="status">
            <div>
              <strong>{{ selected().size }} selected</strong>
              <span class="muted"> · up to {{ maxVendors }}</span>
            </div>
            <button mat-flat-button (click)="toDetails()">Continue</button>
          </section>
        }

        @for (vendor of results.value(); track vendor.id) {
          <article class="card" [class.picked]="selected().has(vendor.id)">
            <div class="row">
              <div>
                <h2>{{ vendor.businessName }}</h2>
                <p class="meta">
                  {{ label(vendor.category) }} · {{ vendor.city }}
                  @if (vendor.kycStatus === 'VERIFIED') {
                    <span class="verified" title="Identity and bank details verified">
                      ✓ Verified
                    </span>
                  }
                </p>
              </div>
              <div class="price">
                @if (vendor.priceFrom) {
                  <span class="from">from</span>
                  <strong>{{ inr(vendor.priceFrom) }}</strong>
                }
              </div>
            </div>

            <p class="desc">{{ vendor.description }}</p>

            <div class="stats">
              <span>{{ vendor.rating || '—' }}★ ({{ vendor.reviewCount }})</span>
              <span>{{ vendor.completedBookings }} bookings</span>
              @if (vendor.medianResponseMins !== null) {
                <span>replies in ~{{ responseLabel(vendor.medianResponseMins!) }}</span>
              }
            </div>

            <button
              mat-stroked-button
              [disabled]="!selected().has(vendor.id) && selected().size >= maxVendors"
              (click)="toggle(vendor)"
            >
              {{ selected().has(vendor.id) ? 'Remove' : 'Add to enquiry' }}
            </button>
          </article>
        } @empty {
          @if (!results.isLoading()) {
            <section class="empty">
              <h2>Nothing free on that date</h2>
              <p>Try another date, a nearby city, or a different category.</p>
            </section>
          }
        }
      }

      @if (step() === 'details') {
        <section class="panel">
          <h2>About your function</h2>
          <p class="chosen">
            Asking <strong>{{ chosenNames() }}</strong>
            <button mat-button type="button" (click)="step.set('pick')">Change</button>
          </p>

          <form class="grid" (submit)="$event.preventDefault(); sendCode()">
            <label class="wide">
              <span>Your name</span>
              <input
                type="text"
                autocomplete="name"
                [value]="fullName()"
                (input)="fullName.set($any($event.target).value)"
              />
            </label>

            <label>
              <span>Mobile number</span>
              <input
                type="tel"
                inputmode="numeric"
                maxlength="10"
                autocomplete="tel-national"
                placeholder="9812345678"
                [value]="mobile()"
                (input)="mobile.set($any($event.target).value)"
              />
            </label>

            <label>
              <span>Function</span>
              <select
                [value]="functionType()"
                (change)="functionType.set($any($event.target).value)"
              >
                @for (fn of functions; track fn) {
                  <option [value]="fn">{{ label(fn) }}</option>
                }
              </select>
            </label>

            <label>
              <span>Guests</span>
              <input
                type="number"
                min="1"
                [value]="guestCount()"
                (input)="guestCount.set(+$any($event.target).value)"
              />
            </label>

            <label>
              <span>Budget (₹, optional)</span>
              <input
                type="number"
                min="0"
                placeholder="500000"
                [value]="budgetRupees() ?? ''"
                (input)="onBudget($any($event.target).value)"
              />
            </label>

            <label class="wide">
              <span>Anything they should know (optional)</span>
              <textarea
                rows="3"
                maxlength="1000"
                [value]="notes()"
                (input)="notes.set($any($event.target).value)"
              ></textarea>
            </label>

            <button mat-flat-button type="submit" class="wide" [disabled]="busy()">
              Send me a code
            </button>
          </form>
        </section>
      }

      @if (step() === 'code') {
        <section class="panel">
          <h2>Verify your mobile</h2>
          <p class="sub">
            We sent a 6-digit code to <strong>+91 {{ mobile() }}</strong>.
            <button mat-button type="button" (click)="step.set('details')">Change number</button>
          </p>

          <form class="grid" (submit)="$event.preventDefault(); submitEnquiry()">
            <label class="wide">
              <span>6-digit code</span>
              <input
                type="text"
                inputmode="numeric"
                maxlength="6"
                autocomplete="one-time-code"
                [value]="code()"
                (input)="code.set($any($event.target).value)"
              />
            </label>

            @if (devCode()) {
              <p class="dev wide">
                Development mode — your code is <strong>{{ devCode() }}</strong>
              </p>
            }

            <button mat-flat-button type="submit" class="wide" [disabled]="busy()">
              Send enquiry to {{ selected().size === 1 ? 'this vendor' : 'these vendors' }}
            </button>
          </form>
        </section>
      }

      <p class="alt">Already have an account? <a routerLink="/auth/login">Sign in</a></p>
    </main>
  `,
  styles: `
    .wrap { max-width: 52rem; margin: 2rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1rem; }
    .head h1 { margin: 0; font-size: 1.6rem; font-weight: 600; }
    .sub { margin: 0.25rem 0 0; color: rgb(0 0 0 / 0.6); font-size: 0.9rem; }
    .steps { list-style: none; display: flex; gap: 1rem; flex-wrap: wrap;
             margin: 0.9rem 0 0; padding: 0; font-size: 0.8rem;
             color: rgb(0 0 0 / 0.45); }
    .steps li.on { color: #2f2d78; font-weight: 600; }
    .steps li.done { color: #1b5e20; }
    .filters { display: flex; gap: 0.75rem; flex-wrap: wrap;
               background: #fff; border: 1px solid rgb(0 0 0 / 0.12);
               border-radius: 10px; padding: 0.9rem 1rem; }
    .filters label { display: flex; flex-direction: column; gap: 0.25rem;
                     font-size: 0.72rem; text-transform: uppercase;
                     letter-spacing: 0.05em; color: rgb(0 0 0 / 0.55); }
    .filters input, .filters select { font: inherit; font-size: 0.9rem;
                     padding: 0.4rem 0.5rem; border-radius: 6px;
                     border: 1px solid rgb(0 0 0 / 0.25); text-transform: none;
                     letter-spacing: normal; color: rgb(0 0 0 / 0.87); }
    .hint { margin: 0; color: rgb(0 0 0 / 0.6); font-size: 0.85rem; }
    .tray { position: sticky; top: 0.5rem; z-index: 5;
            display: flex; align-items: center; justify-content: space-between;
            gap: 1rem; background: #2f2d78; color: #fff;
            padding: 0.7rem 1rem; border-radius: 10px; }
    .muted { opacity: 0.7; }
    .card { border: 1px solid rgb(0 0 0 / 0.12); border-radius: 10px; background: #fff;
            padding: 1.1rem 1.25rem; display: flex; flex-direction: column; gap: 0.6rem; }
    .card.picked { border-color: #2f2d78; box-shadow: 0 0 0 1px #2f2d78 inset; }
    .row { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; }
    h2 { margin: 0; font-size: 1.05rem; font-weight: 600; }
    .meta { margin: 0.2rem 0 0; font-size: 0.85rem; color: rgb(0 0 0 / 0.6); }
    .verified { color: #1b5e20; font-weight: 700; margin-left: 0.4rem; }
    .price { text-align: right; }
    .from { display: block; font-size: 0.7rem; color: rgb(0 0 0 / 0.5); }
    .price strong { font-variant-numeric: tabular-nums; }
    .desc { margin: 0; font-size: 0.88rem; color: rgb(0 0 0 / 0.75); }
    .stats { display: flex; gap: 1rem; font-size: 0.8rem; color: rgb(0 0 0 / 0.55); flex-wrap: wrap; }
    .empty { text-align: center; padding: 3rem 1rem; color: rgb(0 0 0 / 0.6); }
    .empty h2 { font-size: 1.1rem; margin: 0 0 0.4rem; }
    .panel { border: 1px solid rgb(0 0 0 / 0.12); border-radius: 10px; background: #fff;
             padding: 1.25rem 1.4rem; display: flex; flex-direction: column; gap: 0.8rem; }
    .chosen { margin: 0; font-size: 0.9rem; color: rgb(0 0 0 / 0.7); }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.9rem; }
    .grid .wide { grid-column: 1 / -1; }
    .grid label { display: flex; flex-direction: column; gap: 0.3rem;
                  font-size: 0.72rem; text-transform: uppercase;
                  letter-spacing: 0.05em; color: rgb(0 0 0 / 0.55); }
    .grid input, .grid select, .grid textarea { font: inherit; font-size: 0.95rem;
                  padding: 0.5rem 0.6rem; border-radius: 6px;
                  border: 1px solid rgb(0 0 0 / 0.25); text-transform: none;
                  letter-spacing: normal; color: rgb(0 0 0 / 0.87); }
    .dev { margin: 0; font-size: 0.85rem; color: #8a5a00;
           background: #fbf1dc; border-left: 3px solid #c98a16;
           padding: 0.5rem 0.7rem; border-radius: 0 6px 6px 0; }
    .err { color: #b3261e; font-size: 0.9rem; margin: 0; }
    .alt { font-size: 0.9rem; text-align: center; margin: 0.5rem 0 0; color: rgb(0 0 0 / 0.6); }
    @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
  `,
})
export class GuestEnquiryPage {
  private readonly api = inject(GuestApi);
  private readonly auth = inject(AuthApi);
  private readonly store = inject(AuthStore);
  private readonly router = inject(Router);

  protected readonly categories = CATEGORIES;
  protected readonly functions = FUNCTIONS;
  protected readonly maxVendors = MAX_ENQUIRY_VENDORS;
  protected readonly today = new Date().toISOString().slice(0, 10);

  protected readonly step = signal<Step>('pick');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  // Step 1 - what they are asking for, and who they are asking.
  protected readonly category = signal<VendorCategory>('VENUE');
  protected readonly city = signal('');
  protected readonly date = signal('');
  protected readonly selected = signal<Map<string, VendorSearchResult>>(new Map());

  // Step 2 - the details a vendor needs in order to quote.
  protected readonly fullName = signal('');
  protected readonly mobile = signal('');
  protected readonly functionType = signal<FunctionType>('WEDDING');
  protected readonly guestCount = signal(200);
  protected readonly budgetRupees = signal<number | null>(null);
  protected readonly notes = signal('');

  // Step 3 - the code that stands in for a password.
  protected readonly challengeId = signal<string | null>(null);
  protected readonly devCode = signal<string | null>(null);
  protected readonly code = signal('');

  /**
   * Search re-runs itself from the filter signals. It stays live across the
   * later steps, so coming back through "Change" shows the same results rather
   * than an empty list and a spinner.
   */
  protected readonly results = httpResource<VendorSearchResult[]>(
    () =>
      this.api.searchUrl({
        category: this.category(),
        city: this.city() || undefined,
        date: this.date() || undefined,
        sort: 'rating',
      }),
    { parse: unwrapGuest<VendorSearchResult[]>, defaultValue: [] },
  );

  protected readonly chosenNames = computed(() =>
    [...this.selected().values()].map((v) => v.businessName).join(', '),
  );

  protected toggle(vendor: VendorSearchResult): void {
    const next = new Map(this.selected());
    if (next.has(vendor.id)) next.delete(vendor.id);
    else if (next.size < MAX_ENQUIRY_VENDORS) next.set(vendor.id, vendor);
    this.selected.set(next);
  }

  protected onBudget(raw: string): void {
    this.budgetRupees.set(raw === '' ? null : Number(raw));
  }

  /**
   * The date and city are collected on step one because they filter the
   * results, so by the time anyone reaches the form they are already answered.
   */
  protected toDetails(): void {
    if (!this.date()) {
      this.error.set('Pick the function date before continuing.');
      return;
    }
    if (!this.city().trim()) {
      this.error.set('Enter the city the function is in.');
      return;
    }
    this.error.set(null);
    this.step.set('details');
  }

  /** Step two: request the one-time code that will authenticate the enquiry. */
  protected async sendCode(): Promise<void> {
    const problem = this.detailsProblem();
    if (problem) {
      this.error.set(problem);
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    try {
      const { challengeId, devCode } = await this.auth.requestLoginOtpOnce(this.mobile());
      this.challengeId.set(challengeId);
      this.devCode.set(devCode ?? null);
      this.code.set('');
      this.step.set('code');
    } catch (e) {
      this.error.set((e as AppError).message);
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Step three. One request creates the account, the wedding and the enquiry,
   * and hands back a session - which is applied here, so the visitor lands in
   * their own portal already signed in rather than at a login screen.
   */
  protected async submitEnquiry(): Promise<void> {
    const challengeId = this.challengeId();
    if (!challengeId) {
      this.step.set('details');
      return;
    }
    if (!/^\d{6}$/.test(this.code())) {
      this.error.set('Enter the 6-digit code we sent you.');
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    try {
      const rupees = this.budgetRupees();
      const res = await this.api.createEnquiry({
        fullName: this.fullName().trim(),
        mobile: this.mobile(),
        otpChallengeId: challengeId,
        otpCode: this.code(),
        city: this.city().trim(),
        category: this.category(),
        functionType: this.functionType(),
        functionDate: new Date(this.date()).toISOString(),
        guestCount: this.guestCount(),
        ...(rupees ? { budget: toPaisa(rupees) } : {}),
        ...(this.notes().trim() ? { notes: this.notes().trim() } : {}),
        vendorIds: [...this.selected().keys()],
      });

      this.store.setSession(res.user, res.accessToken);
      await this.router.navigate(['/customer/enquiries', res.enquiry.id]);
    } catch (e) {
      const err = e as AppError;
      // A consumed or stale code is the one failure worth explaining, because
      // the fix is to request another rather than to retype the same digits.
      this.error.set(
        err.code === 'AUTH_OTP_INVALID'
          ? 'That code is not right. Check it, or go back and request a new one.'
          : err.code === 'AUTH_OTP_EXPIRED'
            ? 'That code has expired. Go back and request a new one.'
            : err.message,
      );
    } finally {
      this.busy.set(false);
    }
  }

  /** The first thing wrong with the form, or null when it is sendable. */
  private detailsProblem(): string | null {
    if (this.fullName().trim().length < 2) return 'Enter your name.';
    if (!/^[6-9]\d{9}$/.test(this.mobile()))
      return 'Enter a 10-digit Indian mobile number.';
    if (!Number.isInteger(this.guestCount()) || this.guestCount() < 1)
      return 'Enter how many guests you expect.';
    const rupees = this.budgetRupees();
    if (rupees !== null && (!Number.isFinite(rupees) || rupees < 0))
      return 'Enter a budget of zero or more, or leave it blank.';
    return null;
  }

  protected readonly inr = (paisa: number): string => formatInr(paisa as Paisa);
  protected readonly label = (value: string): string =>
    value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
  protected readonly responseLabel = (mins: number): string =>
    mins < 60 ? `${mins} min` : `${Math.round(mins / 60)} h`;
}

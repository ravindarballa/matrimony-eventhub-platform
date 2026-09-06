import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { firstValueFrom } from 'rxjs';
import { INDIAN_MOBILE_REGEX } from '@eventhub/contracts';

import { AuthApi } from '../../auth/data/auth-api';
import { AuthStore } from '../../auth/data/auth.store';
import type { AppError } from '../../../core/models/app-error';
import { landingRouteFor } from '../../../core/guards/auth.guards';
import { ServiceGlyph, type GlyphName } from './service-glyph';

/** Both sides of a match and every service, scattered behind the fold. */
const BACKDROP: GlyphName[] = [
  'BRIDE', 'VENUE', 'GROOM', 'CATERING', 'DECOR', 'BRIDE',
  'PHOTOGRAPHY', 'GROOM', 'MUSIC', 'BRIDE', 'PANDIT', 'MAKEUP',
  'GROOM', 'INVITATION', 'BRIDE', 'TRANSPORT', 'VENUE', 'GROOM',
  'DECOR', 'BRIDE', 'CATERING', 'GROOM', 'PHOTOGRAPHY', 'MUSIC',
];

type TabId = 'SEEKER' | 'CUSTOMER' | 'VENDOR_OWNER';

/**
 * The three reasons someone is here, and where each one goes.
 *
 * Two of them need nothing but a verified number, so they hand off to the
 * ordinary signup with the intent already chosen. Finding a match needs a
 * profile, so it gets its own form - an account with no community, mother
 * tongue or date of birth cannot be searched, which makes it an empty seat.
 */
const TABS: { id: TabId; label: string }[] = [
  { id: 'SEEKER', label: 'Find a match' },
  { id: 'CUSTOMER', label: 'Plan a wedding' },
  { id: 'VENDOR_OWNER', label: 'List my business' },
];

/**
 * The masthead and the partner search.
 *
 * Split from the rest of the page because it carries most of the styling, and
 * one component holding an entire landing page's CSS trips the per-component
 * style budget - a warning that fires on every build is a warning people stop
 * reading. The seam is a real one either way: this is the part that has to
 * convert, and everything below it is explanation.
 */
@Component({
  selector: 'eh-home-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, ServiceGlyph],
  template: `
    <header class="bar">
      <a class="brand" routerLink="/">
        <span class="mark">EH</span>
        <span>Matrimony <strong>EventHub</strong></span>
      </a>
      <nav>
        @if (store.isAuthenticated()) {
          <a mat-flat-button class="cta" [routerLink]="myPortal()">Go to my account</a>
        } @else {
          <a mat-button routerLink="/auth/login">Sign in</a>
          <a mat-flat-button class="cta" routerLink="/auth/register">Register free</a>
        }
      </nav>
    </header>

    <section class="hero">
      <!-- Decorative, so it is hidden from assistive technology entirely. -->
      <div class="wash" aria-hidden="true">
        @for (glyph of backdrop; track $index) {
          <eh-service-glyph [name]="glyph" />
        }
      </div>

      <div class="inner">
        <div class="pitch">
          <h1>Find someone. Then plan the wedding.</h1>
          <p>
            Matches your family would approve of, and every vendor the wedding
            needs — venue, caterer, pandit, photographer — from one account.
          </p>
          <ul class="trust">
            <li><strong>Verified</strong> profiles and KYC-checked vendors</li>
            <li><strong>Photos reviewed</strong> before anyone else sees them</li>
            <li><strong>Money held</strong> until the booking is confirmed</li>
          </ul>
        </div>

        <div class="panel">
          <!--
            The three things a visitor can be here to do, as tabs. They are the
            same three the signup form has always offered in a dropdown - moving
            them here means the choice is made before the form rather than
            buried inside it, and each one can then ask for only what it needs.
          -->
          <div class="tabs" role="tablist">
            @for (t of tabs; track t.id) {
              <button
                type="button"
                role="tab"
                [id]="'tab-' + t.id"
                [attr.aria-selected]="tab() === t.id"
                [attr.aria-controls]="'panel-' + t.id"
                [class.on]="tab() === t.id"
                (click)="tab.set(t.id)"
              >
                {{ t.label }}
              </button>
            }
          </div>

          @if (tab() === 'SEEKER') {
            <form
              class="body"
              role="tabpanel"
              id="panel-SEEKER"
              aria-labelledby="tab-SEEKER"
              (submit)="$event.preventDefault(); findMatches()"
            >
              <label>
                <span>I'm looking for</span>
                <select [value]="lookingFor()" (change)="lookingFor.set($any($event.target).value)">
                  <option value="BRIDE" [selected]="lookingFor() === 'BRIDE'">A bride</option>
                  <option value="GROOM" [selected]="lookingFor() === 'GROOM'">A groom</option>
                </select>
              </label>

              <div class="two">
                <label>
                  <span>Age from</span>
                  <select [value]="ageMin()" (change)="ageMin.set(+$any($event.target).value)">
                    @for (age of ages; track age) {
                      <option [value]="age" [selected]="age === ageMin()">{{ age }}</option>
                    }
                  </select>
                </label>
                <label>
                  <span>to</span>
                  <select [value]="ageMax()" (change)="ageMax.set(+$any($event.target).value)">
                    @for (age of ages; track age) {
                      <option [value]="age" [selected]="age === ageMax()">{{ age }}</option>
                    }
                  </select>
                </label>
              </div>

              @if (ageError()) { <p class="err" role="alert">{{ ageError() }}</p> }

              <button mat-flat-button type="submit" class="go">Search profiles</button>
              <p class="fine">
                Searching needs a profile — it is what decides who you are shown.
                Three short steps.
              </p>
            </form>
          } @else if (tab() === 'CUSTOMER') {
            <div class="body" role="tabpanel" id="panel-CUSTOMER" aria-labelledby="tab-CUSTOMER">
              <h2>Plan the wedding</h2>
              <p class="lead">
                Tell us the date and the city. Vendors who are actually free that
                day come back with prices.
              </p>
              <ul class="ticks">
                <li>Ask up to five vendors in one go</li>
                <li>Compare quotes side by side, GST included</li>
                <li>Your money is held until the booking is confirmed</li>
              </ul>
              <a mat-flat-button class="go" routerLink="/enquire">Get quotes</a>
              <p class="fine">No account needed. We verify your mobile only when you send.</p>
            </div>
          } @else {
            <div class="body" role="tabpanel" id="panel-VENDOR_OWNER" aria-labelledby="tab-VENDOR_OWNER">
              <h2>List your business</h2>

              @if (!vendorChallenge()) {
                <p class="lead">
                  Reach families planning a wedding in your city. Verify your
                  number and you are in.
                </p>

                <label>
                  <span>Business or owner name</span>
                  <input
                    type="text"
                    autocomplete="organization"
                    placeholder="Sunrise Banquets"
                    [value]="vendorName()"
                    (input)="vendorName.set($any($event.target).value)"
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
                    [value]="vendorMobile()"
                    (input)="vendorMobile.set($any($event.target).value)"
                  />
                </label>

                @if (vendorError()) { <p class="err" role="alert">{{ vendorError() }}</p> }

                <button mat-flat-button class="go" [disabled]="vendorBusy()"
                        (click)="sendVendorCode()">
                  Send me a code
                </button>
                <p class="fine">By continuing you accept the terms and privacy policy.</p>
              } @else {
                <p class="lead">Enter the 6-digit code sent to +91 {{ vendorMobile() }}.</p>

                <label>
                  <span>6-digit code</span>
                  <input
                    type="text"
                    inputmode="numeric"
                    maxlength="6"
                    autocomplete="one-time-code"
                    [value]="vendorCode()"
                    (input)="vendorCode.set($any($event.target).value)"
                  />
                </label>

                @if (vendorDevCode()) {
                  <p class="dev">
                    Development mode — your code is <strong>{{ vendorDevCode() }}</strong>
                  </p>
                }
                @if (vendorError()) { <p class="err" role="alert">{{ vendorError() }}</p> }

                <button mat-flat-button class="go" [disabled]="vendorBusy()"
                        (click)="verifyVendor()">
                  Verify and continue
                </button>
                <button mat-button type="button" (click)="changeVendorNumber()">
                  Change number
                </button>
              }
            </div>
          }
        </div>
      </div>
    </section>
  `,
  styles: `
    :host { display: block; --ink: #2f2d78; --gold: #e8b341; }
    .bar { position: sticky; top: 0; z-index: 20; display: flex; gap: 1rem;
           align-items: center; justify-content: space-between;
           padding: 0.7rem clamp(1rem, 4vw, 3rem); background: var(--ink); color: #fff; }
    .brand { display: flex; align-items: center; gap: 0.6rem; color: inherit;
             text-decoration: none; font-size: 1.05rem; }
    .brand strong { color: var(--gold); font-weight: 700; }
    .mark { display: grid; place-items: center; width: 2rem; height: 2rem;
            border-radius: 7px; background: #fff; color: var(--ink);
            font-weight: 800; font-size: 0.85rem; }
    .bar nav { display: flex; align-items: center; gap: 0.4rem; }
    .bar a[mat-button] { color: #fff; }
    .cta { background: var(--gold) !important; color: #2a2410 !important; font-weight: 700; }

    .hero { position: relative; overflow: hidden; color: #fff;
            background: radial-gradient(1100px 520px at 15% -10%, #4a47a8 0%, transparent 60%),
                        linear-gradient(160deg, #2f2d78 0%, #23214f 100%); }
    .wash { position: absolute; inset: -4% -2% -8%; display: grid;
            grid-template-columns: repeat(6, 1fr); gap: clamp(1rem, 3vw, 2.5rem);
            opacity: 0.13; pointer-events: none; transform: rotate(-8deg) scale(1.15); }
    .wash eh-service-glyph { width: 100%; aspect-ratio: 1; }
    .wash eh-service-glyph:nth-child(3n) { transform: rotate(9deg); }
    .wash eh-service-glyph:nth-child(4n) { transform: rotate(-11deg) scale(0.85); }

    .inner { position: relative; z-index: 1; max-width: 68rem; margin: 0 auto;
             display: grid; grid-template-columns: 1.05fr 0.95fr; align-items: center;
             gap: clamp(1.5rem, 5vw, 3.5rem);
             padding: clamp(2.5rem, 7vw, 5rem) clamp(1rem, 4vw, 2rem) clamp(3rem, 8vw, 5rem); }
    h1 { margin: 0; font-size: clamp(1.9rem, 4.6vw, 3rem); line-height: 1.1;
         font-weight: 700; letter-spacing: -0.02em; }
    .pitch > p { margin: 0.9rem 0 0; max-width: 34ch; line-height: 1.6; opacity: 0.9; }
    .trust { list-style: none; margin: 1.6rem 0 0; padding: 0; display: flex;
             flex-direction: column; gap: 0.5rem; font-size: 0.9rem; }
    .trust li { position: relative; padding-left: 1.5rem; opacity: 0.92; }
    .trust li::before { content: "✓"; position: absolute; left: 0;
                        color: var(--gold); font-weight: 700; }
    .trust strong { color: var(--gold); font-weight: 700; }

    .panel { background: #fff; color: rgb(0 0 0 / 0.87); border-radius: 14px;
             overflow: hidden; box-shadow: 0 18px 44px rgb(0 0 0 / 0.28); }
    .tabs { display: grid; grid-template-columns: repeat(3, 1fr);
            background: rgb(47 45 120 / 0.06); }
    .tabs button { font: inherit; font-size: 0.82rem; font-weight: 600; cursor: pointer;
                   padding: 0.8rem 0.4rem; border: 0; background: transparent;
                   color: rgb(0 0 0 / 0.55); border-bottom: 3px solid transparent; }
    .tabs button.on { background: #fff; color: var(--ink); border-bottom-color: var(--gold); }
    .body { display: flex; flex-direction: column; gap: 0.85rem;
            padding: 1.3rem 1.5rem 1.5rem; }
    .body h2 { margin: 0; font-size: 1.15rem; font-weight: 700; color: var(--ink); }
    .lead { margin: 0; font-size: 0.92rem; line-height: 1.6; color: rgb(0 0 0 / 0.68); }
    .ticks { list-style: none; margin: 0; padding: 0; display: flex;
             flex-direction: column; gap: 0.4rem; font-size: 0.88rem;
             color: rgb(0 0 0 / 0.72); }
    .ticks li { position: relative; padding-left: 1.4rem; }
    .ticks li::before { content: "✓"; position: absolute; left: 0;
                        color: #1b5e20; font-weight: 700; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
    label { display: flex; flex-direction: column; gap: 0.28rem; font-size: 0.68rem;
            text-transform: uppercase; letter-spacing: 0.06em; color: rgb(0 0 0 / 0.55); }
    select { font: inherit; font-size: 0.95rem; padding: 0.55rem 0.6rem; border-radius: 8px;
             border: 1px solid rgb(0 0 0 / 0.22); background: #fff; color: rgb(0 0 0 / 0.87);
             text-transform: none; letter-spacing: normal; }
    .go { margin-top: 0.3rem; background: var(--ink) !important;
          color: #fff !important; font-weight: 700; }
    .fine { margin: 0; font-size: 0.75rem; color: rgb(0 0 0 / 0.55); text-align: center; }
    .fine a { color: var(--ink); font-weight: 600; }
    .err { margin: 0; font-size: 0.82rem; color: #b3261e; }

    @media (max-width: 880px) {
      .inner { grid-template-columns: 1fr; }
      .wash { grid-template-columns: repeat(4, 1fr); opacity: 0.1; }
    }
    @media (max-width: 520px) {
      .two { grid-template-columns: 1fr; }
      .trust { display: none; }
    }
  `,
})
export class HomeHero {
  protected readonly store = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly api = inject(AuthApi);

  protected readonly backdrop = BACKDROP;
  protected readonly ages = Array.from({ length: 39 }, (_, i) => i + 18);

  protected readonly tabs = TABS;
  protected readonly tab = signal<TabId>('SEEKER');

  protected readonly lookingFor = signal<'BRIDE' | 'GROOM'>('BRIDE');
  protected readonly ageMin = signal(24);
  protected readonly ageMax = signal(32);

  // The vendor path validates a number in place: it is the whole of what a
  // vendor needs to get started, so bouncing them to a separate form for one
  // field would be ceremony for its own sake.
  protected readonly vendorName = signal('');
  protected readonly vendorMobile = signal('');
  protected readonly vendorCode = signal('');
  protected readonly vendorChallenge = signal<string | null>(null);
  protected readonly vendorDevCode = signal<string | null>(null);
  protected readonly vendorBusy = signal(false);
  protected readonly vendorError = signal<string | null>(null);

  protected readonly ageError = computed(() =>
    this.ageMin() > this.ageMax() ? 'The lower age has to be the smaller one.' : null,
  );

  protected readonly myPortal = computed(() => landingRouteFor(this.store.roles()));

  /**
   * Sends them to build a profile, carrying what they asked for.
   *
   * The search box cannot simply run a search: who a member is shown is
   * decided from their own profile - the server returns the opposite gender to
   * their own - so there is nothing to search until one exists. Rather than
   * bounce them to a login they have no account for, the criteria travel into
   * registration, which uses them to pick a starting gender and hands them
   * straight to the results afterwards.
   */
  protected findMatches(): void {
    if (this.ageError()) return;

    void this.router.navigate(['/auth/register/matrimony'], {
      queryParams: {
        seeking: this.lookingFor(),
        ageMin: this.ageMin(),
        ageMax: this.ageMax(),
      },
    });
  }

  /** Registers the vendor and sends the code, without leaving the tab. */
  protected async sendVendorCode(): Promise<void> {
    this.vendorError.set(null);
    if (this.vendorName().trim().length < 3) {
      this.vendorError.set('Enter the business or owner name.');
      return;
    }
    if (!INDIAN_MOBILE_REGEX.test(this.vendorMobile())) {
      this.vendorError.set('Enter a 10-digit Indian mobile number.');
      return;
    }

    this.vendorBusy.set(true);
    try {
      const res = await firstValueFrom(
        this.api.register({
          fullName: this.vendorName().trim(),
          mobile: this.vendorMobile(),
          intent: 'VENDOR_OWNER',
          consent: true,
        }),
      );
      this.vendorChallenge.set(res.challengeId);
      this.vendorDevCode.set(res.devCode ?? null);
    } catch (e) {
      this.vendorError.set((e as AppError).message);
    } finally {
      this.vendorBusy.set(false);
    }
  }

  protected changeVendorNumber(): void {
    this.vendorChallenge.set(null);
    this.vendorDevCode.set(null);
    this.vendorCode.set('');
    this.vendorError.set(null);
  }

  /**
   * Verifies the code and hands them to onboarding.
   *
   * Onboarding rather than the vendor dashboard: the account exists at this
   * point but the business does not, and every other vendor screen is about a
   * listing they have not created yet.
   */
  protected async verifyVendor(): Promise<void> {
    this.vendorError.set(null);
    if (!/^\d{6}$/.test(this.vendorCode())) {
      this.vendorError.set('Enter the 6-digit code we sent you.');
      return;
    }

    this.vendorBusy.set(true);
    try {
      await this.store.verifyOtp(this.vendorChallenge()!, this.vendorCode());
      await this.router.navigate(['/vendor/onboarding']);
    } catch (e) {
      const err = e as AppError;
      this.vendorError.set(
        err.code === 'AUTH_OTP_INVALID'
          ? 'That code is not right. Check it and try again.'
          : err.code === 'AUTH_OTP_EXPIRED'
            ? 'That code has expired. Ask for a new one.'
            : err.message,
      );
    } finally {
      this.vendorBusy.set(false);
    }
  }

}

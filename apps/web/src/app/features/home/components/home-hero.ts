import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';

import { AuthStore } from '../../auth/data/auth.store';
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
const TABS = [
  {
    id: 'SEEKER' as const,
    label: 'Find a match',
    heading: '',
    blurb: '',
    points: [] as string[],
    action: '',
    to: '/auth/register/matrimony',
    params: {} as Record<string, string>,
    fine: '',
  },
  {
    id: 'CUSTOMER' as const,
    label: 'Plan a wedding',
    heading: 'Plan the wedding',
    blurb:
      'Tell us the date and the city. Vendors who are actually free that day come back with prices.',
    points: [
      'Ask up to five vendors in one go',
      'Compare quotes side by side, GST included',
      'Your money is held until the booking is confirmed',
    ],
    action: 'Create an account',
    to: '/auth/register',
    params: { intent: 'CUSTOMER' },
    fine: 'Just a name and a mobile number.',
  },
  {
    id: 'VENDOR_OWNER' as const,
    label: 'List my business',
    heading: 'List your business',
    blurb:
      'Reach families planning a wedding in your city, and answer enquiries with a proper quote.',
    points: [
      'Free to list; you are paid through the platform',
      'Verification badge once your KYC clears',
      'A portfolio and a price list buyers can compare',
    ],
    action: 'List my business',
    to: '/auth/register',
    params: { intent: 'VENDOR_OWNER' },
    fine: 'Just a name and a mobile number to start.',
  },
];

const RELIGIONS = ['Hindu', 'Muslim', 'Christian', 'Sikh', 'Jain', 'Buddhist', 'Parsi'];
const TONGUES = [
  'Telugu', 'Hindi', 'Tamil', 'Kannada', 'Malayalam',
  'Marathi', 'Bengali', 'Gujarati', 'Punjabi', 'Odia',
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

              <div class="two">
                <label>
                  <span>Religion</span>
                  <select [value]="religion()" (change)="religion.set($any($event.target).value)">
                    <option value="" [selected]="religion() === ''">Any</option>
                    @for (r of religions; track r) {
                      <option [value]="r" [selected]="r === religion()">{{ r }}</option>
                    }
                  </select>
                </label>
                <label>
                  <span>Mother tongue</span>
                  <select [value]="tongue()" (change)="tongue.set($any($event.target).value)">
                    <option value="" [selected]="tongue() === ''">Any</option>
                    @for (t of tongues; track t) {
                      <option [value]="t" [selected]="t === tongue()">{{ t }}</option>
                    }
                  </select>
                </label>
              </div>

              @if (ageError()) { <p class="err" role="alert">{{ ageError() }}</p> }

              <button mat-flat-button type="submit" class="go">Search profiles</button>
              <p class="fine">
                Free to search.
                <a routerLink="/auth/register/matrimony">Create a profile</a> when you
                want to say hello.
              </p>
            </form>
          } @else {
            <div class="body" role="tabpanel" [id]="'panel-' + tab()" [attr.aria-labelledby]="'tab-' + tab()">
              <h2>{{ activeTab().heading }}</h2>
              <p class="lead">{{ activeTab().blurb }}</p>
              <ul class="ticks">
                @for (point of activeTab().points; track point) {
                  <li>{{ point }}</li>
                }
              </ul>

              <a mat-flat-button class="go" [routerLink]="activeTab().to"
                 [queryParams]="activeTab().params">
                {{ activeTab().action }}
              </a>
              <p class="fine">{{ activeTab().fine }}</p>
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

  protected readonly backdrop = BACKDROP;
  protected readonly religions = RELIGIONS;
  protected readonly tongues = TONGUES;
  protected readonly ages = Array.from({ length: 39 }, (_, i) => i + 18);

  protected readonly tabs = TABS;
  protected readonly tab = signal<TabId>('SEEKER');
  protected readonly activeTab = computed(
    () => TABS.find((t) => t.id === this.tab()) ?? TABS[0],
  );

  protected readonly lookingFor = signal<'BRIDE' | 'GROOM'>('BRIDE');
  protected readonly ageMin = signal(24);
  protected readonly ageMax = signal(32);
  protected readonly religion = signal('');
  protected readonly tongue = signal('');

  protected readonly ageError = computed(() =>
    this.ageMin() > this.ageMax() ? 'The lower age has to be the smaller one.' : null,
  );

  protected readonly myPortal = computed(() => landingRouteFor(this.store.roles()));

  /**
   * Runs the search.
   *
   * The criteria go into the URL rather than a store, so a signed-out visitor
   * keeps them: the route guard sends them to sign in holding this URL as
   * returnUrl, and they come back to the results they asked for instead of a
   * blank search to fill in twice.
   *
   * "Looking for a bride" is not one of the filters - the server decides who a
   * member may see from their own profile - so it travels as intent for the
   * registration form rather than pretending to be a filter here.
   */
  protected findMatches(): void {
    if (this.ageError()) return;

    void this.router.navigate(['/matrimony/search'], {
      queryParams: {
        ageMin: this.ageMin(),
        ageMax: this.ageMax(),
        ...(this.religion() ? { religion: this.religion() } : {}),
        ...(this.tongue() ? { motherTongue: this.tongue() } : {}),
        seeking: this.lookingFor(),
      },
    });
  }
}

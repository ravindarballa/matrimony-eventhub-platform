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
  CATEGORY_META,
  FunctionType,
  MAX_ENQUIRY_VENDORS,
  VendorCategory,
  categorySlug,
  formatInr,
  toPaisa,
  type Paisa,
  type VendorSearchResult,
} from '@eventhub/contracts';

import { GuestApi, unwrapGuest } from '../data/guest-api';
import { VendorCard } from '../components/vendor-card';
import { ComparePanel } from '../components/compare-panel';
import { ReviewsPanel } from '../components/reviews-panel';
import { WeddingMasthead } from '../../../core/components/wedding-masthead';
import { HERO_IMAGE } from '../../home/components/home-hero';
import { AuthApi } from '../../auth/data/auth-api';
import { AuthStore } from '../../auth/data/auth.store';
import type { AppError } from '../../../core/models/app-error';

const CATEGORIES = Object.values(VendorCategory);
const FUNCTIONS = Object.values(FunctionType);

/** The quick links under the search bar, as the reference carries them. */
const POPULAR: VendorCategory[] = [
  'VENUE',
  'PHOTOGRAPHY',
  'CATERING',
  'MAKEUP',
  'DECOR',
] as VendorCategory[];

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
  imports: [
    RouterLink,
    MatButtonModule,
    MatProgressBarModule,
    VendorCard,
    ComparePanel,
    ReviewsPanel,
    WeddingMasthead,
  ],
  template: `
    <!--
      A masthead, because this page had none at all. It is the only route a
      visitor with no account can do something real on, and it was rendering as
      a bare form on a white page - no brand, no way back to the marketplace,
      nothing to say what the site is. Shared, so the browse and landing pages
      can wear the same one.
    -->
    <eh-wedding-masthead context="wedding" />

    @if (step() === 'pick') {
      <section class="hero">
        @if (banner(); as url) {
          <img class="heroShot" [src]="url" alt="" fetchpriority="high" />
        }

        <div class="heroInner">
          <h1>Your wedding, your way</h1>
          <p class="heroSub">
            Ask up to {{ maxVendors }} vendors at once and compare what they quote.
            No account needed — we verify your mobile at the end so they can reply.
          </p>

          <form class="searchbar" (submit)="$event.preventDefault(); toResults()">
            <label class="field">
              <span>Vendor type</span>
              <select [value]="category()" (change)="category.set($any($event.target).value)">
                @for (c of categories; track c) {
                  <option [value]="c" [selected]="c === category()">{{ label(c) }}</option>
                }
              </select>
            </label>

            <label class="field">
              <span>City</span>
              <input
                type="text"
                placeholder="All cities"
                [value]="city()"
                (change)="city.set($any($event.target).value)"
              />
            </label>

            <label class="field">
              <span>Function date</span>
              <input
                type="date"
                [min]="today"
                [value]="date()"
                (change)="date.set($any($event.target).value)"
              />
            </label>

            <button type="submit" class="getstarted">Get started</button>
          </form>

          <p class="popular">
            <span class="plabel">Popular searches:</span>
            @for (c of popular; track c) {
              <a [routerLink]="['/vendors', slug(c)]">{{ meta(c).plural }}</a>
            }
          </p>
        </div>
      </section>
    }

    <main class="wrap">
      <header class="head">
        @if (step() !== 'pick') {
          <h1>Get quotes for your wedding</h1>
        }
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
        <div class="layout" id="results">
        <aside class="rail">
          <!--
            Vendor type, city and date now live in the hero search bar, which is
            where the reference puts them and where somebody arriving on the page
            looks first. What is left here is what narrows a list once it exists.
          -->
          <h2 class="railhead">Refine</h2>

          <section class="filters">
          <!--
            Guests and budget were asked for on step two, after the vendors had
            already been chosen. They belong here: without them a price list
            cannot be turned into what this wedding would cost, which is the
            only question the list is being read to answer.
          -->
          <label>
            <span>Guests</span>
            <input
              type="number"
              min="1"
              [value]="guestCount()"
              (input)="guestCount.set(+$any($event.target).value || 1)"
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

          <label>
            <span>Minimum rating</span>
            <select
              [value]="minRating()"
              (change)="minRating.set(+$any($event.target).value)"
            >
              <option [value]="0" [selected]="minRating() === 0">Any</option>
              <option [value]="3" [selected]="minRating() === 3">3★ and up</option>
              <option [value]="4" [selected]="minRating() === 4">4★ and up</option>
              <option [value]="4.5" [selected]="minRating() === 4.5">4.5★ and up</option>
            </select>
          </label>
          </section>

          @if (!date()) {
            <p class="hint">
              Pick a date and we will only show vendors who are actually free that day.
            </p>
          }
        </aside>

        <section class="results-col">
        <div class="sortbar">
          <p class="tally">
            @if (results.isLoading()) {
              Searching…
            } @else {
              <strong>{{ results.value().length }}</strong>
              {{ results.value().length === 1 ? 'vendor' : 'vendors' }}
              @if (date()) { free on that date }
            }
          </p>

          <label class="sort">
            <span>Sort by</span>
            <select [value]="sort()" (change)="sort.set($any($event.target).value)">
              <option value="rating" [selected]="sort() === 'rating'">Rating</option>
              <option value="price" [selected]="sort() === 'price'">Price</option>
              <option value="response" [selected]="sort() === 'response'">Response time</option>
            </select>
          </label>
        </div>

        @if (selected().size) {
          <section class="tray" role="status">
            <div>
              <strong>{{ selected().size }} selected</strong>
              <span class="muted"> · up to {{ maxVendors }}</span>
            </div>
            <div class="trayActions">
              @if (selected().size > 1) {
                <button mat-button class="cmp" (click)="comparing.set(!comparing())">
                  {{ comparing() ? 'Hide comparison' : 'Compare ' + selected().size }}
                </button>
              }
              <button mat-flat-button (click)="toDetails()">Continue</button>
            </div>
          </section>
        }

        @if (reviewing(); as vendor) {
          <eh-reviews-panel
            [vendorId]="vendor.id"
            [businessName]="vendor.businessName"
            [completedBookings]="vendor.completedBookings"
            (closed)="reviewing.set(null)"
          />
        }

        @if (comparing() && selected().size > 1) {
          <eh-compare-panel
            [vendors]="chosen()"
            [guestCount]="guestCount()"
            [budget]="budgetPaisa()"
            (closed)="comparing.set(false)"
          />
        }

        <div class="results">
          @for (vendor of results.value(); track vendor.id) {
            <eh-vendor-card
              [vendor]="vendor"
              [guestCount]="guestCount()"
              [budget]="budgetPaisa()"
              [picked]="selected().has(vendor.id)"
              [disabled]="!selected().has(vendor.id) && selected().size >= maxVendors"
              (toggled)="toggle(vendor)"
              (reviewsRequested)="reviewing.set(vendor)"
            />
          } @empty {
            @if (!results.isLoading()) {
              <section class="empty">
                <h2>Nothing free on that date</h2>
                <p>Try another date, a nearby city, or a different category.</p>
              </section>
            }
          }
        </div>
        </section>
        </div>
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
                  <option [value]="fn" [selected]="fn === functionType()">
                    {{ label(fn) }}
                  </option>
                }
              </select>
            </label>

            <!-- A read-back of what was chosen on step one, not a form field. -->
            <div class="wide readback">
              <span class="cap">Your wedding</span>
              <p>
                {{ weddingSummary() }}
                <button mat-button type="button" (click)="step.set('pick')">Change</button>
              </p>
            </div>

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
    /* Tiles beside the rail. align-items:start so an expanded one grows on its
       own rather than stretching every tile in its row to match. */
    .results { display: grid; gap: 1rem; align-items: start;
               grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); }
    /*
     * The wedding side's palette, taken from the reference: a deep magenta
     * utility strip over a brighter pink brand bar, with the same bright pink
     * on the one button that matters. Scoped to this page rather than dropped
     * into the global theme - the matrimony side is maroon and the portals are
     * indigo, and a half-applied rebrand is worse than none.
     */
    :host { display: block; --pink: var(--brand); --pinkHover: var(--brand-deep); }

    /* ----------------------------------------------------------------- hero */

    .hero { position: relative; display: grid; place-items: center;
            min-height: clamp(19rem, 42vw, 27rem); overflow: hidden;
            background: linear-gradient(160deg, var(--brand-deep) 0%, var(--brand-deep) 100%); }
    .heroShot { position: absolute; inset: 0; width: 100%; height: 100%;
                object-fit: cover; }
    /*
     * A magenta duotone rather than a neutral darkening, and deliberately
     * heavy. The hero photograph is whatever the best-rated venue has uploaded,
     * which on a fresh install is seeded placeholder art - left at a light
     * scrim that came through as a brown smear behind white text. Tinted this
     * hard the hero reads as a brand panel with some texture in it whatever the
     * source image is, and a real photograph still shows through as one.
     */
    .hero::after { content: ''; position: absolute; inset: 0;
                   background: linear-gradient(to bottom, rgb(var(--scrim-rgb) / 0.58) 0%,
                                                          rgb(var(--scrim-rgb) / 0.52) 45%,
                                                          rgb(var(--scrim-rgb) / 0.88) 100%); }
    /* border-box, or the 100% width plus the padding overflows the hero and the
       search bar runs flush to both screen edges on a phone. */
    .heroInner { position: relative; z-index: 1; width: 100%; max-width: 62rem;
                 box-sizing: border-box;
                 padding: clamp(2rem, 5vw, 3.5rem) clamp(1rem, 4vw, 2rem);
                 text-align: center; color: #fff; }
    .hero h1 { margin: 0; font-size: clamp(1.9rem, 5.2vw, 3.4rem); font-weight: 800;
               letter-spacing: -0.025em; line-height: 1.08;
               text-shadow: 0 2px 18px rgb(0 0 0 / 0.35); }
    .heroSub { margin: 0.7rem auto 0; max-width: 52ch; font-size: clamp(0.95rem, 1.6vw, 1.12rem);
               line-height: 1.55; opacity: 0.95;
               text-shadow: 0 1px 12px rgb(0 0 0 / 0.35); }

    /* One white bar, three fields and the button flush inside it. */
    .searchbar { display: grid; grid-template-columns: 1.2fr 1fr 1fr auto;
                 align-items: stretch; gap: 0; margin: clamp(1.3rem, 3vw, 2rem) auto 0;
                 max-width: 54rem; background: #fff; border-radius: 10px;
                 overflow: hidden; box-shadow: 0 12px 34px rgb(0 0 0 / 0.28); }
    .field { display: flex; flex-direction: column; justify-content: center;
             gap: 0.1rem; text-align: left; padding: 0.55rem 0.9rem;
             border-right: 1px solid rgb(0 0 0 / 0.1);
             text-transform: none; letter-spacing: normal; }
    .field > span { font-size: 0.66rem; font-weight: 700; letter-spacing: 0.07em;
                    text-transform: uppercase; color: rgb(0 0 0 / 0.45); }
    .field select, .field input { font: inherit; font-size: 0.98rem; border: 0;
                                  padding: 0.15rem 0; background: transparent;
                                  color: rgb(0 0 0 / 0.87); width: 100%; }
    .field select:focus, .field input:focus { outline: none; }
    .getstarted { font: inherit; font-size: 1rem; font-weight: 700; cursor: pointer;
                  border: 0; background: var(--pink); color: #fff;
                  padding: 0 clamp(1.4rem, 3vw, 2.6rem); white-space: nowrap;
                  transition: background 120ms ease; }
    .getstarted:hover { background: var(--pinkHover); }

    .popular { margin: 1.1rem 0 0; font-size: 0.86rem; display: flex; flex-wrap: wrap;
               gap: 0.3rem 0.85rem; justify-content: center; align-items: baseline; }
    .plabel { opacity: 0.8; }
    .popular a { color: #fff; text-decoration: underline;
                 text-underline-offset: 3px; opacity: 0.92; }
    .popular a:hover { opacity: 1; }

    .wrap { max-width: 78rem; margin: 1.75rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1rem; }

    /* Rail and results, the same shell as the browse listing. */
    .layout { display: grid; grid-template-columns: 15rem 1fr; gap: 1.25rem;
              align-items: start; }
    /* Scrolls with the page. Neither sticky nor its own scroll container - both
       hide part of the rail when it is taller than the viewport. */
    .rail { display: flex; flex-direction: column; gap: 0.7rem; }
    .railhead { margin: 0; font-size: 0.72rem; font-weight: 700;
                letter-spacing: 0.09em; text-transform: uppercase;
                color: rgb(0 0 0 / 0.42); }
    .results-col { min-width: 0; display: flex; flex-direction: column; gap: 1rem; }
    .sortbar { display: flex; align-items: center; justify-content: space-between;
               gap: 1rem; flex-wrap: wrap; }
    .tally { margin: 0; font-size: 0.88rem; color: rgb(0 0 0 / 0.6); }
    .tally strong { color: var(--brand-deep); font-size: 1.05rem; }
    .sort { display: flex; flex-direction: row; align-items: center; gap: 0.5rem;
            font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em;
            color: rgb(0 0 0 / 0.55); }
    .sort select { font: inherit; font-size: 0.9rem; padding: 0.4rem 0.5rem;
                   border-radius: 6px; border: 1px solid rgb(0 0 0 / 0.25);
                   text-transform: none; letter-spacing: normal;
                   color: rgb(0 0 0 / 0.87); }
    .head h1 { margin: 0; font-size: 1.6rem; font-weight: 600; }
    .sub { margin: 0.25rem 0 0; color: rgb(0 0 0 / 0.6); font-size: 0.9rem; }
    .steps { list-style: none; display: flex; gap: 1rem; flex-wrap: wrap;
             margin: 0.9rem 0 0; padding: 0; font-size: 0.8rem;
             color: rgb(0 0 0 / 0.45); }
    .steps li.on { color: var(--brand); font-weight: 600; }
    .steps li.done { color: #1b5e20; }
    .filters { display: flex; flex-direction: column; gap: 0.75rem;
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

    /* The rail becomes a block above the results: on a phone the filters are
       still the only way through a long list. */
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; }
      .rail { max-height: none; overflow: visible; }
      .filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); }
    }

    /* The search bar stacks before it squeezes: three fields and a button side
       by side stop being readable well before the page does. */
    @media (max-width: 760px) {
      .searchbar { grid-template-columns: 1fr; }
      .field { border-right: 0; border-bottom: 1px solid rgb(0 0 0 / 0.1); }
      .getstarted { padding: 0.85rem 1rem; }
    }
    .tray { position: sticky; top: 0.5rem; z-index: 5;
            display: flex; align-items: center; justify-content: space-between;
            gap: 1rem; background: var(--brand); color: #fff;
            padding: 0.7rem 1rem; border-radius: 10px; }
    .muted { opacity: 0.7; }
    .cover { width: calc(100% + 2.5rem); margin: -1.1rem -1.25rem 0;
             aspect-ratio: 16 / 7; object-fit: cover; display: block;
             background: rgb(0 0 0 / 0.05); border-radius: 10px 10px 0 0; }
    .card { border: 1px solid rgb(0 0 0 / 0.12); border-radius: 10px; background: #fff;
            padding: 1.1rem 1.25rem; display: flex; flex-direction: column; gap: 0.6rem; }
    .card.picked { border-color: var(--brand); box-shadow: 0 0 0 1px var(--brand) inset; }
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
    .readback .cap { font-size: 0.72rem; text-transform: uppercase;
                     letter-spacing: 0.05em; color: rgb(0 0 0 / 0.55); }
    .readback p { margin: 0.25rem 0 0; font-size: 0.92rem; }
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
  protected readonly sort = signal<'rating' | 'price' | 'response'>('rating');
  protected readonly minRating = signal(0);
  protected readonly comparing = signal(false);
  /** The vendor whose reviews are open, if any. */
  protected readonly reviewing = signal<VendorSearchResult | null>(null);

  /** The picked vendors, in the order they were picked. */
  protected readonly chosen = computed(() => [...this.selected().values()]);

  /** What step one settled, read back on step two. */
  protected readonly weddingSummary = computed(() => {
    const budget = this.budgetPaisa();
    const money = budget ? `, budget ${this.inr(budget)}` : '';
    return `${this.guestCount()} guests in ${this.city()}${money}.`;
  });

  /** Budget in paisa, which is what the estimate helpers work in. */
  protected readonly budgetPaisa = computed(() => {
    const rupees = this.budgetRupees();
    return rupees ? toPaisa(rupees) : null;
  });

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
        sort: this.sort(),
        minRating: this.minRating() || undefined,
      }),
    { parse: unwrapGuest<VendorSearchResult[]>, defaultValue: [] },
  );

  protected readonly chosenNames = computed(() =>
    [...this.selected().values()].map((v) => v.businessName).join(', '),
  );

  protected readonly popular = POPULAR;

  protected slug(category: VendorCategory): string {
    return categorySlug(category);
  }

  protected meta(category: VendorCategory) {
    return CATEGORY_META[category];
  }

  /**
   * The hero's Get started button.
   *
   * The filters are live, so the results below have already changed by the time
   * it is pressed - there is nothing to submit. What a visitor actually wants
   * from it is to be taken to what they just asked for, which on a tall hero is
   * off the bottom of the screen.
   */
  protected toResults(): void {
    document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * The hero backdrop: the wedding photograph shipped with the app.
   *
   * It used to be the first result that had a photo, which tied the top of the
   * page to whatever the filters happened to return - and on seeded data that
   * was a flat colour block. See public/hero/README.md for how to swap it.
   */
  protected readonly banner = signal(HERO_IMAGE);

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

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';

import { HomeHero } from '../components/home-hero';
import { ServiceGlyph, type GlyphName } from '../components/service-glyph';

/** The nine categories a wedding actually gets booked from. */
const SERVICES: { name: GlyphName; label: string; blurb: string }[] = [
  { name: 'VENUE', label: 'Venues', blurb: 'Halls, lawns and banquet spaces' },
  { name: 'CATERING', label: 'Catering', blurb: 'Veg, non-veg and live counters' },
  { name: 'PHOTOGRAPHY', label: 'Photography', blurb: 'Candid, traditional and film' },
  { name: 'DECOR', label: 'Decor', blurb: 'Mandap, stage and floral' },
  { name: 'MAKEUP', label: 'Makeup', blurb: 'Bridal and family packages' },
  { name: 'MUSIC', label: 'Music', blurb: 'Baraat bands and DJs' },
  { name: 'PANDIT', label: 'Pandits', blurb: 'Rituals in your own tradition' },
  { name: 'TRANSPORT', label: 'Transport', blurb: 'Guest coaches and baraat cars' },
  { name: 'INVITATION', label: 'Invitations', blurb: 'Printed and digital cards' },
];

/**
 * The front door.
 *
 * Until now `/` redirected straight to a login form, which asks a visitor to
 * commit before they have seen anything. This page earns the signup instead:
 * the partner search a matrimony visitor came for, and - because this platform
 * is two products - a way through to the wedding side for someone already
 * engaged who only wants quotes.
 *
 * The hero is its own component; everything here is the explanation for people
 * the search box did not immediately convince.
 */
@Component({
  selector: 'eh-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, HomeHero, ServiceGlyph],
  template: `
    <eh-home-hero />

    <section class="services">
      <header>
        <h2>Everything the wedding needs</h2>
        <p>
          Ask up to five vendors in one go and compare what they quote, side by
          side. No account needed to start.
        </p>
      </header>

      <div class="grid">
        @for (service of services; track service.name) {
          <a class="tile" routerLink="/enquire" [queryParams]="{ category: service.name }">
            <span class="glyph"><eh-service-glyph [name]="service.name" /></span>
            <strong>{{ service.label }}</strong>
            <span class="blurb">{{ service.blurb }}</span>
          </a>
        }
      </div>

      <a mat-flat-button class="wide" routerLink="/enquire">
        Get quotes without an account
      </a>
    </section>

    <section class="paths">
      <article>
        <span class="big"><eh-service-glyph name="BRIDE" /></span>
        <h3>Still looking</h3>
        <p>
          Search by community, mother tongue and horoscope. Contact details open
          only when both families have shown interest.
        </p>
        <a mat-stroked-button routerLink="/auth/register">Create a profile</a>
      </article>

      <article>
        <span class="big"><eh-service-glyph name="VENUE" /></span>
        <h3>Already engaged</h3>
        <p>
          Skip the matchmaking. Tell us the date and the city, and vendors who
          are actually free that day come back with prices.
        </p>
        <a mat-stroked-button routerLink="/enquire">Ask for quotes</a>
      </article>
    </section>

    <footer class="foot">
      <p>Matrimony EventHub · Hyderabad</p>
      <nav>
        <a routerLink="/enquire">Get quotes</a>
        <a routerLink="/auth/login">Sign in</a>
        <a routerLink="/auth/register">Register</a>
      </nav>
    </footer>
  `,
  styles: `
    :host { display: block; background: #f7f7fb; --ink: #2f2d78; }
    section { max-width: 68rem; margin: 0 auto; }

    .services { padding: clamp(2.5rem, 6vw, 4rem) clamp(1rem, 4vw, 2rem); }
    .services header { text-align: center; margin-bottom: 1.8rem; }
    h2 { margin: 0; font-size: clamp(1.4rem, 3vw, 1.9rem); color: var(--ink);
         letter-spacing: -0.015em; }
    .services header p { margin: 0.6rem auto 0; max-width: 46ch; line-height: 1.6;
                         color: rgb(0 0 0 / 0.62); font-size: 0.95rem; }

    .grid { display: grid; gap: 0.9rem;
            grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); }
    .tile { display: flex; flex-direction: column; align-items: flex-start; gap: 0.3rem;
            padding: 1.1rem 1.15rem; border-radius: 12px; background: #fff;
            border: 1px solid rgb(0 0 0 / 0.09); text-decoration: none;
            color: rgb(0 0 0 / 0.87);
            transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease; }
    .tile:hover, .tile:focus-visible { transform: translateY(-2px); border-color: var(--ink);
            box-shadow: 0 10px 24px rgb(47 45 120 / 0.14); }
    .glyph { width: 2.4rem; height: 2.4rem; color: var(--ink); margin-bottom: 0.2rem; }
    .blurb { font-size: 0.82rem; color: rgb(0 0 0 / 0.55); line-height: 1.45; }
    .wide { display: block; width: fit-content; margin: 1.8rem auto 0;
            background: #e8b341 !important; color: #2a2410 !important; font-weight: 700; }

    .paths { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2rem;
             padding: 0 clamp(1rem, 4vw, 2rem) clamp(3rem, 7vw, 4.5rem); }
    .paths article { background: #fff; border: 1px solid rgb(0 0 0 / 0.09);
                     border-radius: 14px; padding: 1.6rem 1.7rem; display: flex;
                     flex-direction: column; align-items: flex-start; gap: 0.6rem; }
    .big { width: 3rem; height: 3rem; color: var(--ink); }
    h3 { margin: 0; font-size: 1.15rem; color: var(--ink); }
    .paths p { margin: 0; line-height: 1.6; color: rgb(0 0 0 / 0.66); font-size: 0.92rem; }
    .paths a { margin-top: 0.5rem; }

    .foot { border-top: 1px solid rgb(0 0 0 / 0.09); display: flex; flex-wrap: wrap;
            gap: 1rem; justify-content: space-between; align-items: center;
            font-size: 0.85rem; color: rgb(0 0 0 / 0.55);
            padding: 1.5rem clamp(1rem, 4vw, 3rem); }
    .foot nav { display: flex; gap: 1.2rem; }
    .foot a { color: var(--ink); text-decoration: none; }
    .foot a:hover { text-decoration: underline; }

    @media (max-width: 880px) { .paths { grid-template-columns: 1fr; } }
  `,
})
export class HomePage {
  protected readonly services = SERVICES;
}

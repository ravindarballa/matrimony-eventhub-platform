import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Every glyph this component can draw, including the two portraits. */
export type GlyphName =
  | 'VENUE'
  | 'CATERING'
  | 'PHOTOGRAPHY'
  | 'DECOR'
  | 'MAKEUP'
  | 'MUSIC'
  | 'PANDIT'
  | 'TRANSPORT'
  | 'INVITATION'
  | 'BRIDE'
  | 'GROOM';

/**
 * Line drawings for the platform's services, plus a bride and a groom.
 *
 * Drawn rather than photographed on purpose. The landing page needs imagery
 * covering nine vendor categories and both sides of a match, and the honest
 * options were stock photography the project has no licence for, or generated
 * placeholders that look like a failed image load. A consistent set of line
 * drawings reads as a deliberate house style at any opacity, and costs the page
 * nothing to download.
 *
 * They are single-colour and inherit `currentColor`, so the same glyph works as
 * a faint mark in the background wash and as a solid icon in the service strip.
 */
@Component({
  selector: 'eh-service-glyph',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.viewBox]="'0 0 64 64'"
      [attr.aria-hidden]="true"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      @switch (name()) {
        <!--
          A mandap. The canopy is domed rather than flat: a trapezoid lid over
          two uprights reads as an envelope or an inbox tray at icon size, which
          is exactly what the first version did.
        -->
        @case ('VENUE') {
          <path d="M8 30c0-11 11-18 24-18s24 7 24 18" />
          <path d="M6 30h52" />
          <path d="M14 30v22M50 30v22" />
          <path d="M10 52h8M46 52h8" />
          <path d="M8 56h48" />
          <path d="M20 34c4 6 8 9 12 9s8-3 12-9" />
          <path d="M32 12V6" />
          <circle cx="32" cy="4" r="2.2" />
        }
        <!--
          A served plate with steam. The first version was a thali seen flat -
          a ring with three katoris inside - and three circles arranged in a
          circle is a face long before it is lunch.
        -->
        @case ('CATERING') {
          <path d="M8 42h48a24 24 0 0 1-48 0z" />
          <path d="M4 42h56" />
          <path d="M14 42c0-10 8-16 18-16s18 6 18 16" />
          <path d="M24 18c0-3 3-4 3-7s-3-3-3-6" />
          <path d="M32 16c0-3 3-4 3-7s-3-3-3-6" />
          <path d="M40 18c0-3 3-4 3-7s-3-3-3-6" />
        }
        <!-- A camera. -->
        @case ('PHOTOGRAPHY') {
          <rect x="8" y="20" width="48" height="30" rx="4" />
          <path d="M24 20l4-6h8l4 6" />
          <circle cx="32" cy="35" r="9" />
          <circle cx="32" cy="35" r="4" />
          <circle cx="47" cy="27" r="1.4" fill="currentColor" stroke="none" />
        }
        <!-- A marigold garland, the decor everyone recognises. -->
        @case ('DECOR') {
          <path d="M8 16c8 14 16 22 24 22s16-8 24-22" />
          <circle cx="12" cy="22" r="3" />
          <circle cx="20" cy="30" r="3" />
          <circle cx="30" cy="36" r="3" />
          <circle cx="40" cy="34" r="3" />
          <circle cx="49" cy="26" r="3" />
          <path d="M32 40v12M28 52h8" />
        }
        <!-- A hand mirror and brush. -->
        @case ('MAKEUP') {
          <circle cx="26" cy="24" r="13" />
          <circle cx="26" cy="24" r="8" />
          <path d="M26 37v15M21 52h10" />
          <path d="M46 14l6 6-16 16-6-6z" />
          <path d="M36 30l-4 10 10-4" />
        }
        <!-- A dhol. -->
        @case ('MUSIC') {
          <rect x="14" y="22" width="36" height="22" rx="8" />
          <path d="M14 28h36M14 38h36" />
          <path d="M20 22l-6-8M44 22l6-8" />
          <path d="M24 44v6M40 44v6" />
        }
        <!-- A kalash with a coconut and mango leaves. -->
        @case ('PANDIT') {
          <path d="M22 30h20l-3 22H25z" />
          <path d="M20 30c0-4 5-6 12-6s12 2 12 6" />
          <path d="M26 24c2-5 4-7 6-7s4 2 6 7" />
          <circle cx="32" cy="14" r="4" />
          <path d="M22 52h20" />
        }
        <!-- A decorated car. -->
        @case ('TRANSPORT') {
          <path d="M10 42v-8l6-12h32l6 12v8" />
          <path d="M6 42h52" />
          <circle cx="20" cy="46" r="5" />
          <circle cx="44" cy="46" r="5" />
          <path d="M16 22h32" />
          <path d="M24 14c4 4 12 4 16 0" />
        }
        <!-- An invitation card with a seal. -->
        @case ('INVITATION') {
          <rect x="10" y="16" width="44" height="32" rx="3" />
          <path d="M10 20l22 14 22-14" />
          <circle cx="46" cy="42" r="6" />
          <path d="M44 42l1.6 1.8 3.2-3.4" />
        }
        <!--
          A bride, and below her a groom.
          
          Both dropped their eyes and mouths after seeing them rendered: at
          three rem a face drawn in 1.6px strokes turns to mush, and the
          jewellery and headdress carry the identity far better than features
          do. They read as portraits the way an avatar does, by silhouette.
        -->
        @case ('BRIDE') {
          <circle cx="32" cy="30" r="10" />
          <path d="M12 40c0-14 9-24 20-24s20 10 20 24" />
          <path d="M12 40c3 2 6 3 9 3M52 40c-3 2-6 3-9 3" />
          <path d="M22 22c4-4 16-4 20 0" />
          <circle cx="32" cy="18" r="2" fill="currentColor" stroke="none" />
          <path d="M32 20v3" />
          <circle cx="21" cy="33" r="2.4" />
          <circle cx="43" cy="33" r="2.4" />
          <path d="M24 42c3 3 13 3 16 0" />
          <path d="M16 58c1.5-8 7.5-13 16-13s14.5 5 16 13" />
        }
        @case ('GROOM') {
          <circle cx="32" cy="33" r="10" />
          <path d="M16 24c2-8 8-13 16-13s14 5 16 13z" />
          <path d="M15 24h34" />
          <path d="M20 20c6-4 18-4 24 0" />
          <path d="M32 11V6" />
          <path d="M32 6c2-2 4-2 5-4" />
          <path d="M26 38c3-1.5 9-1.5 12 0" />
          <path d="M16 58c1.5-8 7.5-13 16-13s14.5 5 16 13" />
          <path d="M26 46l6 7 6-7" />
        }
      }
    </svg>
  `,
  styles: `
    :host { display: inline-block; line-height: 0; }
    svg { width: 100%; height: 100%; display: block; }
  `,
})
export class ServiceGlyph {
  readonly name = input.required<GlyphName>();
}

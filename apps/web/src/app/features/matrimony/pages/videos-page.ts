import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';

/** One film on the showcase. Ids are the YouTube watch id, nothing more. */
interface Film {
  readonly id: string;
  readonly title: string;
  readonly vendor: string;
  readonly category: 'Decoration' | 'Catering' | 'Photography' | 'Venue' | 'Music';
}

/**
 * The showcase reel.
 *
 * Replace these with the ids from the channel. A YouTube id is the part after
 * `watch?v=` - for https://www.youtube.com/watch?v=dQw4w9WgXcQ that is
 * `dQw4w9WgXcQ`. Nothing else from the URL is needed or should be pasted here.
 *
 * Hard-coded on purpose, for now. A table of five videos that changes monthly
 * does not need a CMS, an admin screen and a migration; it needs somebody to
 * edit a list. When it outgrows that - when vendors upload their own - it
 * becomes a collection with the vendor id on each row, and this array is the
 * shape that collection should have.
 */
const FILMS: readonly Film[] = [
  { id: 'ScMzIvxBSi4', title: 'Mandap and stage decoration', vendor: 'Sample vendor', category: 'Decoration' },
  { id: 'aqz-KE-bpKQ', title: 'Wedding catering, start to finish', vendor: 'Sample vendor', category: 'Catering' },
  { id: 'ScMzIvxBSi4', title: 'A full day, filmed', vendor: 'Sample vendor', category: 'Photography' },
];

/**
 * Vendor work, on film.
 *
 * Every player is a facade until it is clicked: a still, a play button, and no
 * YouTube code on the page at all. Three real embeds pull well over a megabyte
 * of script and set cookies before anybody has pressed play, which is slow and
 * is the sort of thing that has to be disclosed. The iframe is created on the
 * click that asks for it.
 *
 * The embeds are youtube-nocookie.com, and they autoplay on that first click
 * because the click was the request to watch.
 */
@Component({
  selector: 'eh-matrimony-videos-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="wrap">
      <header class="head">
        <h1>See the work</h1>
        <p class="sub">
          Decoration, catering and photography by vendors on this platform -
          filmed at real weddings, not stock footage.
        </p>
      </header>

      <div class="filters" role="group" aria-label="Filter by trade">
        <button
          type="button"
          [class.on]="active() === null"
          (click)="active.set(null)"
        >All</button>
        @for (c of categories; track c) {
          <button type="button" [class.on]="active() === c" (click)="active.set(c)">
            {{ c }}
          </button>
        }
      </div>

      <section class="grid">
        @for (film of shown(); track film.id + film.title) {
          <article class="film">
            <div class="frame">
              @if (playing() === film.id + film.title) {
                <iframe
                  [src]="embed(film.id)"
                  [title]="film.title"
                  frameborder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerpolicy="strict-origin-when-cross-origin"
                  allowfullscreen
                ></iframe>
              } @else {
                <!--
                  A button rather than a div: it is the control that starts the
                  video, so it has to be reachable and announced as one.
                -->
                <button
                  type="button"
                  class="facade"
                  [attr.aria-label]="'Play ' + film.title"
                  (click)="play(film)"
                >
                  <img [src]="thumb(film.id)" alt="" loading="lazy" />
                  <span class="play" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                  </span>
                </button>
              }
            </div>

            <h2>{{ film.title }}</h2>
            <p class="by">{{ film.vendor }} · {{ film.category }}</p>
          </article>
        }
      </section>

      @if (!shown().length) {
        <p class="empty">Nothing filmed in this trade yet.</p>
      }
    </main>
  `,
  styles: `
    .wrap { max-width: 68rem; margin: 0 auto; padding: 1.5rem clamp(1rem, 4vw, 2.5rem) 3rem;
            display: flex; flex-direction: column; gap: 1.1rem; }
    h1 { margin: 0; font-size: 1.6rem; font-weight: 600; }
    .sub { margin: 0.3rem 0 0; color: rgb(0 0 0 / 0.62); font-size: 0.94rem;
           max-width: 46rem; }

    .filters { display: flex; gap: 0.45rem; flex-wrap: wrap; }
    .filters button { padding: 0.34rem 0.85rem; border-radius: 999px;
                      border: 1px solid var(--brand-line); background: #fff;
                      color: inherit; font: inherit; font-size: 0.85rem;
                      cursor: pointer; }
    .filters button.on { background: var(--brand); border-color: var(--brand);
                         color: #fff; font-weight: 600; }

    .grid { display: grid; gap: 1.4rem 1.1rem;
            grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr)); }

    /* 16:9 held by the box, so the grid does not reflow when a facade is
       swapped for the iframe on click. */
    .frame { position: relative; aspect-ratio: 16 / 9; max-width: 100%;
             border-radius: 0.7rem; overflow: hidden; background: #000; }
    .frame iframe, .facade { position: absolute; inset: 0; width: 100%;
                             height: 100%; border: 0; }

    .facade { padding: 0; cursor: pointer; background: #000; display: block; }
    .facade img { width: 100%; height: 100%; object-fit: cover; display: block;
                  opacity: 0.88; transition: opacity 140ms ease; }
    .facade:hover img { opacity: 1; }
    .facade:focus-visible { outline: 3px solid var(--brand); outline-offset: -3px; }

    .play { position: absolute; inset: 0; margin: auto; width: 3.4rem;
            height: 3.4rem; display: grid; place-items: center;
            border-radius: 999px; background: rgb(0 0 0 / 0.62);
            border: 2px solid rgb(255 255 255 / 0.9); }
    .play svg { width: 1.6rem; height: 1.6rem; fill: #fff; }
    .facade:hover .play { background: var(--brand); }

    h2 { margin: 0.6rem 0 0; font-size: 1rem; font-weight: 600; }
    .by { margin: 0.15rem 0 0; font-size: 0.84rem; color: rgb(0 0 0 / 0.6); }
    .empty { color: rgb(0 0 0 / 0.6); }

    @media (prefers-reduced-motion: reduce) {
      .facade img { transition: none; }
    }
  `,
})
export class MatrimonyVideosPage {
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly categories = [
    'Decoration',
    'Catering',
    'Photography',
    'Venue',
    'Music',
  ] as const;

  protected readonly active = signal<string | null>(null);
  protected readonly playing = signal<string | null>(null);

  protected readonly shown = computed(() => {
    const c = this.active();
    return c ? FILMS.filter((f) => f.category === c) : FILMS;
  });

  protected play(film: Film): void {
    this.playing.set(film.id + film.title);
  }

  /** YouTube's own still, at the size the tile actually needs. */
  protected thumb(id: string): string {
    return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  }

  /**
   * The embed URL, trusted explicitly.
   *
   * Angular blocks an iframe src bound from a variable unless it is told the
   * value is safe, and it is right to: the sanitiser cannot tell a YouTube id
   * from an attacker's URL. These ids come from the constant above rather than
   * from a user or the network, which is the reason this is safe to assert -
   * if they ever come from the database, the id has to be pattern-checked
   * before it reaches here.
   */
  protected embed(id: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1`,
    );
  }
}

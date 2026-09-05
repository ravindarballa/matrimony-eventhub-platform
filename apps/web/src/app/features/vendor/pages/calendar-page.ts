import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpClient, httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import type { VendorCalendarDay } from '@eventhub/contracts';

import { unwrap } from '../data/vendor-api';
import type { AppError } from '../../../core/models/app-error';

interface Cell {
  date: string;
  day: number;
  status: 'FREE' | 'HELD' | 'BOOKED' | 'BLOCKED';
  reason?: string | null;
  past: boolean;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * The vendor's month calendar.
 *
 * Held and booked days are shown but cannot be clicked: a customer's date is
 * not the vendor's to take back by editing a calendar, and the server refuses
 * it anyway. Only a free day can be blocked, and only a blocked day unblocked -
 * which is exactly the set of edits that cannot break somebody else's wedding.
 */
@Component({
  selector: 'eh-vendor-calendar-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatProgressBarModule],
  template: `
    <main class="wrap">
      <header class="head">
        <div>
          <h1>Calendar</h1>
          <p class="sub">
            Block the days you are unavailable. Booked dates are set by real
            bookings and cannot be edited here.
          </p>
        </div>
      </header>

      <section class="monthbar">
        <button mat-stroked-button (click)="shift(-1)">‹ Previous</button>
        <strong>{{ monthName() }} {{ year() }}</strong>
        <button mat-stroked-button (click)="shift(1)">Next ›</button>
      </section>

      @if (calendar.isLoading()) { <mat-progress-bar mode="indeterminate" /> }
      @if (message(); as m) { <p class="notice" role="status">{{ m }}</p> }

      <section class="grid" role="grid" aria-label="Month">
        @for (label of weekdays; track label) {
          <span class="weekday">{{ label }}</span>
        }
        @for (blank of leading(); track $index) {
          <span class="cell empty"></span>
        }
        @for (cell of cells(); track cell.date) {
          <button
            type="button"
            class="cell"
            [class]="cell.status.toLowerCase()"
            [disabled]="busy() || cell.past || cell.status === 'HELD' || cell.status === 'BOOKED'"
            [title]="tooltip(cell)"
            (click)="toggle(cell)"
          >
            <span class="num">{{ cell.day }}</span>
            @if (cell.status !== 'FREE') {
              <span class="tag">{{ short(cell.status) }}</span>
            }
          </button>
        }
      </section>

      <ul class="legend">
        <li><span class="swatch free"></span> Available</li>
        <li><span class="swatch blocked"></span> Blocked by you</li>
        <li><span class="swatch held"></span> Held, awaiting advance</li>
        <li><span class="swatch booked"></span> Booked</li>
      </ul>
    </main>
  `,
  styles: `
    .wrap { max-width: 44rem; margin: 2rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1rem; }
    h1 { margin: 0; font-size: 1.6rem; font-weight: 600; }
    .sub { margin: 0.25rem 0 0; color: rgb(0 0 0 / 0.6); font-size: 0.9rem; }
    .monthbar { display: flex; align-items: center; justify-content: space-between;
                gap: 1rem; background: #fff; border: 1px solid rgb(0 0 0 / 0.12);
                border-radius: 10px; padding: 0.6rem 0.9rem; }
    .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.35rem;
            background: #fff; border: 1px solid rgb(0 0 0 / 0.12);
            border-radius: 10px; padding: 0.9rem; }
    .weekday { text-align: center; font-size: 0.68rem; font-weight: 700;
               text-transform: uppercase; letter-spacing: 0.05em;
               color: rgb(0 0 0 / 0.45); padding-bottom: 0.2rem; }
    .cell { aspect-ratio: 1; border-radius: 8px; border: 1px solid rgb(0 0 0 / 0.1);
            background: #fafafa; cursor: pointer; font: inherit;
            display: flex; flex-direction: column; align-items: center;
            justify-content: center; gap: 0.1rem; padding: 0; }
    .cell.empty { border: none; background: none; cursor: default; }
    .cell:disabled { cursor: not-allowed; }
    .cell .num { font-size: 0.85rem; font-variant-numeric: tabular-nums; }
    .cell .tag { font-size: 0.55rem; font-weight: 700; text-transform: uppercase;
                 letter-spacing: 0.04em; }
    .cell.free:hover:not(:disabled) { border-color: #2f2d78; background: #f2f1fb; }
    .cell.blocked { background: #eceff1; color: #37474f; border-color: #cfd8dc; }
    .cell.held { background: #fbf1dc; color: #8a5a00; border-color: #f2dcae; }
    .cell.booked { background: #e6f4ea; color: #1b5e20; border-color: #c8e6c9; }
    .cell:disabled.free { opacity: 0.4; }
    .legend { list-style: none; display: flex; flex-wrap: wrap; gap: 1rem;
              margin: 0; padding: 0; font-size: 0.8rem; color: rgb(0 0 0 / 0.6); }
    .legend li { display: flex; align-items: center; gap: 0.4rem; }
    .swatch { width: 0.85rem; height: 0.85rem; border-radius: 4px;
              border: 1px solid rgb(0 0 0 / 0.15); display: inline-block; }
    .swatch.free { background: #fafafa; }
    .swatch.blocked { background: #eceff1; }
    .swatch.held { background: #fbf1dc; }
    .swatch.booked { background: #e6f4ea; }
    .notice { margin: 0; font-size: 0.88rem; color: #0d47a1; background: #e3f2fd;
              border-left: 3px solid #0d47a1; padding: 0.6rem 0.8rem;
              border-radius: 0 6px 6px 0; }
  `,
})
export class VendorCalendarPage {
  private readonly http = inject(HttpClient);

  protected readonly weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  private readonly cursor = signal(new Date());
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);

  protected readonly year = computed(() => this.cursor().getUTCFullYear());
  protected readonly monthIndex = computed(() => this.cursor().getUTCMonth());
  protected readonly monthName = computed(() => MONTHS[this.monthIndex()]!);

  /** Keyed on the month, so paging is the whole of "refetch". */
  protected readonly calendar = httpResource<VendorCalendarDay[]>(
    () => {
      const from = this.iso(new Date(Date.UTC(this.year(), this.monthIndex(), 1)));
      const to = this.iso(
        new Date(Date.UTC(this.year(), this.monthIndex() + 1, 0)),
      );
      return `/api/v1/vendors/me/calendar?from=${from}&to=${to}`;
    },
    { parse: unwrap<VendorCalendarDay[]>, defaultValue: [] },
  );

  /** Monday-first, which is how an Indian wedding calendar is read. */
  protected readonly leading = computed(() => {
    const first = new Date(Date.UTC(this.year(), this.monthIndex(), 1)).getUTCDay();
    return Array.from({ length: (first + 6) % 7 });
  });

  protected readonly cells = computed<Cell[]>(() => {
    const days = new Date(Date.UTC(this.year(), this.monthIndex() + 1, 0)).getUTCDate();
    const byDate = new Map<string, VendorCalendarDay>(
      this.calendar.value().map((d) => [d.date.slice(0, 10), d] as const),
    );
    const todayIso = this.iso(new Date());

    return Array.from({ length: days }, (_, i) => {
      const date = this.iso(new Date(Date.UTC(this.year(), this.monthIndex(), i + 1)));
      const entry = byDate.get(date);
      return {
        date,
        day: i + 1,
        status: (entry?.status ?? 'FREE') as Cell['status'],
        reason: entry?.reason ?? null,
        past: date < todayIso,
      };
    });
  });

  protected shift(months: number): void {
    this.cursor.update(
      (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1)),
    );
  }

  protected async toggle(cell: Cell): Promise<void> {
    this.busy.set(true);
    this.message.set(null);
    try {
      if (cell.status === 'BLOCKED') {
        await firstValueFrom(
          this.http.delete(`/api/v1/vendors/me/calendar/block/${cell.date}`),
        );
        this.message.set(`${cell.date} is available again.`);
      } else {
        await firstValueFrom(
          this.http.post('/api/v1/vendors/me/calendar/block', {
            dates: [cell.date],
            reason: 'Unavailable',
          }),
        );
        this.message.set(`${cell.date} is now blocked.`);
      }
      this.calendar.reload();
    } catch (e) {
      const err = e as AppError;
      this.message.set(
        err.code === 'VND_DATE_HAS_BOOKING'
          ? 'That date carries a booking. Cancel the booking first if it really is unavailable.'
          : err.message,
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected tooltip(cell: Cell): string {
    if (cell.past) return 'In the past';
    return {
      FREE: 'Available — click to block',
      BLOCKED: cell.reason ? `Blocked: ${cell.reason}` : 'Blocked — click to free',
      HELD: 'Held for a booking awaiting its advance',
      BOOKED: 'Booked',
    }[cell.status];
  }

  protected short(status: Cell['status']): string {
    return { FREE: '', BLOCKED: 'Off', HELD: 'Held', BOOKED: 'Booked' }[status];
  }

  private iso(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}

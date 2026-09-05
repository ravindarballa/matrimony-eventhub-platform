import { ChangeDetectionStrategy, Component } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { formatInr, type PlatformMetricsDto } from '@eventhub/contracts';

interface Envelope<T> {
  data: T;
}

/**
 * The numbers that say whether the platform is working.
 *
 * Money is shown from the ledger rather than from the bookings collection: the
 * ledger is what reconciles against the gateway, and a dashboard that disagrees
 * with the books is worse than no dashboard.
 */
@Component({
  selector: 'eh-admin-dashboard-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatProgressBarModule],
  template: `
    <main class="wrap">
      <h1>Platform</h1>

      @if (metrics.isLoading()) { <mat-progress-bar mode="indeterminate" /> }

      @if (metrics.value(); as m) {
        <section class="grid">
          <article class="tile wide">
            <h2>Money</h2>
            <dl>
              <div>
                <dt>Confirmed GMV</dt>
                <dd class="big">{{ inr(m.money.gmv) }}</dd>
              </div>
              <div>
                <dt>Held in escrow</dt>
                <dd>{{ inr(m.money.inEscrow) }}</dd>
              </div>
              <div>
                <dt>Commission earned</dt>
                <dd>{{ inr(m.money.commissionEarned) }}</dd>
              </div>
              <div>
                <dt>Refunded</dt>
                <dd>{{ inr(m.money.refunded) }}</dd>
              </div>
            </dl>
          </article>

          <article class="tile">
            <h2>Vendors</h2>
            <p class="big">{{ m.vendors.verified }}<span class="of">/{{ m.vendors.total }}</span></p>
            <p class="sub">verified</p>
            @if (m.vendors.awaitingKyc > 0) {
              <a class="action" routerLink="/admin/kyc">
                {{ m.vendors.awaitingKyc }} waiting on review →
              </a>
            }
          </article>

          <article class="tile">
            <h2>Bookings</h2>
            <p class="big">{{ m.bookings.confirmed }}</p>
            <p class="sub">confirmed of {{ m.bookings.total }}</p>
            @if (m.bookings.cancelled > 0) {
              <p class="sub muted">{{ m.bookings.cancelled }} cancelled</p>
            }
          </article>

          <article class="tile">
            <h2>Matrimony</h2>
            <p class="big">{{ m.matrimony.active }}</p>
            <p class="sub">active profiles of {{ m.matrimony.profiles }}</p>
            <p class="sub muted">{{ m.matrimony.interestsSent }} interests sent</p>
          </article>

          <article class="tile">
            <h2>People</h2>
            <p class="big">{{ m.users.total }}</p>
            <p class="sub">
              {{ m.users.customers }} customers · {{ m.users.vendors }} vendors ·
              {{ m.users.seekers }} seekers
            </p>
          </article>
        </section>
      }

      @if (metrics.error()) {
        <p class="err" role="alert">These figures could not be loaded.</p>
      }
    </main>
  `,
  styles: `
    .wrap { max-width: 56rem; margin: 2rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1rem; }
    h1 { margin: 0; font-size: 1.6rem; font-weight: 600; }
    .grid { display: grid; gap: 1rem;
            grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); }
    .tile { background: #fff; border: 1px solid rgb(0 0 0 / 0.12); border-radius: 10px;
            padding: 1.1rem 1.25rem; display: flex; flex-direction: column; gap: 0.35rem; }
    .tile.wide { grid-column: 1 / -1; }
    h2 { margin: 0 0 0.3rem; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em;
         text-transform: uppercase; color: rgb(0 0 0 / 0.55); }
    .big { margin: 0; font-size: 1.9rem; font-weight: 700;
           font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
    .of { font-size: 1rem; color: rgb(0 0 0 / 0.4); font-weight: 500; }
    .sub { margin: 0; font-size: 0.82rem; color: rgb(0 0 0 / 0.6); }
    .muted { color: rgb(0 0 0 / 0.45); }
    .action { margin-top: auto; padding-top: 0.5rem; font-size: 0.82rem;
              color: #2f2d78; text-decoration: none; font-weight: 600; }
    .action:hover { text-decoration: underline; }
    dl { display: grid; gap: 1rem; margin: 0;
         grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); }
    dl div { display: flex; flex-direction: column; gap: 0.15rem; }
    dt { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em;
         color: rgb(0 0 0 / 0.5); }
    dd { margin: 0; font-size: 1.05rem; font-weight: 600;
         font-variant-numeric: tabular-nums; }
    dd.big { font-size: 1.9rem; }
    .err { color: #b3261e; font-size: 0.9rem; }
  `,
})
export class AdminDashboardPage {
  protected readonly metrics = httpResource<PlatformMetricsDto>(
    () => '/api/v1/admin/metrics',
    { parse: (raw) => (raw as Envelope<PlatformMetricsDto>).data },
  );

  protected readonly inr = (paisa: number): string => formatInr(paisa as never);
}

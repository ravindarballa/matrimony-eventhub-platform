import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpClient, httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import {
  formatInr,
  type EntitlementsDto,
  type Plan,
  type SubscriptionIntentDto,
} from '@eventhub/contracts';

import type { AppError } from '../../../core/models/app-error';

interface Envelope<T> {
  data: T;
}

type Phase = 'browsing' | 'opening' | 'ready' | 'paying' | 'done' | 'failed';

/**
 * Plans, and the checkout for one.
 *
 * The page leads with what is free rather than hiding it, because the honest
 * pitch here is narrow: browsing, searching and receiving interests cost
 * nothing, and a plan buys the ability to act. A paywall that pretends to gate
 * more than it does gets found out on the first click.
 */
@Component({
  selector: 'eh-plans-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatProgressBarModule],
  template: `
    <main class="wrap">
      <header>
        <h1>Plans</h1>
        <p class="sub">
          Browsing, searching and receiving interests are free, and stay free.
          A plan lets you send without a daily limit and see contact details.
        </p>
      </header>

      @if (entitlements.value(); as e) {
        @if (e.isPaid && e.subscription) {
          <section class="current">
            <strong>{{ e.subscription.planName }} is active.</strong>
            {{ e.subscription.daysRemaining }} days left, until
            {{ date(e.subscription.currentPeriodEnd) }}.
            Buying again adds time rather than replacing what you have.
          </section>
        } @else {
          <section class="current free">
            <strong>You are on the free plan.</strong>
            {{ e.interests.remaining }} of {{ e.interests.limit }} interests left today.
          </section>
        }
      }

      @if (message(); as m) { <p class="notice" role="status">{{ m }}</p> }

      @switch (phase()) {
        @case ('ready') {
          @if (intent(); as i) {
            <section class="checkout">
              <h2>{{ i.quote.planName }}</h2>
              <dl>
                <div><dt>Plan</dt><dd>{{ inr(i.quote.net) }}</dd></div>
                <div><dt>GST (18%)</dt><dd>{{ inr(i.quote.gst) }}</dd></div>
                <div class="total"><dt>To pay</dt><dd>{{ inr(i.quote.gross) }}</dd></div>
              </dl>
              <p class="hint">
                {{ i.quote.durationDays }} days of unlimited interests, contact
                details and chat.
              </p>
              <div class="actions">
                <button mat-button (click)="phase.set('browsing')">Back</button>
                <button mat-flat-button (click)="pay(i)">
                  Pay {{ inr(i.quote.gross) }}
                </button>
              </div>
              <p class="dev">
                <strong>Development mode.</strong> The fake gateway has no hosted
                checkout, so this completes through a signed webhook — the same
                verification and accounting path a real payment takes.
              </p>
            </section>
          }
        }

        @case ('done') {
          <section class="checkout ok">
            <h2>✓ Your plan is active</h2>
            <p>Send as many interests as you like, and contact details are now visible.</p>
            <button mat-flat-button (click)="reset()">Back to plans</button>
          </section>
        }

        @default {
          @if (phase() === 'opening' || phase() === 'paying') {
            <mat-progress-bar mode="indeterminate" />
          }

          <section class="grid">
            @for (plan of plans.value(); track plan.code) {
              <article class="plan" [class.best]="plan.code === 'MATRIMONY_6M'">
                @if (plan.code === 'MATRIMONY_6M') {
                  <span class="badge">Most families choose this</span>
                }
                <h2>{{ plan.name }}</h2>
                <p class="price">{{ inr(plan.price) }}</p>
                <p class="per">plus GST · {{ perMonth(plan) }} a month</p>
                <p class="summary">{{ plan.summary }}</p>
                <button
                  mat-flat-button
                  [disabled]="phase() === 'opening'"
                  (click)="choose(plan)"
                >
                  Choose {{ plan.name }}
                </button>
              </article>
            }
          </section>
        }
      }
    </main>
  `,
  styles: `
    .wrap { max-width: 52rem; margin: 2rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1.1rem; }
    h1 { margin: 0; font-size: 1.6rem; font-weight: 600; }
    .sub { margin: 0.3rem 0 0; color: rgb(0 0 0 / 0.6); font-size: 0.9rem; max-width: 40rem; }
    .current { background: #e6f4ea; border: 1px solid #c8e6c9; color: #1b5e20;
               border-radius: 10px; padding: 0.9rem 1.1rem; font-size: 0.9rem; }
    .current.free { background: #eef1fb; border-color: #cfd6f2; color: #2f2d78; }
    .grid { display: grid; gap: 1rem;
            grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); }
    .plan { position: relative; background: #fff; border: 1px solid rgb(0 0 0 / 0.12);
            border-radius: 12px; padding: 1.4rem 1.25rem;
            display: flex; flex-direction: column; gap: 0.4rem; }
    .plan.best { border-color: #2f2d78; box-shadow: 0 0 0 1px #2f2d78 inset; }
    .badge { position: absolute; top: -0.6rem; left: 1.1rem; font-size: 0.62rem;
             font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
             background: #2f2d78; color: #fff; border-radius: 999px;
             padding: 0.2rem 0.55rem; }
    .plan h2 { margin: 0; font-size: 1.05rem; font-weight: 600; }
    .price { margin: 0.2rem 0 0; font-size: 1.8rem; font-weight: 700;
             font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
    .per { margin: 0; font-size: 0.75rem; color: rgb(0 0 0 / 0.5); }
    .summary { margin: 0.4rem 0 0.8rem; font-size: 0.87rem; color: rgb(0 0 0 / 0.7); }
    .plan button { margin-top: auto; }
    .checkout { background: #fff; border: 1px solid rgb(0 0 0 / 0.12); border-radius: 12px;
                padding: 1.5rem; display: flex; flex-direction: column; gap: 0.7rem;
                max-width: 26rem; }
    .checkout.ok { border-color: #c8e6c9; background: #f6fbf7; }
    .checkout h2 { margin: 0; font-size: 1.15rem; font-weight: 600; }
    dl { margin: 0; display: flex; flex-direction: column; gap: 0.3rem; }
    dl div { display: flex; justify-content: space-between; font-size: 0.9rem;
             border-top: 1px solid rgb(0 0 0 / 0.07); padding-top: 0.3rem; }
    dl div:first-child { border-top: none; }
    dt, dd { margin: 0; }
    dd { font-variant-numeric: tabular-nums; }
    .total { font-weight: 700; font-size: 1rem !important; }
    .hint { margin: 0; font-size: 0.85rem; color: rgb(0 0 0 / 0.6); }
    .actions { display: flex; gap: 0.6rem; }
    .dev { margin: 0; font-size: 0.78rem; line-height: 1.45; color: #8a5a00;
           background: #fbf1dc; border-left: 3px solid #c98a16;
           padding: 0.6rem 0.8rem; border-radius: 0 6px 6px 0; }
    .notice { margin: 0; font-size: 0.88rem; color: #b3261e; }
  `,
})
export class PlansPage {
  private readonly http = inject(HttpClient);

  protected readonly plans = httpResource<Plan[]>(
    () => '/api/v1/subscriptions/plans',
    { parse: (raw) => (raw as Envelope<Plan[]>).data, defaultValue: [] },
  );

  protected readonly entitlements = httpResource<EntitlementsDto>(
    () => '/api/v1/subscriptions/me',
    { parse: (raw) => (raw as Envelope<EntitlementsDto>).data },
  );

  protected readonly phase = signal<Phase>('browsing');
  protected readonly intent = signal<SubscriptionIntentDto | null>(null);
  protected readonly message = signal<string | null>(null);

  /** One key per checkout attempt, so a retry cannot open a second order. */
  private idempotencyKey = crypto.randomUUID();

  protected async choose(plan: Plan): Promise<void> {
    this.phase.set('opening');
    this.message.set(null);
    this.idempotencyKey = crypto.randomUUID();

    try {
      const res = await firstValueFrom(
        this.http.post<Envelope<SubscriptionIntentDto>>(
          '/api/v1/payments/subscriptions',
          { plan: plan.code },
          { headers: { 'Idempotency-Key': this.idempotencyKey } },
        ),
      );
      this.intent.set(res.data);
      this.phase.set('ready');
    } catch (e) {
      this.message.set((e as AppError).message);
      this.phase.set('browsing');
    }
  }

  protected async pay(intent: SubscriptionIntentDto): Promise<void> {
    this.phase.set('paying');
    try {
      await firstValueFrom(
        this.http.post(`/api/v1/payments/${intent.paymentId}/simulate-capture`, {}),
      );
      this.entitlements.reload();
      this.phase.set('done');
    } catch (e) {
      this.message.set((e as AppError).message);
      this.phase.set('failed');
    }
  }

  protected reset(): void {
    this.intent.set(null);
    this.phase.set('browsing');
    this.entitlements.reload();
  }

  protected readonly inr = (paisa: number): string => formatInr(paisa as never);

  protected perMonth(plan: Plan): string {
    const months = Math.round(plan.durationDays / 30);
    return formatInr(Math.round(plan.price / months) as never);
  }

  protected date(iso: string): string {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
}

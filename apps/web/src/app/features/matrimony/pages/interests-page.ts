import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { InterestDto } from '@eventhub/contracts';

import { MatrimonyApi, unwrap } from '../data/matrimony-api';
import { ProfileCard } from '../components/profile-card';
import type { AppError } from '../../../core/models/app-error';

type Tab = 'received' | 'sent' | 'accepted';

/**
 * The three sides of the interest state machine.
 *
 * Received leads, because that is where the decision sits. Accepting is
 * presented as what it actually is - the moment both families exchange phone
 * numbers - rather than as a neutral "confirm".
 */
@Component({
  selector: 'eh-interests-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProfileCard, MatButtonModule, MatProgressBarModule],
  template: `
    <main class="wrap">
      <header>
        <h1>Interests</h1>
        @if (quota.value(); as q) {
          <p class="sub">
            {{ q.limit - q.used }} of {{ q.limit }} interests left today.
            @if (q.used >= q.limit) {
              <strong>A plan lifts this limit.</strong>
            }
          </p>
        }
      </header>

      <nav class="tabs" role="tablist">
        @for (t of tabs; track t) {
          <button
            role="tab"
            [attr.aria-selected]="tab() === t"
            [class.on]="tab() === t"
            (click)="tab.set(t)"
          >
            {{ label(t) }}
            @if (tab() === t && interests.value().length) {
              <span class="count">{{ interests.value().length }}</span>
            }
          </button>
        }
      </nav>

      @if (interests.isLoading()) { <mat-progress-bar mode="indeterminate" /> }
      @if (message(); as m) { <p class="notice" role="status">{{ m }}</p> }

      @for (interest of interests.value(); track interest.id) {
        <div class="row">
          <eh-profile-card [profile]="interest.counterpart" />

          @if (interest.message) {
            <p class="msg">“{{ interest.message }}”</p>
          }

          <div class="actions">
            @switch (tab()) {
              @case ('received') {
                <button mat-flat-button [disabled]="busy()" (click)="accept(interest)">
                  Accept and share numbers
                </button>
                <button mat-button [disabled]="busy()" (click)="decline(interest)">
                  Decline
                </button>
              }
              @case ('sent') {
                @if (interest.status === 'SENT') {
                  <span class="state">Waiting for a reply</span>
                  <button mat-button [disabled]="busy()" (click)="withdraw(interest)">
                    Withdraw
                  </button>
                } @else {
                  <span class="state">{{ label(interest.status) }}</span>
                }
              }
              @case ('accepted') {
                <span class="state good">
                  Accepted — contact details are on their profile
                </span>
              }
            }
          </div>
        </div>
      } @empty {
        @if (!interests.isLoading()) {
          <section class="empty">
            <h2>{{ emptyTitle() }}</h2>
            <p>{{ emptyBody() }}</p>
          </section>
        }
      }
    </main>
  `,
  styles: `
    .wrap { max-width: 46rem; margin: 2rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1rem; }
    h1 { margin: 0; font-size: 1.6rem; font-weight: 600; }
    .sub { margin: 0.25rem 0 0; color: rgb(0 0 0 / 0.6); font-size: 0.9rem; }
    .tabs { display: flex; gap: 0.25rem; border-bottom: 1px solid rgb(0 0 0 / 0.12); }
    .tabs button { border: none; background: none; font: inherit; font-size: 0.9rem;
                   padding: 0.6rem 0.9rem; cursor: pointer; color: rgb(0 0 0 / 0.6);
                   border-bottom: 2px solid transparent; display: flex; gap: 0.4rem;
                   align-items: center; }
    .tabs button.on { color: #2f2d78; border-bottom-color: #2f2d78; font-weight: 600; }
    .count { font-size: 0.7rem; background: #2f2d78; color: #fff; border-radius: 999px;
             padding: 0.05rem 0.4rem; }
    .row { display: flex; flex-direction: column; gap: 0.5rem; }
    .msg { margin: 0; font-size: 0.88rem; font-style: italic; color: rgb(0 0 0 / 0.7);
           padding-left: 0.75rem; border-left: 3px solid rgb(0 0 0 / 0.12); }
    .actions { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; }
    .state { font-size: 0.85rem; color: rgb(0 0 0 / 0.6); }
    .state.good { color: #1b5e20; font-weight: 600; }
    .notice { margin: 0; font-size: 0.88rem; color: #0d47a1; background: #e3f2fd;
              border-left: 3px solid #0d47a1; padding: 0.6rem 0.8rem;
              border-radius: 0 6px 6px 0; }
    .empty { text-align: center; padding: 3rem 1rem; color: rgb(0 0 0 / 0.6); }
    .empty h2 { font-size: 1.1rem; margin: 0 0 0.4rem; }
  `,
})
export class InterestsPage {
  private readonly api = inject(MatrimonyApi);

  protected readonly tabs: Tab[] = ['received', 'sent', 'accepted'];
  protected readonly tab = signal<Tab>('received');
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);

  /** Keyed on the tab signal, so switching tabs is the whole of "refetch". */
  protected readonly interests = httpResource<InterestDto[]>(
    () => this.api.interestTabUrl(this.tab()),
    { parse: unwrap<InterestDto[]>, defaultValue: [] },
  );

  protected readonly quota = httpResource<{ used: number; limit: number }>(
    () => this.api.quotaUrl,
    { parse: unwrap<{ used: number; limit: number }> },
  );

  protected async accept(interest: InterestDto): Promise<void> {
    await this.run(() => this.api.acceptInterest(interest.id), 'Accepted.');
  }

  protected async decline(interest: InterestDto): Promise<void> {
    await this.run(() => this.api.declineInterest(interest.id), 'Declined.');
  }

  protected async withdraw(interest: InterestDto): Promise<void> {
    await this.run(() => this.api.withdrawInterest(interest.id), 'Withdrawn.');
  }

  private async run(action: () => Promise<unknown>, done: string): Promise<void> {
    this.busy.set(true);
    this.message.set(null);
    try {
      await action();
      this.interests.reload();
      this.quota.reload();
      this.message.set(done);
    } catch (e) {
      this.message.set((e as AppError).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected emptyTitle(): string {
    return {
      received: 'No interests waiting',
      sent: 'You have not sent any interests',
      accepted: 'Nothing accepted yet',
    }[this.tab()];
  }

  protected emptyBody(): string {
    return {
      received: 'When someone is interested in your profile, it appears here.',
      sent: 'Find a match and send an interest to start a conversation.',
      accepted: 'Contact details are shared once both sides accept.',
    }[this.tab()];
  }

  protected readonly label = (value: string): string =>
    value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
}

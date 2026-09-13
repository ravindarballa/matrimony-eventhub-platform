import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { httpResource } from '@angular/common/http';
import type { EntitlementsDto } from '@eventhub/contracts';

/** Below this, the plan stops being background information and starts being news. */
const URGENT_DAYS = 14;

/**
 * How much of the plan is left, as an hourglass.
 *
 * A subscription runs out silently. The member who paid for three months and is
 * two months in has no way of knowing that from any screen, and the first signal
 * under the old design was a capability quietly failing - chat refusing to open,
 * a contact number no longer shown. That is the worst possible moment to find
 * out, because it reads as the product breaking rather than as a renewal due.
 *
 * The hourglass is doing real work rather than decorating: the sand is drawn at
 * the fraction of the term actually elapsed, so a glance carries the same
 * information as the number beside it. It tips over once, slowly, on a loop that
 * is long enough not to nag - and stops entirely for anyone who has asked for
 * reduced motion.
 */
@Component({
  selector: 'eh-plan-timer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (term(); as t) {
      <a
        class="timer"
        [class.urgent]="t.urgent"
        routerLink="/matrimony/plans"
        [title]="t.title"
      >
        <span class="glass" aria-hidden="true">
          <span class="sand" [style.--filled]="t.elapsedFraction"></span>
        </span>
        <span class="left">{{ t.label }}</span>
      </a>
    }
  `,
  styles: `
    :host { display: contents; }

    .timer { display: flex; align-items: center; gap: 0.4rem;
             padding: 0.25rem 0.6rem 0.25rem 0.45rem; border-radius: 999px;
             background: rgb(255 255 255 / 0.15);
             border: 1px solid rgb(255 255 255 / 0.3);
             color: #fff; text-decoration: none; font-size: 0.78rem;
             font-weight: 600; white-space: nowrap; }
    .timer:hover { background: rgb(255 255 255 / 0.25); }
    /* Amber rather than red: a plan running out is a deadline, not a failure. */
    .timer.urgent { background: rgb(217 165 32 / 0.28);
                    border-color: rgb(217 165 32 / 0.75); }

    /* The glass: two triangles meeting at a waist, drawn with borders. */
    .glass { position: relative; width: 0.85rem; height: 1.1rem;
             display: block; animation: tip 9s ease-in-out infinite; }
    .glass::before, .glass::after {
      content: ''; position: absolute; left: 0; width: 0; height: 0;
      border-left: 0.425rem solid transparent;
      border-right: 0.425rem solid transparent;
    }
    .glass::before { top: 0; border-top: 0.55rem solid rgb(255 255 255 / 0.55); }
    .glass::after { bottom: 0; border-bottom: 0.55rem solid rgb(255 255 255 / 0.28); }

    /*
     * The sand sits in the lower bulb and rises with the fraction of the term
     * already spent, so a nearly-spent plan reads as nearly full at the bottom.
     */
    .sand { position: absolute; left: 50%; bottom: 0.06rem; transform: translateX(-50%);
            width: calc(0.72rem * var(--filled, 0)); height: calc(0.5rem * var(--filled, 0));
            background: #fff; border-radius: 1px; }

    @keyframes tip {
      0%, 42% { transform: rotate(0deg); }
      50%, 92% { transform: rotate(180deg); }
      100% { transform: rotate(360deg); }
    }

    /* Movement here is ornament, and ornament is the first thing to drop for
       anyone who has asked the system for less of it. */
    @media (prefers-reduced-motion: reduce) {
      .glass { animation: none; }
    }
  `,
})
export class PlanTimer {
  private readonly entitlements = httpResource<EntitlementsDto | null>(
    () => '/api/v1/subscriptions/me',
    {
      parse: (raw) => (raw as { data: EntitlementsDto }).data,
      defaultValue: null,
    },
  );

  /**
   * Null unless there is a dated term to count down.
   *
   * The free plan has no end date, so it gets no hourglass - a timer that never
   * moves teaches people to ignore the one that does.
   */
  protected readonly term = computed(() => {
    const sub = this.entitlements.value()?.subscription;
    if (!sub || !sub.currentPeriodEnd) return null;

    const start = new Date(sub.startedAt).getTime();
    const end = new Date(sub.currentPeriodEnd).getTime();
    const now = Date.now();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

    const elapsed = Math.min(1, Math.max(0, (now - start) / (end - start)));
    const days = sub.daysRemaining;

    const label =
      days < 0
        ? 'Plan expired'
        : days === 0
          ? 'Ends today'
          : days === 1
            ? '1 day left'
            : `${days} days left`;

    return {
      elapsedFraction: elapsed,
      urgent: days <= URGENT_DAYS,
      label,
      title: `${sub.planName} — ${label}. Ends ${new Date(
        sub.currentPeriodEnd,
      ).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}.`,
    };
  });
}

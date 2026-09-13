import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { IdleTimeoutService } from '../services/idle-timeout';
import { AuthStore } from '../../features/auth/data/auth.store';

/**
 * The two minutes' notice before an idle session ends.
 *
 * Mounted once at the application root rather than in each shell, so matrimony,
 * the wedding side, the vendor desk and the admin console all get it without
 * four copies that can drift apart.
 *
 * It is a modal on purpose. This is the one message on the platform that stops
 * being true while it is on screen - a banner in the corner that the member
 * never looks at leaves them signed out mid-sentence, which is the outcome the
 * warning exists to prevent.
 */
@Component({
  selector: 'eh-idle-warning',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (idle.warning()) {
      <div class="scrim">
        <div
          class="box"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="idle-h"
          aria-describedby="idle-d"
        >
          <h2 id="idle-h">Still there?</h2>
          <p id="idle-d">
            You have been inactive for a while. For your security we will sign
            you out in <strong>{{ clock() }}</strong>.
          </p>

          <!--
            The countdown is announced once a minute rather than every second:
            polite live region updates every second would talk over everything
            else a screen reader is saying, which is worse than not knowing the
            exact number.
          -->
          <p class="sr" role="status">
            Signing out in about {{ roughly() }}.
          </p>

          <div class="row">
            <button type="button" class="primary" (click)="stay()" cdkFocusInitial>
              Stay signed in
            </button>
            <button type="button" class="ghost" (click)="leave()">Sign out now</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    :host { display: contents; }

    .scrim { position: fixed; inset: 0; z-index: 1000; display: grid;
             place-items: center; padding: 1rem;
             background: rgb(0 0 0 / 0.45); }

    .box { width: min(26rem, 100%); padding: 1.4rem; border-radius: 0.8rem;
           background: #fff; box-shadow: 0 24px 60px rgb(0 0 0 / 0.3); }

    h2 { margin: 0 0 0.4rem; font-size: 1.2rem; font-weight: 600; }
    p { margin: 0 0 1rem; color: rgb(0 0 0 / 0.7); font-size: 0.94rem;
        line-height: 1.5; }
    strong { color: var(--brand-ink); font-variant-numeric: tabular-nums; }

    .row { display: flex; gap: 0.6rem; flex-wrap: wrap; }
    button { padding: 0.55rem 1.1rem; border-radius: 999px; font: inherit;
             font-size: 0.9rem; font-weight: 600; cursor: pointer; }
    .primary { border: 1px solid var(--brand); background: var(--brand);
               color: #fff; }
    .ghost { border: 1px solid var(--brand-line); background: #fff;
             color: inherit; }
    button:focus-visible { outline: 3px solid var(--brand); outline-offset: 2px; }

    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden;
          clip-path: inset(50%); white-space: nowrap; }
  `,
})
export class IdleWarning {
  protected readonly idle = inject(IdleTimeoutService);
  private readonly store = inject(AuthStore);

  /** m:ss, so the number reads as a countdown rather than a quantity. */
  protected readonly clock = computed(() => {
    const s = this.idle.secondsLeft();
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });

  protected readonly roughly = computed(() => {
    const s = this.idle.secondsLeft();
    if (s > 90) return `${Math.round(s / 60)} minutes`;
    if (s > 45) return 'one minute';
    return 'less than a minute';
  });

  protected stay(): void {
    this.idle.markActive();
  }

  protected leave(): void {
    void this.store.logout();
  }
}

import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

import { AuthStore } from './auth/data/auth.store';

/**
 * Stands in for the modules not yet built. It proves the authenticated shell
 * works end to end - a real session, a guarded route, and a working sign-out -
 * rather than showing an empty page.
 *
 * `module` and `code` arrive from route `data` as inputs, because
 * withComponentInputBinding() is enabled in app.config.ts.
 */
@Component({
  selector: 'eh-placeholder-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule],
  template: `
    <main class="wrap">
      <span class="code">{{ code() }}</span>
      <h1>{{ module() }}</h1>

      @if (store.user(); as user) {
        <p class="who">
          Signed in as <strong>{{ user.fullName }}</strong> (+91 {{ user.mobile }})
        </p>
        <p class="roles">
          @for (role of user.roles; track role) {
            <span class="pill">{{ role }}</span>
          }
        </p>
      }

      <p class="note">
        This module is specified in <code>docs/architecture.html</code> and not yet built.
        The session, route guard and API wiring around it are working.
      </p>

      <button mat-stroked-button (click)="store.logout()">Sign out</button>
    </main>
  `,
  styles: `
    .wrap {
      max-width: 40rem; margin: 4rem auto; padding: 0 1.5rem;
      display: flex; flex-direction: column; gap: 0.75rem; align-items: flex-start;
    }
    .code {
      font-family: ui-monospace, monospace; font-size: 0.7rem; font-weight: 700;
      letter-spacing: 0.06em; background: #2f2d78; color: #fff;
      padding: 0.25rem 0.5rem; border-radius: 4px;
    }
    h1 { margin: 0; font-size: 1.75rem; font-weight: 600; }
    .who, .note { margin: 0; color: rgb(0 0 0 / 0.7); }
    .roles { display: flex; gap: 0.4rem; margin: 0; flex-wrap: wrap; }
    .pill {
      font-size: 0.7rem; font-weight: 700; border: 1px solid rgb(0 0 0 / 0.2);
      border-radius: 999px; padding: 0.15rem 0.5rem;
    }
    .note {
      font-size: 0.9rem; border-left: 3px solid #c98a16; background: #fbf1dc;
      padding: 0.7rem 0.9rem; border-radius: 0 4px 4px 0;
    }
    code { font-family: ui-monospace, monospace; font-size: 0.85em; }
  `,
})
export class PlaceholderPage {
  protected readonly store = inject(AuthStore);

  readonly module = input('Module');
  readonly code = input('—');
}

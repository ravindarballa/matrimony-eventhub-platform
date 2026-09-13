import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { IdleWarning } from './core/components/idle-warning';
import { IdleTimeoutService } from './core/services/idle-timeout';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, IdleWarning],
  template: `
    <router-outlet />
    <eh-idle-warning />
  `,
})
export class App {
  /*
   * Injected for its side effect, which is the whole point of it: the service
   * watches the session and starts counting only once somebody is signed in.
   * Nothing reads it here, and nothing should - it is root-provided so every
   * shell is covered by this one instance rather than by four that could each
   * be forgotten separately.
   */
  private readonly idle = inject(IdleTimeoutService);
}

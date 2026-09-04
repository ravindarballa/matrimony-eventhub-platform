import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'eh-auth-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: `
    <div class="auth-layout">
      <aside class="brand">
        <h1>Matrimony <span>EventHub</span></h1>
        <p>Find a match. Then plan the wedding — venue, caterer, pandit, photographer — from one account.</p>
      </aside>
      <main class="panel">
        <router-outlet />
      </main>
    </div>
  `,
  styles: `
    .auth-layout {
      display: grid;
      grid-template-columns: 1fr 1fr;
      min-height: 100vh;
    }
    .brand {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 1rem;
      padding: 3rem;
      background: #2f2d78;
      color: #fff;
    }
    .brand h1 { font-size: 2.25rem; margin: 0; font-weight: 600; letter-spacing: -0.02em; }
    .brand h1 span { color: #e8b341; }
    .brand p { max-width: 34ch; line-height: 1.6; opacity: 0.85; margin: 0; }
    .panel {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    @media (max-width: 860px) {
      .auth-layout { grid-template-columns: 1fr; }
      .brand { padding: 2rem; }
      .brand h1 { font-size: 1.6rem; }
      .brand p { display: none; }
    }
  `,
})
export class AuthShell {}

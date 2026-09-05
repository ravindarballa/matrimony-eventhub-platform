import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormField, form, submit } from '@angular/forms/signals';
import {
  maxLength,
  min,
  minLength,
  required,
  schema,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { toPaisa } from '@eventhub/contracts';

import { CustomerApi } from '../data/customer-api';
import type { AppError } from '../../../core/models/app-error';

interface WeddingModel {
  brideName: string;
  groomName: string;
  primaryDate: string;
  city: string;
  guestEstimate: number;
  /** Rupees at this edge; converted to paisa once, on submit. */
  budgetRupees: number;
}

const weddingSchema = schema<WeddingModel>((p) => {
  required(p.brideName, { message: "Enter the bride's name" });
  minLength(p.brideName, 2);
  maxLength(p.brideName, 80);

  required(p.groomName, { message: "Enter the groom's name" });
  minLength(p.groomName, 2);
  maxLength(p.groomName, 80);

  required(p.primaryDate, { message: 'Pick the wedding date' });
  required(p.city, { message: 'Which city is the wedding in?' });
  minLength(p.city, 2);

  required(p.guestEstimate, { message: 'Roughly how many guests?' });
  min(p.guestEstimate, 1, { message: 'There has to be at least one guest' });

  required(p.budgetRupees, { message: 'A rough budget helps vendors quote' });
  min(p.budgetRupees, 1000, { message: 'That seems too low for a wedding' });
});

/**
 * The wedding everything else hangs off.
 *
 * It exists before any enquiry because the guest count, city and date are asked
 * once here rather than on every enquiry, and because the budget needs
 * something to be tracked against.
 */
@Component({
  selector: 'eh-wedding-setup-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  template: `
    <main class="wrap">
      <header>
        <h1>Set up your wedding</h1>
        <p class="sub">
          Vendors quote against these details, so a rough answer is better than
          a blank. You can change all of it later.
        </p>
      </header>

      <form class="card" (submit)="$event.preventDefault(); onSubmit()">
        @if (busy()) { <mat-progress-bar mode="indeterminate" /> }

        <div class="pair">
          <mat-form-field appearance="outline">
            <mat-label>Bride's name</mat-label>
            <input matInput [formField]="f.brideName" autocomplete="off" />
            @if (f.brideName().touched() && f.brideName().errors().length) {
              <mat-error>{{ f.brideName().errors()[0].message }}</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Groom's name</mat-label>
            <input matInput [formField]="f.groomName" autocomplete="off" />
            @if (f.groomName().touched() && f.groomName().errors().length) {
              <mat-error>{{ f.groomName().errors()[0].message }}</mat-error>
            }
          </mat-form-field>
        </div>

        <div class="pair">
          <mat-form-field appearance="outline">
            <mat-label>Wedding date</mat-label>
            <input matInput type="date" [formField]="f.primaryDate" />
            @if (f.primaryDate().touched() && f.primaryDate().errors().length) {
              <mat-error>{{ f.primaryDate().errors()[0].message }}</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>City</mat-label>
            <input matInput [formField]="f.city" autocomplete="address-level2" />
            @if (f.city().touched() && f.city().errors().length) {
              <mat-error>{{ f.city().errors()[0].message }}</mat-error>
            }
          </mat-form-field>
        </div>

        <div class="pair">
          <mat-form-field appearance="outline">
            <mat-label>Guests (estimate)</mat-label>
            <input matInput type="number" [formField]="f.guestEstimate" />
            @if (f.guestEstimate().touched() && f.guestEstimate().errors().length) {
              <mat-error>{{ f.guestEstimate().errors()[0].message }}</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Total budget</mat-label>
            <span matTextPrefix>₹&nbsp;</span>
            <input matInput type="number" [formField]="f.budgetRupees" />
            @if (f.budgetRupees().touched() && f.budgetRupees().errors().length) {
              <mat-error>{{ f.budgetRupees().errors()[0].message }}</mat-error>
            }
          </mat-form-field>
        </div>

        @if (error(); as e) {
          <p class="err" role="alert">{{ e }}</p>
        }

        <button mat-flat-button type="submit" [disabled]="busy()">
          Save and find vendors
        </button>
      </form>
    </main>
  `,
  styles: `
    .wrap { max-width: 40rem; margin: 2.5rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1.25rem; }
    h1 { margin: 0; font-size: 1.6rem; font-weight: 600; }
    .sub { margin: 0.35rem 0 0; color: rgb(0 0 0 / 0.6); font-size: 0.9rem; }
    .card { display: flex; flex-direction: column; gap: 0.4rem;
            background: #fff; border: 1px solid rgb(0 0 0 / 0.12);
            border-radius: 12px; padding: 1.5rem; }
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
    @media (max-width: 560px) { .pair { grid-template-columns: 1fr; } }
    .err { color: #b3261e; font-size: 0.9rem; margin: 0 0 0.5rem; }
    button { align-self: flex-start; }
  `,
})
export class WeddingSetupPage {
  private readonly api = inject(CustomerApi);
  private readonly router = inject(Router);

  protected readonly model = signal<WeddingModel>({
    brideName: '',
    groomName: '',
    primaryDate: '',
    city: '',
    guestEstimate: 300,
    budgetRupees: 1_500_000,
  });
  protected readonly f = form(this.model, weddingSchema);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected onSubmit(): void {
    this.error.set(null);

    void submit(this.f, async () => {
      const value = this.model();
      this.busy.set(true);
      try {
        await this.api.createWedding({
          brideName: value.brideName,
          groomName: value.groomName,
          primaryDate: new Date(value.primaryDate).toISOString(),
          city: value.city,
          guestEstimate: Number(value.guestEstimate),
          // Rupees become paisa once, here, at the edge.
          budgetTotal: toPaisa(Number(value.budgetRupees)),
        });
        await this.router.navigate(['/customer/vendors']);
      } catch (e) {
        this.error.set((e as AppError).message);
      } finally {
        this.busy.set(false);
      }
    });
  }
}

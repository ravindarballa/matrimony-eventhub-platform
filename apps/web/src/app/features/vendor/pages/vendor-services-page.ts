import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import {
  PricingModel,
  formatInr,
  toPaisa,
  type VendorDto,
  type VendorServiceDto,
} from '@eventhub/contracts';

import { VendorApi, unwrap } from '../data/vendor-api';
import type { AppError } from '../../../core/models/app-error';

const PER_UNIT: Record<string, string> = {
  PER_DAY: 'per day',
  PER_PLATE: 'per plate',
  PER_PACKAGE: 'per package',
  PER_HOUR: 'per hour',
};

/**
 * The catalogue.
 *
 * Pricing model is a first-class choice rather than a note in the description:
 * a venue priced per day and a caterer priced per plate cannot share one shape,
 * and search sorts on the cheapest package, so the number has to mean something.
 */
@Component({
  selector: 'eh-vendor-services-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatProgressBarModule],
  template: `
    <main class="wrap">
      <header class="head">
        <div>
          <h1>Your packages</h1>
          <p class="sub">
            What customers see in search. The cheapest package sets your "from" price.
          </p>
        </div>
        @if (!adding()) {
          <button mat-flat-button (click)="adding.set(true)">Add a package</button>
        }
      </header>

      @if (services.isLoading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (error(); as e) { <p class="err" role="alert">{{ e }}</p> }

      @if (adding()) {
        <form class="card form" (submit)="$event.preventDefault(); save()">
          <label>
            <span>Title</span>
            <input
              [value]="draft().title"
              (input)="edit('title', $any($event.target).value)"
              placeholder="Full day hall hire"
            />
          </label>

          <label>
            <span>Description</span>
            <textarea
              rows="3"
              [value]="draft().description"
              (input)="edit('description', $any($event.target).value)"
              placeholder="What the customer gets for this price"
            ></textarea>
          </label>

          <div class="pair">
            <label>
              <span>Pricing model</span>
              <select
                [value]="draft().pricingModel"
                (change)="edit('pricingModel', $any($event.target).value)"
              >
                @for (model of pricingModels; track model) {
                  <option [value]="model">{{ perUnit(model) }}</option>
                }
              </select>
            </label>

            <label>
              <span>Price (₹)</span>
              <input
                type="number"
                min="1"
                [value]="draft().priceRupees"
                (input)="edit('priceRupees', $any($event.target).value)"
              />
            </label>
          </div>

          <label>
            <span>Inclusions (comma separated)</span>
            <input
              [value]="draft().inclusions"
              (input)="edit('inclusions', $any($event.target).value)"
              placeholder="Parking, Generator backup, Bridal room"
            />
          </label>

          <div class="actions">
            <button mat-button type="button" (click)="adding.set(false)">Cancel</button>
            <button mat-flat-button type="submit" [disabled]="busy() || !valid()">
              Save package
            </button>
          </div>
        </form>
      }

      @for (service of services.value(); track service.id) {
        <article class="card">
          <div class="row">
            <div>
              <h2>{{ service.title }}</h2>
              <p class="desc">{{ service.description }}</p>
            </div>
            <div class="price">
              <strong>{{ inr(service.basePrice) }}</strong>
              <span>{{ perUnit(service.pricingModel) }}</span>
            </div>
          </div>
          @if (service.inclusions.length) {
            <ul class="incl">
              @for (item of service.inclusions; track item) {
                <li>{{ item }}</li>
              }
            </ul>
          }
        </article>
      } @empty {
        @if (!services.isLoading() && !adding()) {
          <section class="empty">
            <h2>No packages yet</h2>
            <p>Customers cannot compare you without at least one price.</p>
          </section>
        }
      }
    </main>
  `,
  styles: `
    .wrap { max-width: 46rem; margin: 2rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1rem; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
    h1 { margin: 0; font-size: 1.6rem; font-weight: 600; }
    .sub { margin: 0.25rem 0 0; color: rgb(0 0 0 / 0.6); font-size: 0.9rem; }
    .card { border: 1px solid rgb(0 0 0 / 0.12); border-radius: 10px; background: #fff;
            padding: 1.1rem 1.25rem; display: flex; flex-direction: column; gap: 0.6rem; }
    .form { gap: 0.8rem; }
    .form label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.72rem;
                  text-transform: uppercase; letter-spacing: 0.05em; color: rgb(0 0 0 / 0.55); }
    .form input, .form select, .form textarea {
      font: inherit; font-size: 0.92rem; padding: 0.5rem 0.6rem; border-radius: 6px;
      border: 1px solid rgb(0 0 0 / 0.25); text-transform: none; letter-spacing: normal;
      color: rgb(0 0 0 / 0.87); resize: vertical;
    }
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; }
    @media (max-width: 560px) { .pair { grid-template-columns: 1fr; } }
    .row { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; }
    h2 { margin: 0; font-size: 1.02rem; font-weight: 600; }
    .desc { margin: 0.2rem 0 0; font-size: 0.88rem; color: rgb(0 0 0 / 0.65); }
    .price { text-align: right; white-space: nowrap; }
    .price strong { display: block; font-variant-numeric: tabular-nums; }
    .price span { font-size: 0.72rem; color: rgb(0 0 0 / 0.5); }
    .incl { list-style: none; display: flex; flex-wrap: wrap; gap: 0.35rem;
            margin: 0; padding: 0.5rem 0 0; border-top: 1px solid rgb(0 0 0 / 0.07); }
    .incl li { font-size: 0.75rem; background: #eceff1; border-radius: 999px;
               padding: 0.15rem 0.55rem; }
    .actions { display: flex; gap: 0.6rem; }
    .empty { text-align: center; padding: 3rem 1rem; color: rgb(0 0 0 / 0.6); }
    .empty h2 { font-size: 1.1rem; margin: 0 0 0.4rem; }
    .err { color: #b3261e; font-size: 0.9rem; }
  `,
})
export class VendorServicesPage {
  private readonly api = inject(VendorApi);

  protected readonly pricingModels = Object.values(PricingModel);

  private readonly vendor = httpResource<VendorDto>(() => this.api.meUrl, {
    parse: unwrap<VendorDto>,
  });

  /**
   * Waits for the organisation: httpResource treats an undefined URL as "not
   * ready", so the request simply does not fire until the vendor id exists.
   */
  protected readonly services = httpResource<VendorServiceDto[]>(
    () => {
      const vendor = this.vendor.value();
      return vendor ? this.api.servicesUrl(vendor.id) : undefined;
    },
    { parse: unwrap<VendorServiceDto[]>, defaultValue: [] },
  );

  protected readonly adding = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly draft = signal({
    title: '',
    description: '',
    pricingModel: 'PER_DAY' as PricingModel,
    priceRupees: 0,
    inclusions: '',
  });

  protected edit(key: string, raw: string): void {
    this.draft.update((d) => ({
      ...d,
      [key]: key === 'priceRupees' ? Number(raw) : raw,
    }));
  }

  protected valid(): boolean {
    const d = this.draft();
    return d.title.trim().length >= 3 && d.priceRupees > 0;
  }

  protected async save(): Promise<void> {
    const d = this.draft();
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.addService({
        title: d.title.trim(),
        description: d.description.trim(),
        pricingModel: d.pricingModel,
        basePrice: toPaisa(Number(d.priceRupees)),
        inclusions: d.inclusions
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      this.draft.set({
        title: '',
        description: '',
        pricingModel: 'PER_DAY',
        priceRupees: 0,
        inclusions: '',
      });
      this.adding.set(false);
      this.services.reload();
    } catch (e) {
      this.error.set((e as AppError).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected readonly perUnit = (model: string): string => PER_UNIT[model] ?? model;
  protected readonly inr = (paisa: number): string => formatInr(paisa as never);
}

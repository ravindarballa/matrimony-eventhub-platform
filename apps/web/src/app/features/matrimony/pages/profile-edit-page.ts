import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { httpResource } from '@angular/common/http';
import { FormField, form, submit } from '@angular/forms/signals';
import {
  max,
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
import {
  Diet,
  Gender,
  MIN_AGE_BY_GENDER,
  MaritalStatus,
  NAKSHATRAS,
  PhotoPrivacy,
  ProfileManagedBy,
  RASHIS,
  type MatrimonyProfileDto,
} from '@eventhub/contracts';

import { MatrimonyApi, unwrap } from '../data/matrimony-api';
import type { AppError } from '../../../core/models/app-error';

interface ProfileModel {
  displayName: string;
  managedBy: ProfileManagedBy;
  gender: Gender;
  dateOfBirth: string;
  heightCm: number;
  maritalStatus: MaritalStatus;
  religion: string;
  community: string;
  gotra: string;
  motherTongue: string;
  city: string;
  diet: Diet;
  about: string;
  highestQualification: string;
  occupation: string;
  fatherOccupation: string;
  nativePlace: string;
  nakshatra: number | null;
  rashi: number | null;
  marsHouse: number | null;
  photoPrivacy: PhotoPrivacy;
}

const profileSchema = schema<ProfileModel>((p) => {
  required(p.displayName, { message: 'The name shown to matches' });
  minLength(p.displayName, 2);
  maxLength(p.displayName, 80);

  required(p.dateOfBirth, { message: 'Date of birth is required' });

  required(p.heightCm, { message: 'Height is required' });
  min(p.heightCm, 120, { message: 'Enter height in centimetres' });
  max(p.heightCm, 250, { message: 'Enter height in centimetres' });

  required(p.religion, { message: 'Religion is required' });
  required(p.community, { message: 'Community is required' });
  required(p.motherTongue, { message: 'Mother tongue is required' });
  required(p.city, { message: 'City is required' });

  maxLength(p.about, 2000);
});

const empty = (): ProfileModel => ({
  displayName: '',
  managedBy: 'SELF',
  gender: 'FEMALE',
  dateOfBirth: '',
  heightCm: 165,
  maritalStatus: 'NEVER_MARRIED',
  religion: '',
  community: '',
  gotra: '',
  motherTongue: '',
  city: '',
  diet: 'VEGETARIAN',
  about: '',
  highestQualification: '',
  occupation: '',
  fatherOccupation: '',
  nativePlace: '',
  nakshatra: null,
  rashi: null,
  marsHouse: null,
  photoPrivacy: PhotoPrivacy.MEMBERS_ONLY,
});

/**
 * The profile editor.
 *
 * The completeness meter is the whole point of the layout: a profile without a
 * horoscope or a photo gets very little interest, and saying so up front is
 * kinder than letting a family find out over three silent weeks. Publishing is
 * refused below 60%, by the server, so the meter is not decorative.
 */
@Component({
  selector: 'eh-matrimony-profile-edit-page',
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
      <header class="head">
        <div>
          <h1>Your profile</h1>
          <p class="sub">Matches see this. Contact details are never shown here.</p>
        </div>
        @if (existing.value(); as p) {
          <span class="status" [class.live]="p.status === 'ACTIVE'">
            {{ label(p.status) }}
          </span>
        }
      </header>

      @if (existing.value(); as p) {
        <section class="meter-panel">
          <div class="meter-head">
            <strong>{{ p.completeness }}% complete</strong>
            @if (p.completeness < 60) {
              <span class="muted">60% needed to go live</span>
            }
          </div>
          <div class="meter"><span [style.width.%]="p.completeness"></span></div>
          @if (p.status !== 'ACTIVE' && p.completeness >= 60) {
            <button mat-flat-button [disabled]="busy()" (click)="publish()">
              Publish my profile
            </button>
          }
          @if (p.status === 'ACTIVE') {
            <button mat-stroked-button [disabled]="busy()" (click)="markEngaged()">
              We are engaged — plan the wedding
            </button>
          }
        </section>
      }

      <form class="card" (submit)="$event.preventDefault(); save()">
        @if (busy()) { <mat-progress-bar mode="indeterminate" /> }

        <h2>Basics</h2>

        <mat-form-field appearance="outline">
          <mat-label>Name shown to matches</mat-label>
          <input matInput [formField]="f.displayName" />
          @if (f.displayName().touched() && f.displayName().errors().length) {
            <mat-error>{{ f.displayName().errors()[0].message }}</mat-error>
          }
        </mat-form-field>

        <div class="pair">
          <label class="native">
            <span>Profile managed by</span>
            <select [value]="model().managedBy" (change)="set('managedBy', $any($event.target).value)">
              @for (m of managedByOptions; track m) {
                <option [value]="m">{{ label(m) }}</option>
              }
            </select>
          </label>

          <label class="native">
            <span>Gender</span>
            <select [value]="model().gender" (change)="set('gender', $any($event.target).value)">
              @for (g of genders; track g) {
                <option [value]="g">{{ label(g) }}</option>
              }
            </select>
          </label>
        </div>

        <div class="pair">
          <mat-form-field appearance="outline">
            <mat-label>Date of birth</mat-label>
            <input matInput type="date" [formField]="f.dateOfBirth" />
            @if (f.dateOfBirth().touched() && f.dateOfBirth().errors().length) {
              <mat-error>{{ f.dateOfBirth().errors()[0].message }}</mat-error>
            }
            <mat-hint>Minimum age is {{ minimumAge() }}</mat-hint>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Height (cm)</mat-label>
            <input matInput type="number" [formField]="f.heightCm" />
            @if (f.heightCm().touched() && f.heightCm().errors().length) {
              <mat-error>{{ f.heightCm().errors()[0].message }}</mat-error>
            }
          </mat-form-field>
        </div>

        <div class="pair">
          <label class="native">
            <span>Marital status</span>
            <select
              [value]="model().maritalStatus"
              (change)="set('maritalStatus', $any($event.target).value)"
            >
              @for (m of maritalStatuses; track m) {
                <option [value]="m">{{ label(m) }}</option>
              }
            </select>
          </label>

          <label class="native">
            <span>Diet</span>
            <select [value]="model().diet" (change)="set('diet', $any($event.target).value)">
              @for (d of diets; track d) {
                <option [value]="d">{{ label(d) }}</option>
              }
            </select>
          </label>
        </div>

        <h2>Community</h2>

        <div class="pair">
          <mat-form-field appearance="outline">
            <mat-label>Religion</mat-label>
            <input matInput [formField]="f.religion" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Community</mat-label>
            <input matInput [formField]="f.community" />
          </mat-form-field>
        </div>

        <div class="pair">
          <mat-form-field appearance="outline">
            <mat-label>Gotra (optional)</mat-label>
            <input matInput [formField]="f.gotra" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Mother tongue</mat-label>
            <input matInput [formField]="f.motherTongue" />
          </mat-form-field>
        </div>

        <mat-form-field appearance="outline">
          <mat-label>City</mat-label>
          <input matInput [formField]="f.city" />
        </mat-form-field>

        <h2>Education, career and family</h2>

        <div class="pair">
          <mat-form-field appearance="outline">
            <mat-label>Highest qualification</mat-label>
            <input matInput [formField]="f.highestQualification" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Occupation</mat-label>
            <input matInput [formField]="f.occupation" />
          </mat-form-field>
        </div>

        <div class="pair">
          <mat-form-field appearance="outline">
            <mat-label>Father's occupation</mat-label>
            <input matInput [formField]="f.fatherOccupation" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Native place</mat-label>
            <input matInput [formField]="f.nativePlace" />
          </mat-form-field>
        </div>

        <mat-form-field appearance="outline">
          <mat-label>About</mat-label>
          <textarea matInput rows="4" [formField]="f.about"></textarea>
          <mat-hint>At least 50 characters counts towards completeness</mat-hint>
        </mat-form-field>

        <h2>Horoscope</h2>
        <p class="hint">
          Enter what your family's kundli says. These two values are what the
          36-guna score is calculated from; your birth time and place are never
          shown to anyone.
        </p>

        <div class="pair">
          <label class="native">
            <span>Nakshatra</span>
            <select
              [value]="model().nakshatra ?? ''"
              (change)="setNumber('nakshatra', $any($event.target).value)"
            >
              <option value="">Not sure</option>
              @for (n of nakshatras; track n.value) {
                <option [value]="n.value">{{ n.value }}. {{ n.name }}</option>
              }
            </select>
          </label>

          <label class="native">
            <span>Rashi (moon sign)</span>
            <select
              [value]="model().rashi ?? ''"
              (change)="setNumber('rashi', $any($event.target).value)"
            >
              <option value="">Not sure</option>
              @for (r of rashis; track r.value) {
                <option [value]="r.value">{{ r.value }}. {{ r.name }}</option>
              }
            </select>
          </label>
        </div>

        <label class="native">
          <span>House of Mars (for Mangal Dosha)</span>
          <select
            [value]="model().marsHouse ?? ''"
            (change)="setNumber('marsHouse', $any($event.target).value)"
          >
            <option value="">Not sure</option>
            @for (house of houses; track house) {
              <option [value]="house">House {{ house }}</option>
            }
          </select>
        </label>

        <h2>Privacy</h2>
        <label class="native">
          <span>Who can see your photos</span>
          <select
            [value]="model().photoPrivacy"
            (change)="set('photoPrivacy', $any($event.target).value)"
          >
            <option value="PUBLIC">Anyone</option>
            <option value="MEMBERS_ONLY">Members only</option>
            <option value="BLURRED_UNTIL_MUTUAL">Only after mutual interest</option>
            <option value="ON_REQUEST">On request</option>
          </select>
        </label>

        @if (error(); as e) { <p class="err" role="alert">{{ e }}</p> }
        @if (saved()) { <p class="ok" role="status">Saved.</p> }

        <button mat-flat-button type="submit" [disabled]="busy()">Save profile</button>
      </form>
    </main>
  `,
  styles: `
    .wrap { max-width: 44rem; margin: 2rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1.25rem; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
    h1 { margin: 0; font-size: 1.6rem; font-weight: 600; }
    .sub { margin: 0.25rem 0 0; color: rgb(0 0 0 / 0.6); font-size: 0.9rem; }
    .status { font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
              letter-spacing: 0.05em; background: #eceff1; color: #37474f;
              border-radius: 999px; padding: 0.2rem 0.55rem; white-space: nowrap; }
    .status.live { background: #e6f4ea; color: #1b5e20; }
    .meter-panel { background: #fff; border: 1px solid rgb(0 0 0 / 0.12);
                   border-radius: 10px; padding: 1rem 1.25rem;
                   display: flex; flex-direction: column; gap: 0.6rem; align-items: flex-start; }
    .meter-head { display: flex; gap: 0.6rem; align-items: baseline; font-size: 0.9rem; }
    .muted { color: rgb(0 0 0 / 0.55); font-size: 0.8rem; }
    .meter { width: 100%; height: 8px; border-radius: 999px; background: #eceff1;
             overflow: hidden; }
    .meter span { display: block; height: 100%; background: #2f2d78; }
    .card { display: flex; flex-direction: column; gap: 0.3rem; background: #fff;
            border: 1px solid rgb(0 0 0 / 0.12); border-radius: 12px; padding: 1.5rem; }
    .card h2 { margin: 0.8rem 0 0.6rem; font-size: 0.72rem; font-weight: 700;
               letter-spacing: 0.06em; text-transform: uppercase; color: rgb(0 0 0 / 0.55); }
    .card h2:first-child { margin-top: 0; }
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
    @media (max-width: 560px) { .pair { grid-template-columns: 1fr; } }
    .native { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.7rem;
              text-transform: uppercase; letter-spacing: 0.05em; color: rgb(0 0 0 / 0.55);
              margin-bottom: 1.2rem; }
    .native select { font: inherit; font-size: 0.95rem; padding: 0.7rem 0.6rem;
                     border: 1px solid rgb(0 0 0 / 0.38); border-radius: 4px;
                     text-transform: none; letter-spacing: normal; color: rgb(0 0 0 / 0.87); }
    .hint { margin: 0 0 0.8rem; font-size: 0.85rem; color: rgb(0 0 0 / 0.6); }
    .err { color: #b3261e; font-size: 0.9rem; margin: 0 0 0.5rem; }
    .ok { color: #1b5e20; font-size: 0.9rem; margin: 0 0 0.5rem; }
    button[type='submit'] { align-self: flex-start; margin-top: 0.5rem; }
  `,
})
export class MatrimonyProfileEditPage {
  private readonly api = inject(MatrimonyApi);

  protected readonly managedByOptions = Object.values(ProfileManagedBy);
  protected readonly genders = Object.values(Gender);
  protected readonly diets = Object.values(Diet);
  protected readonly maritalStatuses = Object.values(MaritalStatus);
  protected readonly houses = Array.from({ length: 12 }, (_, i) => i + 1);
  protected readonly nakshatras = NAKSHATRAS.map((name, i) => ({ name, value: i + 1 }));
  protected readonly rashis = RASHIS.map((name, i) => ({ name, value: i + 1 }));

  protected readonly existing = httpResource<MatrimonyProfileDto | null>(
    () => this.api.meUrl,
    { parse: unwrap<MatrimonyProfileDto | null>, defaultValue: null },
  );

  protected readonly model = signal<ProfileModel>(empty());
  protected readonly f = form(this.model, profileSchema);

  protected readonly busy = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal<string | null>(null);

  /** The legal floor moves with the gender selection, so the hint follows it. */
  protected readonly minimumAge = computed(
    () => MIN_AGE_BY_GENDER[this.model().gender],
  );

  constructor() {
    // Fills the form once the existing profile arrives, and only then.
    effect(() => {
      const p = this.existing.value();
      if (!p) return;

      this.model.set({
        displayName: p.displayName,
        managedBy: p.managedBy,
        gender: p.gender,
        dateOfBirth: p.dateOfBirth.slice(0, 10),
        heightCm: p.heightCm,
        maritalStatus: p.maritalStatus,
        religion: p.religion,
        community: p.community,
        gotra: p.gotra ?? '',
        motherTongue: p.motherTongue,
        city: p.city,
        diet: p.diet,
        about: p.about ?? '',
        highestQualification: p.education.highestQualification ?? '',
        occupation: p.career.occupation ?? '',
        fatherOccupation: p.family.fatherOccupation ?? '',
        nativePlace: p.family.nativePlace ?? '',
        nakshatra: p.horoscope.nakshatra ?? null,
        rashi: p.horoscope.rashi ?? null,
        marsHouse: p.horoscope.marsHouse ?? null,
        photoPrivacy: p.privacy.photos,
      });
    });
  }

  protected set<K extends keyof ProfileModel>(key: K, value: string): void {
    this.model.update((m) => ({ ...m, [key]: value as ProfileModel[K] }));
  }

  protected setNumber(
    key: 'nakshatra' | 'rashi' | 'marsHouse',
    raw: string,
  ): void {
    this.model.update((m) => ({ ...m, [key]: raw === '' ? null : Number(raw) }));
  }

  protected save(): void {
    this.error.set(null);
    this.saved.set(false);

    void submit(this.f, async () => {
      const m = this.model();
      this.busy.set(true);
      try {
        await this.api.saveProfile({
          displayName: m.displayName,
          managedBy: m.managedBy,
          gender: m.gender,
          dateOfBirth: new Date(m.dateOfBirth).toISOString(),
          heightCm: Number(m.heightCm),
          maritalStatus: m.maritalStatus,
          religion: m.religion,
          community: m.community,
          gotra: m.gotra || undefined,
          motherTongue: m.motherTongue,
          city: m.city,
          diet: m.diet,
          about: m.about || undefined,
          education: { highestQualification: m.highestQualification },
          career: { occupation: m.occupation },
          family: {
            fatherOccupation: m.fatherOccupation,
            nativePlace: m.nativePlace,
          },
          horoscope: {
            nakshatra: m.nakshatra ?? undefined,
            rashi: m.rashi ?? undefined,
            marsHouse: m.marsHouse ?? undefined,
          },
          privacy: { photos: m.photoPrivacy },
        });
        this.existing.reload();
        this.saved.set(true);
      } catch (e) {
        const err = e as AppError;
        this.error.set(
          err.code === 'MAT_UNDERAGE'
            ? `The legal minimum age to marry in India is ${this.minimumAge()}.`
            : err.message,
        );
      } finally {
        this.busy.set(false);
      }
    });
  }

  protected async publish(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.publish();
      this.existing.reload();
    } catch (e) {
      this.error.set((e as AppError).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async markEngaged(): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.markEngaged();
      this.existing.reload();
    } catch (e) {
      this.error.set((e as AppError).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected readonly label = (value: string): string =>
    value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
}

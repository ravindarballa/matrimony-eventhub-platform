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
import { MatSelectModule } from '@angular/material/select';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import {
  Diet,
  FamilyStatus,
  Gender,
  HabitFrequency,
  MAX_HOBBIES,
  MAX_PERSONAL_INTERESTS,
  MIN_AGE_BY_GENDER,
  type Paisa,
  RELIGIONS,
  communitiesFor,
  MaritalStatus,
  NAKSHATRAS,
  PhotoPrivacy,
  ProfileManagedBy,
  RASHIS,
  type MatrimonyProfileDto,
} from '@eventhub/contracts';

import { MatrimonyApi, unwrap } from '../data/matrimony-api';
import { PhotoManager } from '../components/photo-manager';
import { TagInput } from '../components/tag-input';
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
  state: string;
  highestQualification: string;
  fieldOfStudy: string;
  institution: string;
  occupation: string;
  employer: string;
  annualIncomeLakhs: number | null;
  fatherOccupation: string;
  motherOccupation: string;
  brothers: number | null;
  sisters: number | null;
  familyType: 'JOINT' | 'NUCLEAR' | '';
  familyStatus: FamilyStatus | '';
  nativePlace: string;
  smoking: HabitFrequency | '';
  drinking: HabitFrequency | '';
  birthTime: string;
  birthPlace: string;
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
  state: '',
  fieldOfStudy: '',
  institution: '',
  employer: '',
  annualIncomeLakhs: null,
  motherOccupation: '',
  brothers: null,
  sisters: null,
  familyType: '',
  familyStatus: '',
  smoking: '',
  drinking: '',
  birthTime: '',
  birthPlace: '',
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
    PhotoManager,
    TagInput,
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MatAutocompleteModule,
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
            <mat-select [formField]="f.religion">
              @for (r of religions; track r) {
                <mat-option [value]="r">{{ r }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Community</mat-label>
            <!--
              An autocomplete rather than a select: the list is scoped to the
              religion and still nowhere near exhaustive, so it suggests without
              refusing. Someone whose community is not on the list types it, and
              an existing profile keeps whatever it already had.
            -->
            <input matInput [formField]="f.community" [matAutocomplete]="communityList" />
            <mat-autocomplete #communityList="matAutocomplete">
              @for (c of communitySuggestions(); track c) {
                <mat-option [value]="c">{{ c }}</mat-option>
              }
            </mat-autocomplete>
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

        <div class="pair">
          <mat-form-field appearance="outline">
            <mat-label>City</mat-label>
            <input matInput [formField]="f.city" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>State</mat-label>
            <input matInput [formField]="f.state" />
          </mat-form-field>
        </div>

        <h2>Education, career and family</h2>

        <div class="pair">
          <mat-form-field appearance="outline">
            <mat-label>Highest qualification</mat-label>
            <input matInput [formField]="f.highestQualification" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Field of study</mat-label>
            <input matInput [formField]="f.fieldOfStudy" />
          </mat-form-field>
        </div>

        <div class="pair">
          <mat-form-field appearance="outline">
            <mat-label>College or university</mat-label>
            <input matInput [formField]="f.institution" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Occupation</mat-label>
            <input matInput [formField]="f.occupation" />
          </mat-form-field>
        </div>

        <div class="pair">
          <mat-form-field appearance="outline">
            <mat-label>Company</mat-label>
            <input matInput [formField]="f.employer" />
          </mat-form-field>

          <!--
            Entered in lakhs, stored in paisa. Nobody types 1800000000, and the
            server wants the smallest unit; the conversion belongs here rather
            than in anyone's head.
          -->
          <mat-form-field appearance="outline">
            <mat-label>Annual income (₹ lakhs)</mat-label>
            <input matInput type="number" [formField]="f.annualIncomeLakhs" />
            <mat-hint>Shown to others as a band, never as an exact figure</mat-hint>
          </mat-form-field>
        </div>

        <h3>Family</h3>

        <div class="pair">
          <mat-form-field appearance="outline">
            <mat-label>Father's occupation</mat-label>
            <input matInput [formField]="f.fatherOccupation" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Mother's occupation</mat-label>
            <input matInput [formField]="f.motherOccupation" />
          </mat-form-field>
        </div>

        <div class="pair">
          <mat-form-field appearance="outline">
            <mat-label>Brothers</mat-label>
            <input matInput type="number" [formField]="f.brothers" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Sisters</mat-label>
            <input matInput type="number" [formField]="f.sisters" />
          </mat-form-field>
        </div>

        <div class="pair">
          <mat-form-field appearance="outline">
            <mat-label>Family type</mat-label>
            <mat-select [formField]="f.familyType">
              <mat-option value="">Not saying</mat-option>
              <mat-option value="JOINT">Joint</mat-option>
              <mat-option value="NUCLEAR">Nuclear</mat-option>
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Family status</mat-label>
            <mat-select [formField]="f.familyStatus">
              <mat-option value="">Not saying</mat-option>
              @for (fs of familyStatuses; track fs) {
                <mat-option [value]="fs">{{ label(fs) }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>

        <mat-form-field appearance="outline">
          <mat-label>Native place</mat-label>
          <input matInput [formField]="f.nativePlace" />
        </mat-form-field>

        <h3>Lifestyle and interests</h3>

        <div class="pair">
          <mat-form-field appearance="outline">
            <mat-label>Smoking</mat-label>
            <mat-select [formField]="f.smoking">
              <mat-option value="">Not saying</mat-option>
              @for (h of habits; track h) {
                <mat-option [value]="h">{{ label(h) }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Drinking</mat-label>
            <mat-select [formField]="f.drinking">
              <mat-option value="">Not saying</mat-option>
              @for (h of habits; track h) {
                <mat-option [value]="h">{{ label(h) }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>

        <!--
          Tags rather than a comma-separated box: the server stores an array, so
          a text field would only move the splitting problem to whoever reads it.
        -->
        <eh-tag-input
          label="Hobbies"
          placeholder="Carnatic music, trekking…"
          [tags]="hobbies()"
          [max]="maxHobbies"
          (tagsChange)="hobbies.set($event)"
        />

        <eh-tag-input
          label="Interests"
          placeholder="Cricket, travel, cooking…"
          [tags]="personalInterests()"
          [max]="maxInterests"
          (tagsChange)="personalInterests.set($event)"
        />

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

        <!--
          Photos sit outside the form: they save on pick, not on submit, and the
          server is the source of truth for the list afterwards.
        -->
        <eh-photo-manager
          [profile]="existing.value()"
          (changed)="onPhotosChanged($event)"
        />

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

  protected readonly religions = RELIGIONS;
  protected readonly familyStatuses = Object.values(FamilyStatus);
  protected readonly habits = Object.values(HabitFrequency);
  protected readonly maxHobbies = MAX_HOBBIES;
  protected readonly maxInterests = MAX_PERSONAL_INTERESTS;

  /**
   * Held outside the form model because Signal Forms is built around fixed
   * fields and these are lists that grow and shrink. They are seeded when the
   * profile loads and read back on save.
   */
  protected readonly hobbies = signal<string[]>([]);
  protected readonly personalInterests = signal<string[]>([]);


  /**
   * Suggestions for the community box, narrowed to the religion currently
   * chosen and filtered by whatever has been typed so far.
   */
  protected readonly communitySuggestions = computed(() => {
    const typed = this.model().community.trim().toLowerCase();
    const all = communitiesFor(this.model().religion);
    return typed ? all.filter((c) => c.toLowerCase().includes(typed)) : all;
  });

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

  /**
   * Takes the profile the photo endpoints returned as the new truth.
   *
   * Set rather than refetched: the server already answered with the whole
   * updated profile, so another GET would only re-ask a question that was just
   * answered - and would race the form the member may already be typing in.
   */
  protected onPhotosChanged(profile: MatrimonyProfileDto): void {
    this.existing.value.set(profile);
  }

  constructor() {
    // Fills the form once the existing profile arrives, and only then.
    effect(() => {
      const p = this.existing.value();
      if (!p) return;

      this.hobbies.set([...(p.hobbies ?? [])]);
      this.personalInterests.set([...(p.personalInterests ?? [])]);
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
        state: p.state ?? '',
        highestQualification: p.education.highestQualification ?? '',
        fieldOfStudy: p.education.fieldOfStudy ?? '',
        institution: p.education.institution ?? '',
        occupation: p.career.occupation ?? '',
        employer: p.career.employer ?? '',
        // Stored in paisa, edited in lakhs.
        annualIncomeLakhs:
          p.career.annualIncome != null ? p.career.annualIncome / 100 / 100_000 : null,
        fatherOccupation: p.family.fatherOccupation ?? '',
        motherOccupation: p.family.motherOccupation ?? '',
        brothers: p.family.brothers ?? null,
        sisters: p.family.sisters ?? null,
        familyType: p.family.familyType ?? '',
        familyStatus: p.family.familyStatus ?? '',
        nativePlace: p.family.nativePlace ?? '',
        smoking: p.lifestyle?.smoking ?? '',
        drinking: p.lifestyle?.drinking ?? '',
        birthTime: p.horoscope.birthTime ?? '',
        birthPlace: p.horoscope.birthPlace ?? '',
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
          state: m.state || undefined,
          education: {
            highestQualification: m.highestQualification,
            fieldOfStudy: m.fieldOfStudy || undefined,
            institution: m.institution || undefined,
          },
          career: {
            occupation: m.occupation,
            employer: m.employer || undefined,
            // Lakhs back to paisa. Undefined rather than 0 when it is blank -
            // "not saying" and "nothing" are different answers.
            annualIncome: (m.annualIncomeLakhs != null && m.annualIncomeLakhs !== ('' as never)
                ? Math.round(Number(m.annualIncomeLakhs) * 100_000 * 100)
                : undefined) as Paisa | undefined,
          },
          family: {
            fatherOccupation: m.fatherOccupation,
            motherOccupation: m.motherOccupation || undefined,
            brothers: m.brothers != null ? Number(m.brothers) : undefined,
            sisters: m.sisters != null ? Number(m.sisters) : undefined,
            familyType: m.familyType || undefined,
            familyStatus: m.familyStatus || undefined,
            nativePlace: m.nativePlace,
          },
          lifestyle: {
            smoking: m.smoking || undefined,
            drinking: m.drinking || undefined,
          },
          hobbies: this.hobbies(),
          personalInterests: this.personalInterests(),
          horoscope: {
            birthTime: m.birthTime || undefined,
            birthPlace: m.birthPlace || undefined,
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

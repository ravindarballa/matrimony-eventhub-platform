import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  viewChild,
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
  validate,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatStepper, MatStepperModule } from '@angular/material/stepper';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import {
  Diet,
  FamilyStatus,
  Gender,
  HabitFrequency,
  MAX_ACHIEVEMENTS,
  MAX_ACHIEVEMENT_LENGTH,
  MAX_HOBBIES,
  MAX_PERSONAL_INTERESTS,
  MIN_AGE_BY_GENDER,
  type Paisa,
  RELIGIONS,
  communitiesFor,
  dateOfBirthError,
  MaritalStatus,
  NAKSHATRAS,
  PhotoPrivacy,
  ProfileManagedBy,
  RASHIS,
  type MatrimonyProfileDto,
  type UpsertProfileRequest,
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
  yearsOfExperience: number | null;
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

  /*
   * The whole date-of-birth rule, borrowed from contracts so the form and the
   * server reject the same dates for the same stated reason.
   *
   * It has to be a cross-field validator rather than a bound min/max: the floor
   * is 21 for a groom and 18 for a bride, so the limit depends on a field this
   * one does not own. Reading gender through valueOf means switching the gender
   * selector re-runs the check rather than leaving a date that was valid under
   * the old answer.
   */
  validate(p.dateOfBirth, ({ value, valueOf }) => {
    const dob = value();
    if (!dob) return null; // `required` already speaks to the empty case.
    const message = dateOfBirthError(dob, valueOf(p.gender));
    return message ? { kind: 'dateOfBirth', message } : null;
  });

  required(p.heightCm, { message: 'Height is required' });
  min(p.heightCm, 120, { message: 'Enter height in centimetres' });
  max(p.heightCm, 250, { message: 'Enter height in centimetres' });

  // Bounds live in the schema rather than on the input: a formField-bound
  // control is not allowed to carry its own min/max attributes.
  min(p.yearsOfExperience, 0, { message: 'Years cannot be negative' });
  max(p.yearsOfExperience, 60, { message: 'That is more than a working life' });

  // Income is entered in lakhs, so the ceiling is what stops a figure typed in
  // rupees landing as a salary of ten crore and skewing every band on the site.
  min(p.annualIncomeLakhs, 0, { message: 'Income cannot be negative' });
  max(p.annualIncomeLakhs, 10000, { message: 'Enter the amount in lakhs' });

  // Sibling counts, matched to the bounds the API already enforces.
  min(p.brothers, 0, { message: 'Cannot be negative' });
  max(p.brothers, 20, { message: 'Check this number' });
  min(p.sisters, 0, { message: 'Cannot be negative' });
  max(p.sisters, 20, { message: 'Check this number' });

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
  yearsOfExperience: null,
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
    MatStepperModule,
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

        <mat-stepper [linear]="false" orientation="horizontal" class="stepper">
<mat-step label="Basics">
          <section class="stepBody">

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


          <footer class="stepnav">
            <button
              mat-flat-button
              type="button"
              [disabled]="busy()"
              (click)="continueFrom(0)"
            >Save and continue</button>

            @if (stepNote(); as n) {
              <span class="stepnote" role="status">{{ n }}</span>
            }
          </footer>

        </section>
        </mat-step>

        <mat-step label="Community">
          <section class="stepBody">

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


          <footer class="stepnav">
            <button
              mat-stroked-button
              type="button"
              [disabled]="busy()"
              (click)="back()"
            >Back</button>
            <button
              mat-flat-button
              type="button"
              [disabled]="busy()"
              (click)="continueFrom(1)"
            >Save and continue</button>

            @if (stepNote(); as n) {
              <span class="stepnote" role="status">{{ n }}</span>
            }
          </footer>

        </section>
        </mat-step>

        <mat-step label="Career">
          <section class="stepBody">

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

        <mat-form-field appearance="outline" class="half">
          <mat-label>Years of experience</mat-label>
          <input matInput type="number" [formField]="f.yearsOfExperience" />
        </mat-form-field>

        <!--
          Optional, and worth completeness rather than being required. A profile
          that names verifiable specifics is a different proposition from one
          that names none - but demanding them just teaches people to invent one.
        -->
        <h3>Achievements</h3>
        <p class="hint">
          A promotion, a degree, a business you built. Shown only once interest
          is mutual, alongside your contact details — this is what a family asks
          about once the two of you are actually talking.
        </p>
        <eh-tag-input
          label="Achievements"
          [tags]="achievements()"
          [max]="maxAchievements"
          [maxLength]="maxAchievementLength"
          placeholder="Led the payments team at a 200-person company"
          (tagsChange)="achievements.set($event)"
        />

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


          <footer class="stepnav">
            <button
              mat-stroked-button
              type="button"
              [disabled]="busy()"
              (click)="back()"
            >Back</button>
            <button
              mat-flat-button
              type="button"
              [disabled]="busy()"
              (click)="continueFrom(2)"
            >Save and continue</button>

            @if (stepNote(); as n) {
              <span class="stepnote" role="status">{{ n }}</span>
            }
          </footer>

        </section>
        </mat-step>

        <mat-step label="Horoscope">
          <section class="stepBody">
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


          <footer class="stepnav">
            <button
              mat-stroked-button
              type="button"
              [disabled]="busy()"
              (click)="back()"
            >Back</button>
            <button
              mat-flat-button
              type="button"
              [disabled]="busy()"
              (click)="continueFrom(3)"
            >Save and continue</button>

            @if (stepNote(); as n) {
              <span class="stepnote" role="status">{{ n }}</span>
            }
          </footer>

        </section>
        </mat-step>

        <mat-step label="Privacy">
          <section class="stepBody">
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


          <footer class="stepnav">
            <button
              mat-stroked-button
              type="button"
              [disabled]="busy()"
              (click)="back()"
            >Back</button>
            <button
              mat-flat-button
              type="button"
              [disabled]="busy()"
              (click)="continueFrom(4)"
            >Save and finish</button>

            @if (stepNote(); as n) {
              <span class="stepnote" role="status">{{ n }}</span>
            }
          </footer>

        </section>
        </mat-step>
      </mat-stepper>

        @if (error(); as e) { <p class="err" role="alert">{{ e }}</p> }
        @if (blockedBy(); as b) {
          <p class="err" role="alert">
            Nothing was saved - {{ b }} still needs attention.
          </p>
        }
      </form>
    </main>
  `,
  styles: `
    .wrap { max-width: 50rem; margin: 2rem auto 4rem; padding: 0 1.25rem;
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
    .meter span { display: block; height: 100%; background: var(--brand); }
    .card { display: flex; flex-direction: column; gap: 0.3rem; background: #fff;
            border: 1px solid rgb(0 0 0 / 0.12); border-radius: 12px; padding: 1.5rem; }

    /*
     * The same stepper the registration flow uses, so creating a profile and
     * editing one look like the same job - which they are.
     *
     * Deliberately NOT linear, which is the one place this departs from
     * registration. Registration is a first run with an order; editing is
     * "change the one thing I came to change", and making somebody page through
     * Basics and Community to reach their horoscope would be worse than the long
     * form it replaced. Non-linear makes every step header a direct link.
     */
    .stepper { margin: -0.5rem -0.5rem 0; }
    /* Each step's own controls, at the foot of that step rather than pinned.
       The steps are short, and a fixed bar covers the very field being
       corrected on a phone. */
    .stepnav { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;
               margin-top: 1.1rem; padding-top: 0.9rem;
               border-top: 1px solid var(--brand-line); }
    .stepnote { font-size: 0.82rem; color: rgb(0 0 0 / 0.62); }

    .stepBody { padding: 0.6rem 0.2rem 0.2rem; display: flex;
                flex-direction: column; gap: 0.3rem; }
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
  protected readonly maxAchievements = MAX_ACHIEVEMENTS;
  protected readonly maxAchievementLength = MAX_ACHIEVEMENT_LENGTH;
  protected readonly maxInterests = MAX_PERSONAL_INTERESTS;

  /**
   * Held outside the form model because Signal Forms is built around fixed
   * fields and these are lists that grow and shrink. They are seeded when the
   * profile loads and read back on save.
   */
  protected readonly hobbies = signal<string[]>([]);
  protected readonly achievements = signal<string[]>([]);
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

  /** Needed because continue saves before it advances, so the move is ours. */
  private readonly stepper = viewChild(MatStepper);

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
      this.achievements.set([...(p.career.achievements ?? [])]);
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
        yearsOfExperience: p.career.yearsOfExperience ?? null,

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

  /**
   * Which fields each step owns, so a step can be checked on its own.
   *
   * The stepper is not linear and the required fields are spread over the first
   * two steps, so "is the form valid" is the wrong question to ask when
   * somebody presses continue on step one - it would fail on a field they have
   * not been shown yet. Each step is judged on what it actually contains.
   */
  private stepFields(index: number): { touch: () => void; bad: () => boolean }[] {
    const g = [
      [this.f.displayName, this.f.dateOfBirth, this.f.heightCm],
      [this.f.religion, this.f.community, this.f.motherTongue, this.f.city],
      [
        this.f.annualIncomeLakhs,
        this.f.yearsOfExperience,
        this.f.brothers,
        this.f.sisters,
        this.f.about,
      ],
      [],
      [],
    ][index];

    return (g ?? []).map((field) => ({
      touch: () => field().markAsTouched(),
      bad: () => field().errors().length > 0,
    }));
  }

  /** The first step carrying an error, named, or null when they all pass. */
  protected readonly blockedBy = signal<string | null>(null);

  /** What the last continue actually did, shown beside the button. */
  protected readonly stepNote = signal<string | null>(null);

  private readonly stepNames = [
    'Basics',
    'Community',
    'Career',
    'Horoscope',
    'Privacy',
  ];

  /**
   * Everything the API insists on before it will accept a profile at all.
   *
   * The server rejects an upsert missing any of these, so pressing continue on
   * step one of a brand new profile cannot save - community and city live on
   * step two and have not been asked for yet. Rather than fire a request that
   * is certain to 400, the step advances and the save happens at the first step
   * where it can succeed.
   */
  private readonly persistable = computed(() => {
    const m = this.model();
    return Boolean(
      m.displayName &&
        m.dateOfBirth &&
        m.heightCm &&
        m.religion &&
        m.community &&
        m.motherTongue &&
        m.city,
    );
  });

  protected back(): void {
    this.stepNote.set(null);
    this.stepper()?.previous();
  }

  /**
   * Validate this step, save what there is, then move on.
   *
   * Saving on the way out of each step is what makes a five-step form safe to
   * leave: the alternative is one button at the end, where a closed tab on step
   * four costs everything typed so far. The API merges sections rather than
   * replacing the profile, which is what makes a partial save meaningful.
   */
  protected async continueFrom(index: number): Promise<void> {
    this.error.set(null);
    this.blockedBy.set(null);
    this.stepNote.set(null);

    // Touch first: an untouched field shows no error, so a step that fails
    // silently is exactly the confusion this is meant to remove.
    const fields = this.stepFields(index);
    for (const f of fields) f.touch();
    if (fields.some((f) => f.bad())) {
      this.stepNote.set('Check the highlighted fields.');
      return;
    }

    const last = index === this.stepNames.length - 1;

    if (this.persistable()) {
      const ok = await this.persist();
      if (!ok) return; // persist() has already said why.
      this.stepNote.set(last ? 'All changes saved.' : 'Saved.');
    } else {
      // Nothing the server would accept yet, and saying so is better than a
      // silent advance that looks identical to a successful save.
      this.stepNote.set('Not saved yet - the next step completes the basics.');
    }

    if (!last) this.stepper()?.next();
  }

  /**
   * Sends the whole model. Returns whether it was accepted.
   *
   * Separated from the stepper so the save path has one implementation: a
   * second copy would drift the moment a field moved between steps.
   */
  private async persist(): Promise<boolean> {
    this.busy.set(true);
    try {
      await this.api.saveProfile(this.payload());
      this.existing.reload();
      this.saved.set(true);
      return true;
    } catch (e) {
      const err = e as AppError;
      this.error.set(
        err.code === 'MAT_UNDERAGE'
          ? `The legal minimum age to marry in India is ${this.minimumAge()}.`
          : err.message,
      );
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * The model as the API wants it, built once for every path that saves.
   *
   * Kept apart from the sending so the stepper and the explicit save cannot
   * drift into sending subtly different profiles.
   */
  private payload(): UpsertProfileRequest {
    const m = this.model();
    return {
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
        yearsOfExperience:
          m.yearsOfExperience != null && (m.yearsOfExperience as unknown) !== ''
            ? Number(m.yearsOfExperience)
            : undefined,
        achievements: this.achievements().length ? this.achievements() : undefined,
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
    };
  }

  /**
   * Save without moving, for the explicit action.
   *
   * `submit` runs its callback only when the whole form validates, and it does
   * so silently when it does not - which is what made pressing Save look like
   * nothing had happened when the empty field was on a step that was not open.
   * The blocked case now names the step instead.
   */
  protected save(): void {
    this.error.set(null);
    this.blockedBy.set(null);
    this.saved.set(false);

    const bad = this.firstIncompleteStep();
    if (bad !== null) {
      this.blockedBy.set(this.stepNames[bad] ?? 'An earlier step');
      // Open the offending step. Naming it is not enough when the field that
      // needs fixing is behind a tab the member is not looking at.
      const stepper = this.stepper();
      if (stepper) stepper.selectedIndex = bad;
      return;
    }

    void submit(this.f, async () => {
      await this.persist();
    });
  }

  /** The index of the first step with an error, or null when all of them pass. */
  private firstIncompleteStep(): number | null {
    for (let i = 0; i < this.stepNames.length; i++) {
      const fields = this.stepFields(i);
      for (const f of fields) f.touch();
      if (fields.some((f) => f.bad())) return i;
    }
    return null;
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

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import {
  Diet,
  Gender,
  INDIAN_MOBILE_REGEX,
  MIN_AGE_BY_GENDER,
  MaritalStatus,
  ProfileManagedBy,
  type UpsertProfileRequest,
} from '@eventhub/contracts';

import { AuthApi } from '../data/auth-api';
import { AuthStore } from '../data/auth.store';
import { MatrimonyApi } from '../../matrimony/data/matrimony-api';
import type { AppError } from '../../../core/models/app-error';

const RELIGIONS = ['Hindu', 'Muslim', 'Christian', 'Sikh', 'Jain', 'Buddhist', 'Parsi', 'Other'];
const TONGUES = [
  'Telugu', 'Hindi', 'Tamil', 'Kannada', 'Malayalam', 'Marathi',
  'Bengali', 'Gujarati', 'Punjabi', 'Odia', 'Urdu', 'Other',
];

/** Who is filling the form in, in the words families actually use. */
const MANAGED_BY: { value: ProfileManagedBy; label: string }[] = [
  { value: 'SELF', label: 'Myself' },
  { value: 'PARENT', label: 'My son or daughter' },
  { value: 'SIBLING', label: 'My brother or sister' },
  { value: 'RELATIVE', label: 'A relative' },
];

type Step = 'about' | 'background' | 'verify';

/**
 * Registration for the matrimony side.
 *
 * Separate from the ordinary signup because the two are not the same job. A
 * customer or a vendor needs an account and a verified number, and anything
 * more is a barrier between them and a quote. A member needs a profile - a
 * profile with no community, mother tongue or date of birth cannot be searched
 * or matched, so an account without one is an empty seat.
 *
 * It asks for the minimum a profile needs to appear in search and nothing else.
 * Everything optional - horoscope, career, family, photos - belongs on the
 * profile editor afterwards, where the completeness score is what argues for
 * filling it in. Front-loading those fields here buys nothing and loses people
 * on step two.
 *
 * The number is verified last, on purpose. Someone who has already answered
 * five questions about their family has invested something; asking for the code
 * first, before the form has shown what it is for, is where signups die.
 */
@Component({
  selector: 'eh-matrimony-register-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, MatProgressBarModule],
  template: `
    <form class="card" (submit)="$event.preventDefault(); next()">
      <header>
        <h2>Create your matrimony profile</h2>
        <ol class="steps" aria-label="Progress">
          <li [class.on]="step() === 'about'" [class.done]="step() !== 'about'">1. Profile</li>
          <li [class.on]="step() === 'background'" [class.done]="step() === 'verify'">
            2. Background
          </li>
          <li [class.on]="step() === 'verify'">3. Verify</li>
        </ol>
      </header>

      @if (busy()) { <mat-progress-bar mode="indeterminate" /> }
      @if (error(); as e) { <p class="err" role="alert">{{ e }}</p> }

      @if (step() === 'about') {
        <label>
          <span>This profile is for</span>
          <select [value]="managedBy()" (change)="managedBy.set($any($event.target).value)">
            @for (m of managedByOptions; track m.value) {
              <option [value]="m.value" [selected]="m.value === managedBy()">{{ m.label }}</option>
            }
          </select>
        </label>

        <label>
          <span>{{ subject() }} is a</span>
          <select [value]="gender()" (change)="gender.set($any($event.target).value)">
            <option value="FEMALE" [selected]="gender() === 'FEMALE'">Bride</option>
            <option value="MALE" [selected]="gender() === 'MALE'">Groom</option>
          </select>
        </label>

        <label>
          <span>Name shown to matches</span>
          <input
            type="text"
            autocomplete="name"
            placeholder="First name is enough"
            [value]="displayName()"
            (input)="displayName.set($any($event.target).value)"
          />
        </label>

        <label>
          <span>Date of birth</span>
          <input
            type="date"
            [max]="latestBirthDate()"
            [value]="dob()"
            (input)="dob.set($any($event.target).value)"
          />
          <small>Minimum age is {{ minimumAge() }} for a {{ genderWord() }}.</small>
        </label>
      }

      @if (step() === 'background') {
        <div class="two">
          <label>
            <span>Religion</span>
            <select [value]="religion()" (change)="religion.set($any($event.target).value)">
              @for (r of religions; track r) {
                <option [value]="r" [selected]="r === religion()">{{ r }}</option>
              }
            </select>
          </label>
          <label>
            <span>Community</span>
            <input
              type="text"
              placeholder="Reddy, Brahmin, Nair…"
              [value]="community()"
              (input)="community.set($any($event.target).value)"
            />
          </label>
        </div>

        <div class="two">
          <label>
            <span>Mother tongue</span>
            <select [value]="tongue()" (change)="tongue.set($any($event.target).value)">
              @for (t of tongues; track t) {
                <option [value]="t" [selected]="t === tongue()">{{ t }}</option>
              }
            </select>
          </label>
          <label>
            <span>City</span>
            <input
              type="text"
              placeholder="Hyderabad"
              [value]="city()"
              (input)="city.set($any($event.target).value)"
            />
          </label>
        </div>

        <div class="two">
          <label>
            <span>Height</span>
            <select [value]="heightCm()" (change)="heightCm.set(+$any($event.target).value)">
              @for (h of heights; track h.cm) {
                <option [value]="h.cm" [selected]="h.cm === heightCm()">{{ h.label }}</option>
              }
            </select>
          </label>
          <label>
            <span>Marital status</span>
            <select
              [value]="maritalStatus()"
              (change)="maritalStatus.set($any($event.target).value)"
            >
              @for (m of maritalStatuses; track m) {
                <option [value]="m" [selected]="m === maritalStatus()">{{ label(m) }}</option>
              }
            </select>
          </label>
        </div>

        <label>
          <span>Diet</span>
          <select [value]="diet()" (change)="diet.set($any($event.target).value)">
            @for (d of diets; track d) {
              <option [value]="d" [selected]="d === diet()">{{ label(d) }}</option>
            }
          </select>
        </label>
      }

      @if (step() === 'verify') {
        @if (!challengeId()) {
          <label>
            <span>Mobile number</span>
            <input
              type="tel"
              inputmode="numeric"
              maxlength="10"
              autocomplete="tel-national"
              placeholder="9812345678"
              [value]="mobile()"
              (input)="mobile.set($any($event.target).value)"
            />
            <small>We send a one-time code. This number is never shown on your profile.</small>
          </label>

          <label class="check">
            <input type="checkbox" [checked]="consent()" (change)="consent.set($any($event.target).checked)" />
            <span>I accept the terms and the privacy policy.</span>
          </label>
        } @else {
          <label>
            <span>6-digit code</span>
            <input
              type="text"
              inputmode="numeric"
              maxlength="6"
              autocomplete="one-time-code"
              [value]="code()"
              (input)="code.set($any($event.target).value)"
            />
            <small>Sent to +91 {{ mobile() }}.</small>
          </label>

          @if (devCode()) {
            <p class="dev">Development mode — your code is <strong>{{ devCode() }}</strong></p>
          }
        }
      }

      <div class="actions">
        @if (step() !== 'about' && !challengeId()) {
          <button mat-button type="button" (click)="back()">Back</button>
        }
        <button mat-flat-button type="submit" class="go" [disabled]="busy()">
          {{ nextLabel() }}
        </button>
      </div>

      <p class="alt">
        Only after quotes? <a routerLink="/enquire">Enquire without an account</a><br />
        Already registered? <a routerLink="/auth/login">Sign in</a>
      </p>
    </form>
  `,
  styles: `
    .card { display: flex; flex-direction: column; gap: 0.9rem;
            width: min(30rem, 100%); }
    h2 { margin: 0; font-size: 1.4rem; font-weight: 600; }
    .steps { list-style: none; display: flex; gap: 0.9rem; flex-wrap: wrap;
             margin: 0.7rem 0 0; padding: 0; font-size: 0.78rem;
             color: rgb(0 0 0 / 0.45); }
    .steps li.on { color: #2f2d78; font-weight: 700; }
    .steps li.done { color: #1b5e20; }
    label { display: flex; flex-direction: column; gap: 0.28rem; font-size: 0.7rem;
            text-transform: uppercase; letter-spacing: 0.05em; color: rgb(0 0 0 / 0.55); }
    input[type='text'], input[type='tel'], input[type='date'], select {
            font: inherit; font-size: 0.95rem; padding: 0.55rem 0.6rem; border-radius: 7px;
            border: 1px solid rgb(0 0 0 / 0.25); background: #fff; color: rgb(0 0 0 / 0.87);
            text-transform: none; letter-spacing: normal; }
    small { text-transform: none; letter-spacing: normal; font-size: 0.75rem;
            color: rgb(0 0 0 / 0.5); }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
    .check { flex-direction: row; align-items: flex-start; gap: 0.5rem;
             text-transform: none; letter-spacing: normal; font-size: 0.85rem;
             color: rgb(0 0 0 / 0.7); }
    .check input { margin-top: 0.15rem; }
    .actions { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.3rem; }
    .go { flex: 1; background: #2f2d78 !important; color: #fff !important; font-weight: 700; }
    .err { margin: 0; font-size: 0.85rem; color: #b3261e; }
    .dev { margin: 0; font-size: 0.85rem; color: #8a5a00; background: #fbf1dc;
           border-left: 3px solid #c98a16; padding: 0.5rem 0.7rem; border-radius: 0 6px 6px 0; }
    .alt { font-size: 0.88rem; text-align: center; margin: 0.4rem 0 0; line-height: 1.7; }
    @media (max-width: 520px) { .two { grid-template-columns: 1fr; } }
  `,
})
export class MatrimonyRegisterPage {
  private readonly auth = inject(AuthApi);
  private readonly store = inject(AuthStore);
  private readonly matrimony = inject(MatrimonyApi);
  private readonly router = inject(Router);

  protected readonly managedByOptions = MANAGED_BY;
  protected readonly religions = RELIGIONS;
  protected readonly tongues = TONGUES;
  protected readonly diets = Object.values(Diet);
  protected readonly maritalStatuses = Object.values(MaritalStatus);

  /** 4'6" to 6'6", the range a matrimony form actually needs. */
  protected readonly heights = Array.from({ length: 25 }, (_, i) => {
    const cm = 137 + i * 2;
    const inches = Math.round(cm / 2.54);
    return { cm, label: `${Math.floor(inches / 12)}' ${inches % 12}" (${cm} cm)` };
  });

  protected readonly step = signal<Step>('about');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  // Step 1
  protected readonly managedBy = signal<ProfileManagedBy>('SELF');
  protected readonly gender = signal<Gender>('FEMALE');
  protected readonly displayName = signal('');
  protected readonly dob = signal('');

  // Step 2
  protected readonly religion = signal('Hindu');
  protected readonly community = signal('');
  protected readonly tongue = signal('Telugu');
  protected readonly city = signal('');
  protected readonly heightCm = signal(163);
  protected readonly maritalStatus = signal<MaritalStatus>('NEVER_MARRIED');
  protected readonly diet = signal<Diet>('VEGETARIAN');

  // Step 3
  protected readonly mobile = signal('');
  protected readonly consent = signal(false);
  protected readonly challengeId = signal<string | null>(null);
  protected readonly devCode = signal<string | null>(null);
  protected readonly code = signal('');

  protected readonly subject = computed(() =>
    this.managedBy() === 'SELF' ? 'I' : 'They',
  );
  protected readonly genderWord = computed(() =>
    this.gender() === 'FEMALE' ? 'bride' : 'groom',
  );
  protected readonly minimumAge = computed(() => MIN_AGE_BY_GENDER[this.gender()]);

  /**
   * The most recent birth date that still clears the legal minimum. Below 18 for
   * a bride or 21 for a groom a marriage is not legal in India, and the server
   * refuses regardless - this only stops the date picker offering a date it
   * would reject.
   */
  protected readonly latestBirthDate = computed(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - this.minimumAge());
    return d.toISOString().slice(0, 10);
  });

  protected nextLabel(): string {
    if (this.step() === 'about') return 'Continue';
    if (this.step() === 'background') return 'Continue';
    return this.challengeId() ? 'Verify and create my profile' : 'Send me a code';
  }

  protected back(): void {
    this.error.set(null);
    this.step.set(this.step() === 'verify' ? 'background' : 'about');
  }

  protected next(): void {
    this.error.set(null);
    if (this.step() === 'about') return this.leaveAbout();
    if (this.step() === 'background') return this.leaveBackground();
    void (this.challengeId() ? this.verify() : this.sendCode());
  }

  private leaveAbout(): void {
    if (this.displayName().trim().length < 2) {
      this.error.set('Enter the name matches will see.');
      return;
    }
    if (!this.dob()) {
      this.error.set('Enter a date of birth.');
      return;
    }
    if (this.ageFromDob() < this.minimumAge()) {
      this.error.set(
        `A ${this.genderWord()} has to be at least ${this.minimumAge()}.`,
      );
      return;
    }
    this.step.set('background');
  }

  private leaveBackground(): void {
    if (!this.community().trim()) {
      this.error.set('Enter the community, or "Any" if it does not matter.');
      return;
    }
    if (!this.city().trim()) {
      this.error.set('Enter the city they live in.');
      return;
    }
    this.step.set('verify');
  }

  private ageFromDob(): number {
    const born = new Date(this.dob());
    if (Number.isNaN(born.getTime())) return 0;
    const now = new Date();
    let age = now.getFullYear() - born.getFullYear();
    const monthDiff = now.getMonth() - born.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < born.getDate())) age--;
    return age;
  }

  private async sendCode(): Promise<void> {
    if (!INDIAN_MOBILE_REGEX.test(this.mobile())) {
      this.error.set('Enter a 10-digit Indian mobile number.');
      return;
    }
    if (!this.consent()) {
      this.error.set('Please accept the terms to continue.');
      return;
    }

    this.busy.set(true);
    try {
      const res = await firstValueFrom(
        this.auth.register({
          fullName: this.displayName().trim(),
          mobile: this.mobile(),
          intent: 'SEEKER',
          consent: true,
        }),
      );
      this.challengeId.set(res.challengeId);
      this.devCode.set(res.devCode ?? null);
    } catch (e) {
      this.error.set((e as AppError).message);
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Verifies the code, then writes the profile.
   *
   * The profile is saved after the session exists because the endpoint that
   * takes it is authenticated - there is no way to create one for an account
   * that has not proved its number yet, which is the correct order anyway.
   *
   * A profile that fails to save is not treated as a failed registration: the
   * account is real by then, so the honest thing is to land them on the editor
   * holding what they typed rather than pretend nothing happened.
   */
  private async verify(): Promise<void> {
    if (!/^\d{6}$/.test(this.code())) {
      this.error.set('Enter the 6-digit code we sent you.');
      return;
    }

    this.busy.set(true);
    try {
      await this.store.verifyOtp(this.challengeId()!, this.code());
    } catch (e) {
      const err = e as AppError;
      this.error.set(
        err.code === 'AUTH_OTP_INVALID'
          ? 'That code is not right. Check it and try again.'
          : err.code === 'AUTH_OTP_EXPIRED'
            ? 'That code has expired. Go back and request a new one.'
            : err.message,
      );
      this.busy.set(false);
      return;
    }

    try {
      await this.matrimony.saveProfile(this.profile());
      await this.router.navigate(['/matrimony/profile/edit'], {
        queryParams: { welcome: 1 },
      });
    } catch (e) {
      this.error.set(
        `Your account is created, but the profile did not save: ${(e as AppError).message}`,
      );
      await this.router.navigate(['/matrimony/profile/edit']);
    } finally {
      this.busy.set(false);
    }
  }

  private profile(): UpsertProfileRequest {
    return {
      displayName: this.displayName().trim(),
      managedBy: this.managedBy(),
      gender: this.gender(),
      dateOfBirth: new Date(this.dob()).toISOString(),
      heightCm: this.heightCm(),
      maritalStatus: this.maritalStatus(),
      religion: this.religion(),
      community: this.community().trim(),
      motherTongue: this.tongue(),
      city: this.city().trim(),
      diet: this.diet(),
    };
  }

  protected readonly label = (value: string): string =>
    value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
}

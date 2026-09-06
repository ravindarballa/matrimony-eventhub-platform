import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatStepperModule } from '@angular/material/stepper';
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

/**
 * Registration for the matrimony side.
 *
 * Separate from the ordinary signup because the two are not the same job. A
 * customer or a vendor needs an account and a verified number, and anything
 * more is a barrier between them and what they came for. A member needs a
 * profile: one with no community, mother tongue or date of birth cannot be
 * searched or matched, so an account without one is an empty seat.
 *
 * A horizontal stepper across the full width, one step to a screen. Not an
 * accordion: with every step stacked and open the form is a long scroll again,
 * which is the thing a stepper is meant to prevent. Finishing a step replaces
 * the screen with the next, and the header along the top is what says how much
 * is left. It is linear, and each step reports its own completeness, so Next
 * cannot skip an unanswered one.
 *
 * It asks for the minimum a profile needs to be searchable and stops.
 * Horoscope, career, family and photos belong on the profile editor, where the
 * completeness score is what argues for filling them in; front-loading them
 * here buys nothing and loses people on step two.
 *
 * The number is verified last, on purpose. Someone who has already answered
 * five questions about their family has invested something; asking for a code
 * first, before the form has shown what it is for, is where signups die.
 */
@Component({
  selector: 'eh-matrimony-register-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, MatProgressBarModule, MatStepperModule],
  template: `
    <header class="bar">
      <a class="brand" routerLink="/">
        <span class="mark">EH</span>
        <span>Matrimony <strong>EventHub</strong></span>
      </a>
      <a mat-button routerLink="/auth/login" class="signin">Already registered? Sign in</a>
    </header>

    <main class="page">
      <header class="intro">
        <h1>Create your matrimony profile</h1>
        <p>
          Three short steps. Photos, horoscope and family details come
          afterwards, on your profile.
        </p>
      </header>

      @if (busy()) { <mat-progress-bar mode="indeterminate" /> }
      @if (error(); as e) { <p class="err" role="alert">{{ e }}</p> }

      <mat-stepper [linear]="true" orientation="horizontal" class="stepper">
        <!-- ------------------------------------------------------ 1. profile -->
        <mat-step [completed]="aboutDone()" label="Profile">
          <section class="stepBody">
            <h2>Who is this profile for?</h2>

            <div class="grid">
              <label>
                <span>This profile is for</span>
                <select [value]="managedBy()" (change)="managedBy.set($any($event.target).value)">
                  @for (m of managedByOptions; track m.value) {
                    <option [value]="m.value" [selected]="m.value === managedBy()">
                      {{ m.label }}
                    </option>
                  }
                </select>
              </label>

              <label>
                <span>{{ subject() }} a</span>
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
                  placeholder="A first name is enough"
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
            </div>

            <div class="actions">
              <button mat-flat-button matStepperNext class="go" (click)="checkAbout()">
                Continue
              </button>
            </div>
          </section>
        </mat-step>

        <!-- --------------------------------------------------- 2. background -->
        <mat-step [completed]="backgroundDone()" label="Background">
          <section class="stepBody">
            <h2>Background</h2>

            <div class="grid">
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

              <label>
                <span>Diet</span>
                <select [value]="diet()" (change)="diet.set($any($event.target).value)">
                  @for (d of diets; track d) {
                    <option [value]="d" [selected]="d === diet()">{{ label(d) }}</option>
                  }
                </select>
              </label>
            </div>

            <div class="actions">
              <button mat-button matStepperPrevious type="button">Back</button>
              <button mat-flat-button matStepperNext class="go" (click)="checkBackground()">
                Continue
              </button>
            </div>
          </section>
        </mat-step>

        <!-- ------------------------------------------------------- 3. verify -->
        <mat-step [completed]="false" label="Verify">
          <section class="stepBody narrow">
            @if (!challengeId()) {
              <h2>Verify your mobile number</h2>
              <p class="lead">
                This is how matches reach you, and how you sign in. It is never
                shown on your profile.
              </p>

              <div class="grid one">
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
                </label>

                <label class="check">
                  <input
                    type="checkbox"
                    [checked]="consent()"
                    (change)="consent.set($any($event.target).checked)"
                  />
                  <span>I accept the terms and the privacy policy.</span>
                </label>
              </div>

              <div class="actions">
                <button mat-button matStepperPrevious type="button">Back</button>
                <button mat-flat-button class="go" [disabled]="busy()" (click)="sendCode()">
                  Send me a code
                </button>
              </div>
            } @else {
              <h2>Enter the code</h2>
              <p class="lead">We sent a 6-digit code to +91 {{ mobile() }}.</p>

              <div class="grid one">
                <label>
                  <span>6-digit code</span>
                  <input
                    class="code"
                    type="text"
                    inputmode="numeric"
                    maxlength="6"
                    autocomplete="one-time-code"
                    [value]="code()"
                    (input)="code.set($any($event.target).value)"
                  />
                </label>

                @if (devCode()) {
                  <p class="dev">
                    Development mode — your code is <strong>{{ devCode() }}</strong>
                  </p>
                }
              </div>

              <div class="actions">
                <button mat-button type="button" (click)="changeNumber()">Change number</button>
                <button mat-flat-button class="go" [disabled]="busy()" (click)="verify()">
                  Verify and start searching
                </button>
              </div>
            }
          </section>
        </mat-step>
      </mat-stepper>

      <p class="alt">
        Only after quotes? <a routerLink="/enquire">Enquire without an account</a>
      </p>
    </main>
  `,
  styles: `
    :host { display: block; min-height: 100vh; background: #f7f7fb;
            --ink: #2f2d78; --gold: #e8b341; }

    .bar { display: flex; align-items: center; justify-content: space-between;
           gap: 1rem; padding: 0.7rem clamp(1rem, 4vw, 3rem);
           background: var(--ink); color: #fff; }
    .brand { display: flex; align-items: center; gap: 0.6rem; color: inherit;
             text-decoration: none; font-size: 1.05rem; }
    .brand strong { color: var(--gold); font-weight: 700; }
    .mark { display: grid; place-items: center; width: 2rem; height: 2rem;
            border-radius: 7px; background: #fff; color: var(--ink);
            font-weight: 800; font-size: 0.85rem; }
    .signin { color: #fff !important; font-size: 0.85rem; }

    .page { max-width: 52rem; margin: 0 auto;
            padding: clamp(1.5rem, 4vw, 2.75rem) clamp(1rem, 4vw, 2rem) 3rem; }
    .intro { text-align: center; margin-bottom: 1.4rem; }
    h1 { margin: 0; font-size: clamp(1.5rem, 3.4vw, 2.1rem); color: var(--ink);
         letter-spacing: -0.02em; }
    .intro p { margin: 0.55rem auto 0; max-width: 46ch; line-height: 1.6;
               color: rgb(0 0 0 / 0.62); font-size: 0.95rem; }

    .stepper { background: #fff; border: 1px solid rgb(0 0 0 / 0.09);
               border-radius: 14px; overflow: hidden; }
    .stepBody { padding: 0.4rem 0.2rem 0.2rem; display: flex;
                flex-direction: column; gap: 1rem; }
    .stepBody.narrow { max-width: 26rem; }
    h2 { margin: 0; font-size: 1.15rem; font-weight: 600; color: var(--ink); }
    .lead { margin: -0.5rem 0 0; font-size: 0.92rem; line-height: 1.6;
            color: rgb(0 0 0 / 0.65); }

    /* Two columns, because the width is there - the point of the full page. */
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem 1.25rem; }
    .grid.one { grid-template-columns: 1fr; }
    label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.7rem;
            text-transform: uppercase; letter-spacing: 0.05em; color: rgb(0 0 0 / 0.55); }
    input[type='text'], input[type='tel'], input[type='date'], select {
            font: inherit; font-size: 0.95rem; padding: 0.6rem 0.65rem; border-radius: 8px;
            border: 1px solid rgb(0 0 0 / 0.25); background: #fff; color: rgb(0 0 0 / 0.87);
            text-transform: none; letter-spacing: normal; }
    .code { font-size: 1.4rem; letter-spacing: 0.4em; text-align: center; }
    small { text-transform: none; letter-spacing: normal; font-size: 0.75rem;
            color: rgb(0 0 0 / 0.5); }
    .check { flex-direction: row; align-items: flex-start; gap: 0.5rem;
             text-transform: none; letter-spacing: normal; font-size: 0.88rem;
             color: rgb(0 0 0 / 0.7); }
    .check input { margin-top: 0.15rem; }

    .actions { display: flex; gap: 0.5rem; align-items: center;
               margin-top: 0.5rem; padding-top: 0.9rem;
               border-top: 1px solid rgb(0 0 0 / 0.07); }
    .go { background: var(--ink) !important; color: #fff !important; font-weight: 700; }
    .err { margin: 0 0 0.8rem; font-size: 0.9rem; color: #b3261e; text-align: center; }
    .dev { margin: 0; font-size: 0.85rem; color: #8a5a00; background: #fbf1dc;
           border-left: 3px solid #c98a16; padding: 0.5rem 0.7rem; border-radius: 0 6px 6px 0; }
    .alt { font-size: 0.88rem; text-align: center; margin: 1.2rem 0 0;
           color: rgb(0 0 0 / 0.6); }
    .alt a, .lead a { color: var(--ink); font-weight: 600; }

    @media (max-width: 600px) {
      .grid { grid-template-columns: 1fr; }
      .signin { display: none; }
    }
  `,
})
export class MatrimonyRegisterPage {
  private readonly auth = inject(AuthApi);
  private readonly store = inject(AuthStore);
  private readonly matrimony = inject(MatrimonyApi);
  private readonly router = inject(Router);

  /**
   * What the home page's search box was asking for, bound from the query
   * string. Someone looking for a bride is, far more often than not, a groom -
   * so the seeking value picks the opposite as the starting gender and carries
   * the rest through to the search they land on.
   */
  readonly seeking = input<string | undefined>(undefined);
  readonly ageMin = input<string | undefined>(undefined);
  readonly ageMax = input<string | undefined>(undefined);

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

  private seeded = false;

  constructor() {
    effect(() => {
      if (this.seeded) return;
      const wants = this.seeking();
      if (wants !== 'BRIDE' && wants !== 'GROOM') return;
      this.seeded = true;
      // Looking for a bride means you are most likely the groom.
      this.gender.set(wants === 'BRIDE' ? 'MALE' : 'FEMALE');
    });
  }

  protected readonly subject = computed(() =>
    this.managedBy() === 'SELF' ? "I'm" : "They're",
  );
  protected readonly genderWord = computed(() =>
    this.gender() === 'FEMALE' ? 'bride' : 'groom',
  );
  protected readonly minimumAge = computed(() => MIN_AGE_BY_GENDER[this.gender()]);

  /**
   * The most recent birth date that still clears the legal minimum. Below 18 for
   * a bride or 21 for a groom a marriage is not legal in India and the server
   * refuses regardless; this only stops the picker offering a date it would
   * reject.
   */
  protected readonly latestBirthDate = computed(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - this.minimumAge());
    return d.toISOString().slice(0, 10);
  });

  /**
   * Whether each step may be left. The stepper is linear and reads these, so an
   * unanswered step simply does not advance - the click handlers exist only to
   * say why.
   */
  protected readonly aboutDone = computed(
    () =>
      this.displayName().trim().length >= 2 &&
      !!this.dob() &&
      this.ageFromDob() >= this.minimumAge(),
  );
  protected readonly backgroundDone = computed(
    () => !!this.community().trim() && !!this.city().trim(),
  );

  protected checkAbout(): void {
    if (this.aboutDone()) return void this.error.set(null);
    if (this.displayName().trim().length < 2) {
      this.error.set('Enter the name matches will see.');
    } else if (!this.dob()) {
      this.error.set('Enter a date of birth.');
    } else {
      this.error.set(`A ${this.genderWord()} has to be at least ${this.minimumAge()}.`);
    }
  }

  protected checkBackground(): void {
    if (this.backgroundDone()) return void this.error.set(null);
    this.error.set(
      !this.community().trim()
        ? 'Enter the community, or "Any" if it does not matter.'
        : 'Enter the city they live in.',
    );
  }

  protected changeNumber(): void {
    this.challengeId.set(null);
    this.devCode.set(null);
    this.code.set('');
    this.error.set(null);
  }

  private ageFromDob(): number {
    const born = new Date(this.dob());
    if (Number.isNaN(born.getTime())) return 0;
    const now = new Date();
    let age = now.getFullYear() - born.getFullYear();
    const months = now.getMonth() - born.getMonth();
    if (months < 0 || (months === 0 && now.getDate() < born.getDate())) age--;
    return age;
  }

  protected async sendCode(): Promise<void> {
    this.error.set(null);
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
   * Verifies the code, writes the profile, and lands them on the search.
   *
   * The profile is saved after verification because the endpoint that takes it
   * is authenticated - there is no creating one for an account that has not
   * proved its number, which is the right order anyway.
   *
   * A profile that fails to save is not a failed registration: the account is
   * real by then, so it says so and sends them to the editor holding their
   * answers rather than pretending nothing happened.
   */
  protected async verify(): Promise<void> {
    this.error.set(null);
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
            ? 'That code has expired. Ask for a new one.'
            : err.message,
      );
      this.busy.set(false);
      return;
    }

    try {
      await this.matrimony.saveProfile(this.profile());
      // Straight to the matches. The server picks the opposite gender from the
      // profile just created, so the results are already the right side.
      await this.router.navigate(['/matrimony/search'], {
        queryParams: {
          ...(this.ageMin() ? { ageMin: this.ageMin() } : {}),
          ...(this.ageMax() ? { ageMax: this.ageMax() } : {}),
        },
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
